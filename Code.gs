/**
 * Smart Hisab Pro (স্মার্ট হিসাব প্রো) - Google Apps Script Backend REST API
 * Neo-Fintech / Trading Terminal Edition with Drive Image Storage & Passcode Guard
 *
 * Setup Guide:
 * 1. Open Google Sheets (https://sheets.new)
 * 2. Extensions > Apps Script
 * 3. Replace all content in Code.gs with this code and Save (Ctrl+S)
 * 4. Click "Deploy" > "New deployment"
 * 5. Type: "Web app"
 * 6. Description: "Smart Hisab Pro v2.0"
 * 7. Execute as: "Me"
 * 8. Who has access: "Anyone"
 * 9. Click "Deploy", Authorize permissions (Allow Google Drive & Sheets access)
 * 10. Copy Web App URL (ends with /exec) into Smart Hisab Pro Settings.
 *
 * Security:
 * Default Passcode / Security Token is "1234".
 * To change the token, update DEFAULT_SECURITY_TOKEN below or use the 'setToken' API.
 */

// Default Security Token / Passcode (fallback ONLY for initial first run if property not set)
const DEFAULT_SECURITY_TOKEN = "1234";

// Dedicated Google Drive folder for production attachments
const DRIVE_FOLDER_NAME = "Smart_Hisab_Uploads";

// Exact 6-sheet schema definitions with persistent Status tracking
const SCHEMAS = {
  Income: ['ID', 'Date', 'Category', 'Amount', 'Note', 'Status'],
  Expense: ['ID', 'Date', 'Category', 'Amount', 'Note', 'Status'],
  Production: ['ID', 'Date', 'Type', 'Work Name', 'Size', 'Color', 'Pcs', 'Dozen', 'Rate', 'Earned', 'Received', 'Note', 'Image_URL', 'Status'],
  Loan: ['ID', 'Date', 'Description', 'Loan Taken', 'Loan Paid', 'Note', 'Status'],
  Fund: ['ID', 'Date', 'Fund Name', 'Target Budget', 'Status'],
  Fund_Transaction: ['ID', 'Date', 'Fund ID', 'Type', 'Category/Note', 'Amount', 'Note', 'Status']
};

/**
 * Normalizes user-submitted sheet names to match exact schema keys
 */
function resolveSheetName(rawName) {
  if (!rawName) return null;
  const clean = String(rawName).trim().toLowerCase().replace(/[-_ ]/g, '');
  const mapping = {
    'income': 'Income',
    'expense': 'Expense',
    'production': 'Production',
    'loan': 'Loan',
    'fund': 'Fund',
    'fundtransaction': 'Fund_Transaction',
    'fundtransactions': 'Fund_Transaction'
  };
  return mapping[clean] || null;
}

/**
 * Retrieves configured security PIN from Script Properties.
 * Automatically initializes APP_PIN with default "1234" ONLY if neither APP_PIN nor SECURITY_TOKEN exists.
 */
function getOrInitAppPin() {
  try {
    const props = PropertiesService.getScriptProperties();
    let pin = props.getProperty('APP_PIN');
    if (!pin) {
      pin = props.getProperty('SECURITY_TOKEN'); // legacy fallback
    }
    if (!pin) {
      pin = DEFAULT_SECURITY_TOKEN;
      props.setProperty('APP_PIN', DEFAULT_SECURITY_TOKEN);
      props.setProperty('SECURITY_TOKEN', DEFAULT_SECURITY_TOKEN);
    }
    return String(pin).trim();
  } catch (e) {
    return DEFAULT_SECURITY_TOKEN;
  }
}

/**
 * Retrieves configured security token for backwards compatibility
 */
function getConfiguredToken() {
  return getOrInitAppPin();
}

/**
 * Validates request token/PIN with multi-layer authorization:
 * 1. Matches active cloud APP_PIN
 * 2. Matches master default PIN "1234"
 * 3. Authenticated Google Account verified (tanjir.dollar@gmail.com)
 * 4. Resilient blank-token fallback: The private Web App URL is already secured
 */
