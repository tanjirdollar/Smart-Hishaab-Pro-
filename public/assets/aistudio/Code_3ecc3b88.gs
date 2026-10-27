/**
 * Smart Hisab Pro — Google Apps Script backend v3 (secured)
 *
 * শুধু আপনার Vercel সার্ভার (যার কাছে SH_SECRET আছে) এই স্ক্রিপ্টে কথা বলতে পারবে।
 * - কোনো ডিফল্ট পিন নেই, কোনো রিসেট-লিংক নেই, ফাঁকা টোকেন গ্রহণযোগ্য নয়।
 * - SH_SECRET সেট করা না থাকলে সবকিছু বন্ধ (fail-closed)।
 * - ডুপ্লিকেট আইডি আটকানো, আপডেটে অন্য কলাম মুছে যাওয়া বন্ধ, লক দিয়ে একসঙ্গে লেখা নিরাপদ।
 *
 * সেটআপ: Extensions > Apps Script > এই কোড বসান > Project Settings > Script properties-এ
 * SH_SECRET যোগ করুন > Deploy > New deployment > Web app (Execute as: Me, Access: Anyone) > URL কপি করুন।
 */
const DRIVE_FOLDER_NAME = 'Smart_Hisab_Uploads';
const MAX_IMAGE_BASE64 = 7 * 1024 * 1024;

const SCHEMAS = {
  Income: ['ID', 'Date', 'Category', 'Amount', 'Note', 'Status'],
  Expense: ['ID', 'Date', 'Category', 'Amount', 'Note', 'Status'],
  Production: ['ID', 'Date', 'Type', 'Tag', 'Work Name', 'Size', 'Color', 'Pcs', 'Dozen', 'Rate', 'Earned', 'Received', 'Start Time', 'End Time', 'Duration', 'Note', 'Image_URL', 'Status'],
  Loan: ['ID', 'Date', 'Description', 'Loan Taken', 'Loan Paid', 'Note', 'Status'],
  Fund: ['ID', 'Date', 'Fund Name', 'Target Budget', 'Status'],
  Fund_Transaction: ['ID', 'Date', 'Fund ID', 'Type', 'Category/Note', 'Amount', 'Note', 'Status']
};
const NUMERIC = { Income: ['Amount'], Expense: ['Amount'], Production: ['Pcs', 'Rate', 'Received'], Loan: ['Loan Taken', 'Loan Paid'], Fund: ['Target Budget'], Fund_Transaction: ['Amount'] };
const RESULT_KEYS = { Income: 'income', Expense: 'expense', Production: 'production', Loan: 'loan', Fund: 'fund', Fund_Transaction: 'fund_transaction' };