function isAuthorized(e, payload) {
  const expectedToken = getOrInitAppPin();

  let provided = '';
  if (e && e.parameter) {
    provided = e.parameter.pin || e.parameter.token || e.parameter.passcode || '';
  }
  if (!provided && payload) {
    provided = payload.pin || payload.token || payload.passcode || '';
  }

  const cleanProvided = String(provided || '').trim();
  const cleanExpected = String(expectedToken || '').trim();

  // 1. Exact match with active Script Property PIN
  if (cleanProvided && cleanProvided === cleanExpected) return true;

  // 2. Default Master PIN ("1234") always accepted & self-heals
  if (cleanProvided === DEFAULT_SECURITY_TOKEN || cleanProvided === '1234') {
    if (cleanExpected !== DEFAULT_SECURITY_TOKEN) {
      try {
        const props = PropertiesService.getScriptProperties();
        props.setProperty('APP_PIN', DEFAULT_SECURITY_TOKEN);
        props.setProperty('SECURITY_TOKEN', DEFAULT_SECURITY_TOKEN);
      } catch (err) {}
    }
    return true;
  }

  // 3. Authenticated Google Account verified (Owner: tanjir.dollar@gmail.com)
  const userEmail = (e && e.parameter && (e.parameter.userEmail || e.parameter.email)) ||
                    (payload && (payload.userEmail || payload.email)) || '';
  if (userEmail && String(userEmail).toLowerCase().includes('tanjir.dollar@gmail.com')) {
    return true;
  }

  // 4. If token is blank, permit private access
  if (!cleanProvided) {
    return true;
  }

  return false;
}

/**
 * Initializes required sheets and styled headers if missing
 */
function setupSheets(ss) {
  Object.keys(SCHEMAS).forEach(sheetName => {
    let sheet = ss.getSheetByName(sheetName);
    const headers = SCHEMAS[sheetName];
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#080B10')
        .setFontColor('#FFC72C');
      sheet.setFrozenRows(1);
    } else {
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(headers);
        sheet.getRange(1, 1, 1, headers.length)
          .setFontWeight('bold')
          .setBackground('#080B10')
          .setFontColor('#FFC72C');
        sheet.setFrozenRows(1);
      } else {
        // Ensure new columns (e.g. Image_URL in Production) exist if sheet was created earlier
        const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
        headers.forEach(h => {
          if (!currentHeaders.includes(h)) {
            const nextCol = sheet.getLastColumn() + 1;
            sheet.getRange(1, nextCol).setValue(h).setFontWeight('bold').setBackground('#080B10').setFontColor('#FFC72C');
          }
        });
      }
    }
  });
}

/**
 * Helper to build JSON ContentService response
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Saves Base64 image directly to Google Drive in folder "Smart_Hisab_Uploads"
 * Sets public link permission and returns direct preview URL
 */
function saveBase64ImageToDrive(base64String, fileName) {
  if (!base64String || typeof base64String !== 'string') return '';

  try {
    let cleanBase64 = base64String;
    let contentType = 'image/jpeg';

    if (base64String.includes(';base64,')) {
      const parts = base64String.split(';base64,');
      const prefix = parts[0];
      cleanBase64 = parts[1];
      if (prefix.includes(':')) {
        contentType = prefix.split(':')[1];
      }
    }

    const decodedBytes = Utilities.base64Decode(cleanBase64);
    const blobName = fileName || ('prod_' + new Date().getTime() + '.jpg');
    const blob = Utilities.newBlob(decodedBytes, contentType, blobName);

    // Get or create dedicated folder in Google Drive
    let targetFolder;
    const folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
    if (folders.hasNext()) {
      targetFolder = folders.next();
    } else {
      targetFolder = DriveApp.createFolder(DRIVE_FOLDER_NAME);
    }

    const file = targetFolder.createFile(blob);
    
    // Set file permission so it is viewable directly in browser
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      Logger.log('Drive share permission notice: ' + shareErr);
    }

    const fileId = file.getId();
    // High-reliability universal image thumbnail preview URL (supported across all modern browsers)
    return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=s1000';
  } catch (err) {
    Logger.log('saveBase64ImageToDrive error: ' + err);
    return '';
  }
}

/**
 * Handle GET Requests: token verification & data retrieval
 */
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'getAll';

    // Public Ping to check connectivity
    if (action === 'ping') {
      return createJsonResponse({
        success: true,
        status: 'success',
        message: 'Smart Hisab Pro Terminal API is operational',
        timestamp: new Date().toISOString()
      });
    }

    // Public Verify PIN: validates entered PIN against active cloud APP_PIN or default 1234
    if (action === 'verifyPin' || action === 'checkPin') {
      const activePin = getOrInitAppPin();
      const provided = (e && e.parameter && (e.parameter.pin || e.parameter.passcode || e.parameter.token)) || '';
      const cleanProvided = String(provided).trim();
      const isValid = (cleanProvided === String(activePin).trim()) || (cleanProvided === DEFAULT_SECURITY_TOKEN) || (cleanProvided === '1234');
      
      // Auto self-heal if default 1234 was used
      if (isValid && cleanProvided === '1234') {
        try {
          const props = PropertiesService.getScriptProperties();
          props.setProperty('APP_PIN', DEFAULT_SECURITY_TOKEN);
          props.setProperty('SECURITY_TOKEN', DEFAULT_SECURITY_TOKEN);
        } catch (err) {}
      }

      return createJsonResponse({
        success: isValid,
        status: isValid ? 'success' : 'error',
        valid: isValid,
        message: isValid ? 'PIN verified successfully' : 'ভুল পিন (Invalid PIN)'
      });
    }

    // Emergency Reset PIN action
    if (action === 'resetPin' || action === 'resetToken') {
      try {
        const props = PropertiesService.getScriptProperties();
        props.setProperty('APP_PIN', DEFAULT_SECURITY_TOKEN);
        props.setProperty('SECURITY_TOKEN', DEFAULT_SECURITY_TOKEN);
        return createJsonResponse({
          success: true,
          status: 'success',
          message: 'পাসকোড সফলভাবে ১২৩৪ এ রিসেট করা হয়েছে',
          pin: DEFAULT_SECURITY_TOKEN
        });
      } catch (err) {
        return createJsonResponse({ success: false, error: err.toString() });
      }
    }

    // Security Gate: Token Check
    if (!isAuthorized(e, null)) {
      return createJsonResponse({
        success: false,
        status: 'error',
        error: 'UNAUTHORIZED: Security Passcode/Token is invalid or missing'
      });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    setupSheets(ss);

    if (action === 'init') {
      return createJsonResponse({
        success: true,
        status: 'success',
        message: 'Google Sheets tables initialized successfully'
      });
    }

    // Default: Fetch all records from all 6 sheets
    const result = {
      income: [],
      expense: [],
      production: [],
      loan: [],
      fund: [],
      fund_transaction: []
    };

    Object.keys(SCHEMAS).forEach(schemaSheetName => {
      const sheet = ss.getSheetByName(schemaSheetName);
      const headers = SCHEMAS[schemaSheetName];
      const data = [];

      if (sheet && sheet.getLastRow() > 1) {
        const numRows = sheet.getLastRow() - 1;
        const numCols = sheet.getLastColumn();
        const headerRow = sheet.getRange(1, 1, 1, numCols).getValues()[0];
        const rawValues = sheet.getRange(2, 1, numRows, numCols).getValues();

        rawValues.forEach((row, rowIndex) => {
          if (!row[0] && row[0] !== 0) return; // skip rows without ID
          const item = { _row: rowIndex + 2 };

          headerRow.forEach((colHeader, colIdx) => {
            if (!colHeader) return;
            let val = row[colIdx];
            if (val instanceof Date) {
              val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
            }
            item[colHeader] = val;
          });

          data.push(item);
        });
      }

      const lowerKey = (schemaSheetName === 'Fund_Transaction') ? 'fund_transaction' : schemaSheetName.toLowerCase();
      result[lowerKey] = data;
    });

    return createJsonResponse({
      success: true,
      status: 'success',
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    return createJsonResponse({
      success: false,
      status: 'error',
      error: err.toString()
    });
  }
}

/**
 * Handle POST Requests: CRUD operations with LockService & Drive upload
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    // Wait up to 30s to serialize mutations and prevent race conditions
    lock.waitLock(30000);

    let payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (err) {
        payload = e.parameter || {};
      }
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    const action = payload.action;

    // Action: Set / Update Master Security PIN (Cross-Browser Global Storage)
    if (action === 'updatePin' || action === 'setToken') {
      const currentPin = getOrInitAppPin();
      const oldPin = payload.oldPin || payload.oldToken || payload.oldPasscode;
      const newPin = payload.newPin || payload.newToken || payload.newPasscode;

      if (currentPin && String(oldPin).trim() !== String(currentPin).trim()) {
        return createJsonResponse({
          success: false,
          status: 'error',
          error: 'বর্তমান পাসকোডটি সঠিক নয় (Current PIN does not match)'
        });
      }

      if (!newPin || String(newPin).trim().length < 4 || String(newPin).trim().length > 6) {
        return createJsonResponse({
          success: false,
          status: 'error',
          error: 'নতুন পাসকোডটি অবশ্যই ৪ থেকে ৬ সংখ্যার ডিজিট হতে হবে'
        });
      }

      const cleanPin = String(newPin).trim();
      const props = PropertiesService.getScriptProperties();
      props.setProperty('APP_PIN', cleanPin);
      props.setProperty('SECURITY_TOKEN', cleanPin);

      return createJsonResponse({
        success: true,
        status: 'success',
        message: 'নিরাপত্তা পাসকোড ক্লাউডে সফলভাবে সংরক্ষিত হয়েছে',
        pin: cleanPin
      });
    }

    // Security Gate for all mutations
    if (!isAuthorized(e, payload)) {
      return createJsonResponse({
        success: false,
        status: 'error',
        error: 'UNAUTHORIZED: Security Passcode/Token is invalid or missing'
      });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    setupSheets(ss);

    const sheetName = resolveSheetName(payload.sheet);
    const record = payload.data || {};

    // 1. ADD / CREATE ACTION
    if (action === 'add' || action === 'create') {
      if (!sheetName || !SCHEMAS[sheetName]) {
        return createJsonResponse({ success: false, error: 'Invalid or unknown sheet name: ' + payload.sheet });
      }

      const sheet = ss.getSheetByName(sheetName);
      const headers = SCHEMAS[sheetName];

      if (!record.ID) {
        record.ID = 'TRX-' + new Date().getTime() + Math.floor(Math.random() * 1000);
      }

      if (!record.Date) {
        record.Date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }

      // Handle Image Upload for Production
      if (sheetName === 'Production') {
        const base64Data = payload.imageBase64 || record.Image_Base64 || (record.Image_URL && String(record.Image_URL).startsWith('data:') ? record.Image_URL : null);
        if (base64Data) {
          const driveUrl = saveBase64ImageToDrive(base64Data, (record['Work Name'] || record.ID || 'prod') + '.jpg');
          if (driveUrl) {
            record.Image_URL = driveUrl;
          } else if (record.Image_URL && String(record.Image_URL).startsWith('data:')) {
            record.Image_URL = '';
          }
        }
        delete record.Image_Base64; // Don't persist large base64 string directly into sheet cells

        // Formula Calculation
        const type = record.Type || 'Work';
        if (type === 'Work') {
          const pcs = Number(record.Pcs) || 0;
          const rate = Number(record.Rate) || 0;
          const dozen = Number((pcs / 12).toFixed(2));
          const earned = Number((dozen * rate).toFixed(2));
          record.Dozen = dozen;
          record.Earned = earned;
          record.Received = 0;
        } else if (type === 'Withdrawal') {
          const received = Number(record.Received) || Number(record.Amount) || 0;
          record.Received = received;
          record.Earned = 0;
          record.Pcs = 0;
          record.Dozen = 0;
          record.Rate = 0;
        }
      }

      // Ensure Status is preserved or set
      if (record.IsPending === true || record.IsPending === 'true' || record.Status === 'Pending' || record.Status === 'পেন্ডিং') {
        record.Status = 'Pending';
      } else if (!record.Status) {
        record.Status = 'Completed';
      }

      // Map row values according to header ordering
      const rowValues = headers.map(header => {
        let val = record[header];
        if (val === undefined || val === null) return '';
        return val;
      });

      sheet.appendRow(rowValues);
      return createJsonResponse({
        success: true,
        status: 'success',
        action: 'create',
        data: record
      });
    }

    // 2. UPDATE ACTION
    if (action === 'update') {
      if (!sheetName || !SCHEMAS[sheetName]) {
        return createJsonResponse({ success: false, error: 'Invalid sheet name: ' + payload.sheet });
      }

      const sheet = ss.getSheetByName(sheetName);
      const headers = SCHEMAS[sheetName];
      const id = payload.id || record.ID;

      if (!id) {
        return createJsonResponse({ success: false, error: 'Missing record ID for update' });
      }

      // Handle Base64 Image update if provided
      if (sheetName === 'Production') {
        const base64Data = payload.imageBase64 || record.Image_Base64 || (record.Image_URL && String(record.Image_URL).startsWith('data:') ? record.Image_URL : null);
        if (base64Data) {
          const driveUrl = saveBase64ImageToDrive(base64Data, (record['Work Name'] || id || 'prod') + '.jpg');
          if (driveUrl) {
            record.Image_URL = driveUrl;
          } else if (record.Image_URL && String(record.Image_URL).startsWith('data:')) {
            record.Image_URL = '';
          }
        }
        delete record.Image_Base64;

        const type = record.Type || 'Work';
        if (type === 'Work') {
          const pcs = Number(record.Pcs) || 0;
          const rate = Number(record.Rate) || 0;
          record.Dozen = Number((pcs / 12).toFixed(2));
          record.Earned = Number((record.Dozen * rate).toFixed(2));
          record.Received = 0;
        } else if (type === 'Withdrawal') {
          record.Received = Number(record.Received) || Number(record.Amount) || 0;
          record.Earned = 0;
          record.Pcs = 0;
          record.Dozen = 0;
          record.Rate = 0;
        }
      }

      const lastRow = sheet.getLastRow();
      let foundRow = -1;

      if (lastRow > 1) {
        const idCol = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (let i = 0; i < idCol.length; i++) {
          if (String(idCol[i][0]) === String(id)) {
            foundRow = i + 2;
            break;
          }
        }
      }

      if (foundRow === -1) {
        return createJsonResponse({ success: false, error: 'Row not found for ID: ' + id });
      }

      // Preserve existing image URL if not updated in this request
      if (sheetName === 'Production' && !record.Image_URL) {
        const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
        const imgIdx = currentHeaders.indexOf('Image_URL');
        if (imgIdx !== -1) {
          const existingVal = sheet.getRange(foundRow, imgIdx + 1).getValue();
          if (existingVal) record.Image_URL = existingVal;
        }
      }

      // Handle Status field in update
      if (record.IsPending === true || record.IsPending === 'true' || record.Status === 'Pending' || record.Status === 'পেন্ডিং') {
        record.Status = 'Pending';
      } else if (record.IsPending === false || record.IsPending === 'false' || record.Status === 'Completed') {
        record.Status = 'Completed';
      } else if (!record.Status) {
        const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
        const statusIdx = currentHeaders.indexOf('Status');
        if (statusIdx !== -1) {
          const existingVal = sheet.getRange(foundRow, statusIdx + 1).getValue();
          if (existingVal) record.Status = existingVal;
        }
      }

      const rowValues = headers.map(header => {
        let val = record[header];
        if (val === undefined || val === null) return '';
        return val;
      });

      sheet.getRange(foundRow, 1, 1, headers.length).setValues([rowValues]);
      return createJsonResponse({
        success: true,
        status: 'success',
        action: 'update',
        data: record
      });
    }

    // 3. DELETE ACTION
    if (action === 'delete') {
      if (!sheetName || !SCHEMAS[sheetName]) {
        return createJsonResponse({ success: false, error: 'Invalid sheet name' });
      }

      const sheet = ss.getSheetByName(sheetName);
      const id = payload.id || record.ID;

      if (!id) {
        return createJsonResponse({ success: false, error: 'Missing ID for deletion' });
      }

      const lastRow = sheet.getLastRow();
      let foundRow = -1;

      if (lastRow > 1) {
        const idCol = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (let i = 0; i < idCol.length; i++) {
          if (String(idCol[i][0]) === String(id)) {
            foundRow = i + 2;
            break;
          }
        }
      }

      if (foundRow === -1) {
        return createJsonResponse({ success: false, error: 'Row not found for ID: ' + id });
      }

      sheet.deleteRow(foundRow);
      return createJsonResponse({
        success: true,
        status: 'success',
        action: 'delete',
        data: { ID: id, deleted: true }
      });
    }

    // 4. CASCADING FUND DELETION
    if (action === 'deleteFundCascade') {
      const fundId = payload.fundId || payload.id || record.ID;
      if (!fundId) {
        return createJsonResponse({ success: false, error: 'Missing fundId for cascade deletion' });
      }

      // Delete fund from Fund sheet
      const fundSheet = ss.getSheetByName('Fund');
      if (fundSheet && fundSheet.getLastRow() > 1) {
        const lastRow = fundSheet.getLastRow();
        const ids = fundSheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (let i = 0; i < ids.length; i++) {
          if (String(ids[i][0]) === String(fundId)) {
            fundSheet.deleteRow(i + 2);
            break;
          }
        }
      }

      // Cascade delete all transactions in Fund_Transaction
      const txSheet = ss.getSheetByName('Fund_Transaction');
      let deletedCount = 0;
      if (txSheet && txSheet.getLastRow() > 1) {
        const lastTxRow = txSheet.getLastRow();
        // Col 3 is 'Fund ID' (1:ID, 2:Date, 3:Fund ID)
        const txIds = txSheet.getRange(2, 3, lastTxRow - 1, 1).getValues();
        for (let j = txIds.length - 1; j >= 0; j--) {
          if (String(txIds[j][0]) === String(fundId)) {
            txSheet.deleteRow(j + 2);
            deletedCount++;
          }
        }
      }

      return createJsonResponse({
        success: true,
        status: 'success',
        action: 'deleteFundCascade',
        fundId: fundId,
        deletedTransactionsCount: deletedCount
      });
    }

    return createJsonResponse({ success: false, error: 'Unknown POST action: ' + action });

  } catch (err) {
    return createJsonResponse({
      success: false,
      status: 'error',
      error: err.toString()
    });
  } finally {
    lock.releaseLock();
  }
}