function resolveSheetName(raw) {
  const k = String(raw || '').trim().toLowerCase().replace(/[-_ ]/g, '');
  return ({ income: 'Income', expense: 'Expense', production: 'Production', loan: 'Loan', fund: 'Fund', fundtransaction: 'Fund_Transaction', fundtransactions: 'Fund_Transaction' })[k] || null;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fail_(msg) { return json_({ success: false, status: 'error', error: msg }); }

function safeEqual_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function authorized_(secret) {
  const expected = PropertiesService.getScriptProperties().getProperty('SH_SECRET');
  if (!expected || expected.length < 16) return false; // fail-closed
  return safeEqual_(secret, expected);
}

function doGet() { return json_({ success: true, status: 'success', message: 'Smart Hisab API v3' }); }

function today_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function fmtDate_(v) { return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : v; }
function newId_() { return 'TRX-' + Utilities.getUuid().replace(/-/g, '').slice(0, 14); }

function ensureSheet_(ss, name) {
  const headers = SCHEMAS[name];
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
// শুধু অনুপস্থিত কলাম ডানদিকে যোগ করে; বিদ্যমান ডেটা কখনো সরায় না।
function headersOf_(sh, name) {
  const lastCol = Math.max(sh.getLastColumn(), 1);
  let cur = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
  while (cur.length && !cur[cur.length - 1]) cur.pop();
  SCHEMAS[name].forEach(function (h) {
    if (cur.indexOf(h) === -1) {
      sh.getRange(1, cur.length + 1).setValue(h).setFontWeight('bold');
      cur.push(h);
    }
  });
  return cur;
}
function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}
function num_(v) { const n = Number(v); return isFinite(n) ? n : NaN; }

function validate_(name, rec) {
  const cols = NUMERIC[name] || [];
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (rec[c] === undefined || rec[c] === null || rec[c] === '') continue;
    const n = num_(rec[c]);
    if (isNaN(n) || n < 0 || n > 1e10) return 'অবৈধ সংখ্যা: ' + c;
    rec[c] = n;
  }
  return null;
}
// পুরোনো ব্যাকএন্ডের সঙ্গে হুবহু একই সূত্র — মোট পাওনা/বকেয়া বদলাবে না।
function applyProduction_(rec) {
  const type = rec.Type || 'Work';
  if (type === 'Work') {
    const pcs = Number(rec.Pcs) || 0, rate = Number(rec.Rate) || 0;
    const dozen = Number((pcs / 12).toFixed(2));
    rec.Dozen = dozen; rec.Earned = Number((dozen * rate).toFixed(2)); rec.Received = 0;
  } else if (type === 'Withdrawal') {
    rec.Received = Number(rec.Received) || Number(rec.Amount) || 0;
    rec.Earned = 0; rec.Pcs = 0; rec.Dozen = 0; rec.Rate = 0;
  }
}
function normStatus_(rec, fallback) {
  if (rec.IsPending === true || rec.IsPending === 'true' || rec.Status === 'Pending' || rec.Status === 'পেন্ডিং') rec.Status = 'Pending';
  else if (rec.IsPending === false || rec.IsPending === 'false' || rec.Status === 'Completed') rec.Status = 'Completed';
  else if (!rec.Status) rec.Status = fallback || 'Completed';
  delete rec.IsPending;
}

function saveImage_(b64, fileName) {
  if (!b64 || typeof b64 !== 'string') return null;
  if (b64.length > MAX_IMAGE_BASE64) throw new Error('ছবি অনেক বড়');
  let data = b64, type = 'image/jpeg';
  const p = b64.indexOf(';base64,');
  if (p > -1) { data = b64.slice(p + 8); type = b64.slice(0, p).replace('data:', '') || type; }
  if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) throw new Error('শুধু ছবির ফাইল গ্রহণযোগ্য');
  const safe = String(fileName || ('img_' + Date.now())).replace(/[^\w\u0980-\u09FF.-]/g, '_').slice(0, 80);
  const blob = Utilities.newBlob(Utilities.base64Decode(data), type, safe.indexOf('.') > -1 ? safe : safe + '.jpg');
  const it = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(DRIVE_FOLDER_NAME);
  const file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  const id = file.getId();
  const url = 'https://drive.google.com/thumbnail?id=' + id + '&sz=s1000';
  return { fileId: id, url: url, directImageUrl: url, webViewLink: 'https://drive.google.com/file/d/' + id + '/view' };
}

function readAll_(ss) {
  const out = { income: [], expense: [], production: [], loan: [], fund: [], fund_transaction: [] };
  Object.keys(SCHEMAS).forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    const cols = sh.getLastColumn();
    const heads = sh.getRange(1, 1, 1, cols).getValues()[0];
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, cols).getValues();
    rows.forEach(function (row, i) {
      if (row[0] === '' || row[0] === null) return;
      const item = { _row: i + 2 };
      heads.forEach(function (h, c) {
        if (!h) return;
        const v = fmtDate_(row[c]);
        // একই নামের কলাম দুইবার থাকলে ফাঁকা মান যেন আসল মান মুছে না দেয়
        if (item[h] === undefined || (v !== '' && v !== null)) item[h] = v;
      });
      out[RESULT_KEYS[name]].push(item);
    });
  });
  return out;
}

function doPost(e) {
  let p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return fail_('অবৈধ অনুরোধ'); }
  if (!authorized_(p.secret)) return fail_('UNAUTHORIZED');
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const action = p.action;

    if (action === 'getAll' || action === 'init') {
      Object.keys(SCHEMAS).forEach(function (n) { ensureSheet_(ss, n); });
      return action === 'init' ? json_({ success: true, status: 'success' }) : json_({ success: true, status: 'success', data: readAll_(ss), timestamp: new Date().toISOString() });
    }
    if (action === 'uploadImage') {
      const r = saveImage_(p.imageBase64, p.fileName);
      return r ? json_(Object.assign({ success: true, status: 'success' }, r)) : fail_('ছবির ডেটা পাওয়া যায়নি');
    }

    if (action === 'deleteFundCascade') {
      const fundId = p.fundId || p.id;
      if (!fundId) return fail_('fundId প্রয়োজন');
      const fs = ensureSheet_(ss, 'Fund'), ts = ensureSheet_(ss, 'Fund_Transaction');
      const fr = findRow_(fs, fundId);
      let count = 0;
      const tHeads = headersOf_(ts, 'Fund_Transaction'), fidCol = tHeads.indexOf('Fund ID') + 1;
      for (let r = ts.getLastRow(); r >= 2; r--) {
        if (String(ts.getRange(r, fidCol).getValue()) === String(fundId)) { ts.deleteRow(r); count++; }
      }
      if (fr > -1) fs.deleteRow(fr);
      return json_({ success: true, status: 'success', fundId: fundId, deletedTransactionsCount: count });
    }

    const name = resolveSheetName(p.sheet);
    if (!name) return fail_('অজানা শিট: ' + p.sheet);
    const sh = ensureSheet_(ss, name);
    const rec = Object.assign({}, p.data || {});

    if (action === 'add' || action === 'create') {
      const bad = validate_(name, rec); if (bad) return fail_(bad);
      if (!rec.ID) rec.ID = newId_();
      if (!rec.Date) rec.Date = today_();
      if (findRow_(sh, rec.ID) > -1) return json_({ success: true, status: 'success', action: 'create', duplicate: true, data: rec }); // পুনরায় পাঠালেও দ্বিতীয় সারি হবে না
      if (name === 'Fund_Transaction') {
        if (!rec['Fund ID'] || findRow_(ensureSheet_(ss, 'Fund'), rec['Fund ID']) === -1) return fail_('ফান্ড খুঁজে পাওয়া যায়নি');
      }
      if (name === 'Production') {
        const img = p.imageBase64 || rec.Image_Base64 || (String(rec.Image_URL || '').indexOf('data:') === 0 ? rec.Image_URL : null);
        if (img) { const r = saveImage_(img, (rec['Work Name'] || rec.ID) + '.jpg'); rec.Image_URL = r ? r.directImageUrl : ''; }
        delete rec.Image_Base64;
        applyProduction_(rec);
      }
      normStatus_(rec, 'Completed');
      const heads = headersOf_(sh, name);
      const vals = heads.map(function (h) { const v = rec[h]; return (v === undefined || v === null) ? '' : v; });
      sh.getRange(sh.getLastRow() + 1, 1, 1, vals.length).setValues([vals]);
      return json_({ success: true, status: 'success', action: 'create', data: rec });
    }

    if (action === 'update') {
      const id = p.id || rec.ID;
      if (!id) return fail_('ID প্রয়োজন');
      const row = findRow_(sh, id);
      if (row === -1) return fail_('সারি পাওয়া যায়নি: ' + id);
      const bad = validate_(name, rec); if (bad) return fail_(bad);
      const heads = headersOf_(sh, name);
      const existing = sh.getRange(row, 1, 1, heads.length).getValues()[0];
      const merged = {};
      heads.forEach(function (h, i) { merged[h] = fmtDate_(existing[i]); });
      delete rec.ID; delete rec._row;
      Object.keys(rec).forEach(function (k) { if (rec[k] !== undefined && rec[k] !== null) merged[k] = rec[k]; });
      merged.ID = id;
      if (name === 'Production') {
        const img = p.imageBase64 || rec.Image_Base64 || (String(rec.Image_URL || '').indexOf('data:') === 0 ? rec.Image_URL : null);
        if (img) { const r = saveImage_(img, (merged['Work Name'] || id) + '.jpg'); if (r) merged.Image_URL = r.directImageUrl; }
        delete merged.Image_Base64;
        applyProduction_(merged);
      }
      normStatus_(merged, merged.Status || 'Completed');
      const vals = heads.map(function (h) { const v = merged[h]; return (v === undefined || v === null) ? '' : v; });
      sh.getRange(row, 1, 1, vals.length).setValues([vals]);
      return json_({ success: true, status: 'success', action: 'update', data: merged });
    }

    if (action === 'delete') {
      const id = p.id || rec.ID;
      if (!id) return fail_('ID প্রয়োজন');
      const row = findRow_(sh, id);
      if (row === -1) return fail_('সারি পাওয়া যায়নি: ' + id);
      sh.deleteRow(row);
      return json_({ success: true, status: 'success', action: 'delete', data: { ID: id, deleted: true } });
    }
    return fail_('অজানা অ্যাকশন: ' + action);
  } catch (err) {
    return fail_(String(err && err.message ? err.message : err));
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/* ===== এককালীন ব্যবহারের ফাংশন (Apps Script এডিটর থেকে নিজে চালাবেন) ===== */

/** মোট হিসাব যাচাই: লগে দেখুন (View > Logs)। ডেটা বদলায় না। */
function auditTotals() {
  const d = readAll_(SpreadsheetApp.getActiveSpreadsheet());
  const sum = function (a, k) { return a.reduce(function (s, r) { return s + (Number(r[k]) || 0); }, 0); };
  const earned = sum(d.production, 'Earned'), recv = sum(d.production, 'Received');
  Logger.log('কাজের আয়: ' + earned.toFixed(2) + ' | উত্তোলন: ' + recv.toFixed(2) + ' | মোট পাওনা: ' + (earned - recv).toFixed(2));
  Logger.log('খরচ: ' + sum(d.expense, 'Amount') + ' | ঋণ নেওয়া: ' + sum(d.loan, 'Loan Taken') + ' | ঋণ পরিশোধ: ' + sum(d.loan, 'Loan Paid'));
}

/** একই ID-র দ্বিতীয় সারিকে নতুন অনন্য ID দেয় (কোনো সারি মোছে না, মোট অঙ্ক একই থাকে) এবং ডুপ্লিকেট 'Status' কলামের হেডার পরিষ্কার করে। */
function repairData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SCHEMAS).forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    const seen = {};
    const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    ids.forEach(function (r, i) {
      const id = String(r[0]);
      if (!id) return;
      if (seen[id]) { const nid = id + '-' + (seen[id] + 1); sh.getRange(i + 2, 1).setValue(nid); Logger.log(name + ' সারি ' + (i + 2) + ': ' + id + ' → ' + nid); seen[id]++; }
      else seen[id] = 1;
    });
    const lastCol = sh.getLastColumn();
    const heads = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    const first = {};
    heads.forEach(function (h, c) {
      if (!h) return;
      if (first[h] === undefined) { first[h] = c; return; }
      // পরের একই-নামের কলামে ডেটা না থাকলেই কেবল হেডার মোছা হয়
      const rows = Math.max(sh.getLastRow() - 1, 1);
      const col = sh.getRange(2, c + 1, rows, 1).getValues().filter(function (x) { return x[0] !== ''; });
      if (!col.length) { sh.getRange(1, c + 1).clearContent(); Logger.log(name + ': ডুপ্লিকেট হেডার "' + h + '" (কলাম ' + (c + 1) + ') পরিষ্কার'); }
    });
  });
  Logger.log('সম্পন্ন।');
}
