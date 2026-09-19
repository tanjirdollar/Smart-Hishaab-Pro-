/**
 * Smart Hisab Pro - Data Engine, Mathematical Calculations & Storage
 * Neo-Fintech / Trading Terminal Dark Architecture
 */

export const STORAGE_KEY = 'smart_hisab_pro_data_v2';
export const API_CONFIG_KEY = 'smart_hisab_api_url';
export const PASSCODE_KEY = 'smart_hisab_passcode';
export const THEME_KEY = 'smart_hisab_theme';
export const DEFAULT_PASSCODE = '1234';

// Exact 6-Sheet Schemas matching Google Sheets
export const SCHEMAS = {
  income: ['ID', 'Date', 'Category', 'Amount', 'Note'],
  expense: ['ID', 'Date', 'Category', 'Amount', 'Note'],
  production: ['ID', 'Date', 'Type', 'Work Name', 'Size', 'Color', 'Pcs', 'Dozen', 'Rate', 'Earned', 'Received', 'Note', 'Image_URL'],
  loan: ['ID', 'Date', 'Description', 'Loan Taken', 'Loan Paid', 'Note'],
  fund: ['ID', 'Date', 'Fund Name', 'Target Budget', 'Status'],
  fund_transaction: ['ID', 'Date', 'Fund ID', 'Type', 'Category/Note', 'Amount', 'Note']
};

/**
 * Passcode Security Helpers
 */
export function getStoredPasscode() {
  try {
    const stored = localStorage.getItem(PASSCODE_KEY);
    if (stored && stored.trim()) return stored.trim();
    return DEFAULT_PASSCODE;
  } catch (e) {
    return DEFAULT_PASSCODE;
  }
}

export function setStoredPasscode(pin) {
  try {
    if (pin) {
      localStorage.setItem(PASSCODE_KEY, String(pin).trim());
    } else {
      localStorage.removeItem(PASSCODE_KEY);
    }
  } catch (e) {
    console.error('Failed to store passcode', e);
  }
}

export function clearStoredPasscode() {
  try {
    localStorage.removeItem(PASSCODE_KEY);
  } catch (e) {
    console.error('Failed to clear passcode', e);
  }
}

/**
 * Theme Preference Helpers (Dark / Light Mode)
 */
export function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || 'dark';
  } catch (e) {
    return 'dark';
  }
}

export function setStoredTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    console.error('Failed to store theme', e);
  }
}

// Bengali Initial Sample Data for immediate demonstration
export const INITIAL_DATA = {
  income: [
    { ID: 'TRX-101', Date: '2026-09-10', Category: 'পণ্য বিক্রি', Amount: 35000, Note: 'পাইকারি কাস্টমার ক্যাশ রিসিভ' },
    { ID: 'TRX-102', Date: '2026-09-12', Category: 'সার্ভিস চার্জ', Amount: 8500, Note: 'ডিজাইন ও সেলাই পারিশ্রমিক' },
    { ID: 'TRX-103', Date: '2026-09-15', Category: 'বকেয়া আদায়', Amount: 14200, Note: 'নিউ মার্কেট শোরুম কালেকশন' }
  ],
  expense: [
    { ID: 'TRX-201', Date: '2026-09-08', Category: 'পরিবার', Amount: 16500, Note: 'পারিবারিক মাসিক খরচ' },
    { ID: 'TRX-202', Date: '2026-09-11', Category: 'যাতায়াত', Amount: 3200, Note: 'যাতায়াত ও ভ্রমণ খরচ' },
    { ID: 'TRX-203', Date: '2026-09-14', Category: 'খাবার', Amount: 4500, Note: 'সাপ্তাহিক বাজার ও খাবার খরচ' },
    { ID: 'TRX-204', Date: '2026-09-15', Category: 'মোবাইল বিল', Amount: 800, Note: 'মোবাইল রিচার্জ' },
    { ID: 'TRX-205', Date: '2026-09-15', Category: 'ইন্টারনেট বিল', Amount: 1200, Note: 'ওয়াইফাই ইন্টারনেট বিল' }
  ],
  production: [
    {
      ID: 'TRX-301',
      Date: '2026-09-05',
      Type: 'Work',
      'Work Name': 'প্রিমিয়াম পোলো শার্ট',
      Size: 'L',
      Color: 'নেভি ব্লু',
      Pcs: 120,
      Dozen: 10,
      Rate: 650,
      Earned: 6500,
      Received: 0,
      Note: 'আল-মদিনা ফ্যাশন অর্ডার',
      Image_URL: ''
    },
    {
      ID: 'TRX-302',
      Date: '2026-09-09',
      Type: 'Work',
      'Work Name': 'ড্রপ শোল্ডার টি-শার্ট',
      Size: 'XL',
      Color: 'কালো',
      Pcs: 240,
      Dozen: 20,
      Rate: 480,
      Earned: 9600,
      Received: 0,
      Note: 'এক্সপোর্ট কোয়ালিটি লট',
      Image_URL: ''
    },
    {
      ID: 'TRX-303',
      Date: '2026-09-13',
      Type: 'Withdrawal',
      'Work Name': 'উইথড্রয়াল বিল',
      Size: '-',
      Color: '-',
      Pcs: 0,
      Dozen: 0,
      Rate: 0,
      Earned: 0,
      Received: 8000,
      Note: 'কোম্পানি থেকে কারিগর বিল ক্যাশ গ্রহণ',
      Image_URL: ''
    }
  ],
  loan: [
    { ID: 'TRX-401', Date: '2026-08-20', Description: 'ব্যাংক লোন (এসএমই)', 'Loan Taken': 50000, 'Loan Paid': 15000, Note: 'সোনালী ব্যাংক কিস্তি চলমান' },
    { ID: 'TRX-402', Date: '2026-09-02', Description: 'ব্যক্তিগত ঋণ (করিম ভাই)', 'Loan Taken': 20000, 'Loan Paid': 5000, Note: 'মেশিন মেরামতের জন্য গ্রহণ' }
  ],
  fund: [
    { ID: 'TRX-501', Date: '2026-09-01', 'Fund Name': 'ফ্যাক্টরি ইমার্জেন্সি রিজার্ভ', 'Target Budget': 50000, Status: 'Active' },
    { ID: 'TRX-502', Date: '2026-09-01', 'Fund Name': 'কারিগর ঈদ বোনাস ফান্ড', 'Target Budget': 35000, Status: 'Active' },
    { ID: 'TRX-503', Date: '2026-08-15', 'Fund Name': 'মেশিন আধুনিকায়ন সঞ্চয়', 'Target Budget': 80000, Status: 'Active' }
  ],
  fund_transaction: [
    { ID: 'TRX-601', Date: '2026-09-03', 'Fund ID': 'TRX-501', Type: 'In', 'Category/Note': 'সাপ্তাহিক উদ্বৃত্ত জমা', Amount: 15000, Note: 'নগদ ক্যাশ থেকে ফান্ডে জমা' },
    { ID: 'TRX-602', Date: '2026-09-07', 'Fund ID': 'TRX-502', Type: 'In', 'Category/Note': 'বোনাস ডিপোজিট', Amount: 12000, Note: 'প্রোডাকশন মুনাফা অংশ' },
    { ID: 'TRX-603', Date: '2026-09-12', 'Fund ID': 'TRX-501', Type: 'Out', 'Category/Note': 'জরুরি মোটর মেরামত', Amount: 2500, Note: 'ফান্ড থেকে ব্যয়' }
  ]
};

export const IMAGE_CACHE_KEY = 'smart_hisab_img_cache_v2';
export const PENDING_REGISTRY_KEY = 'smart_hisab_pending_status_v2';

/**
 * 🔒 Persistent Pending Transaction Registry
 * Ensures pending transactions remain permanently marked across refreshes,
 * device switches, and background sheet syncs without being overwritten.
 */
export function getPendingRegistry() {
  try {
    const raw = localStorage.getItem(PENDING_REGISTRY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

export function setRecordPendingStatus(id, isPending) {
  if (!id) return;
  try {
    const reg = getPendingRegistry();
    reg[String(id)] = Boolean(isPending);
    localStorage.setItem(PENDING_REGISTRY_KEY, JSON.stringify(reg));
  } catch (e) {
    console.warn('Pending registry save error:', e);
  }
}

export function getRecordPendingStatus(id) {
  if (!id) return null;
  const reg = getPendingRegistry();
  const val = reg[String(id)];
  return typeof val === 'boolean' ? val : null;
}

/**
 * Image Cache Helpers (Ensures attached photos never disappear across page reloads)
 */
export function getImageCache() {
  try {
    const raw = localStorage.getItem(IMAGE_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

export function saveImageToCache(id, urlOrBase64) {
  if (!id || !urlOrBase64) return;
  try {
    const cache = getImageCache();
    const strId = String(id);
    // If incoming is base64, always save/upgrade it
    if (typeof urlOrBase64 === 'string' && urlOrBase64.startsWith('data:image')) {
      cache[strId] = urlOrBase64;
    } else if (!cache[strId]) {
      cache[strId] = urlOrBase64;
    }
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('Image cache save error:', e);
  }
}

/**
 * Extract Google Drive file ID from various link formats
 */
export function extractDriveFileId(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  const driveMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/) || 
                     trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
                     trimmed.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/) ||
                     trimmed.match(/thumbnail\?id=([a-zA-Z0-9_-]+)/);
  return driveMatch ? driveMatch[1] : '';
}

/**
 * Generate standard web view link for opening directly in Google Drive
 */
export function getDriveViewUrl(urlOrFileId) {
  if (!urlOrFileId) return '';
  const fileId = extractDriveFileId(urlOrFileId) || urlOrFileId;
  if (fileId && !fileId.startsWith('http') && !fileId.startsWith('data:')) {
    return `https://drive.google.com/file/d/${fileId}/view`;
  }
  if (typeof urlOrFileId === 'string' && urlOrFileId.startsWith('http')) return urlOrFileId;
  return '';
}

/**
 * Format image URL with priority:
 * 1. Local high-resolution Base64 cache (instant, guaranteed offline display)
 * 2. High-reliability Google Drive thumbnail endpoint
 * 3. Raw URL / data URI fallback
 */
export function formatImageUrl(url, recordId = null) {
  const cache = getImageCache();

  // If recordId provided, check if local base64 cache exists for instant rendering
  if (recordId) {
    const cachedByRec = cache[String(recordId)];
    if (cachedByRec && cachedByRec.startsWith('data:image')) {
      return cachedByRec;
    }
  }

  if (!url) return '';
  const trimmed = String(url).trim();
  if (trimmed.startsWith('data:image')) return trimmed;

  const fileId = extractDriveFileId(trimmed);
  if (fileId) {
    // Check if cache has base64 indexed by fileId
    const cachedByFile = cache[fileId];
    if (cachedByFile && cachedByFile.startsWith('data:image')) {
      return cachedByFile;
    }
    // Universal high-reliability thumbnail endpoint with size parameter
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=s1000`;
  }

  return trimmed;
}

export function enrichProductionImages(prods) {
  const cache = getImageCache();
  if (!Array.isArray(prods)) return [];
  let cacheUpdated = false;

  const result = prods.map(p => {
    if (!p) return p;
    const id = String(p.ID || '');
    const fileId = extractDriveFileId(p.Image_URL);
    if (fileId) p.DriveFileId = fileId;

    // Check if local cache has base64 data for this record or fileId
    const localBase64 = (cache[id] && cache[id].startsWith('data:image'))
      ? cache[id]
      : (fileId && cache[fileId] && cache[fileId].startsWith('data:image') ? cache[fileId] : null);

    if (localBase64) {
      p.Image_Base64 = localBase64;
      // Do NOT overwrite localBase64 in cache with a remote URL
      if (!p.Image_URL) {
        p.Image_URL = localBase64;
      }
    } else if (p.Image_URL && p.Image_URL.startsWith('data:image')) {
      cache[id] = p.Image_URL;
      p.Image_Base64 = p.Image_URL;
      cacheUpdated = true;
    } else if (p.Image_URL && !cache[id]) {
      // Only store remote URL in cache if no base64 was ever stored
      cache[id] = p.Image_URL;
      cacheUpdated = true;
    } else if (!p.Image_URL && cache[id]) {
      p.Image_URL = cache[id];
    }
    return p;
  });

  if (cacheUpdated) {
    try {
      localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {}
  }
  return result;
}

/**
 * Relative Timestamp Indicator
 * E.g. "এইমাত্র আপডেট", "16 মি. আগে আপডেট", "2 ঘণ্টা আগে", "2 দিন আগে"
 */
export function formatRelativeTime(dateString) {
  if (!dateString) return '';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const diffMs = now - d;
    if (diffMs < 0) return 'আজ';
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'এইমাত্র আপডেট';
    if (diffMins < 60) return `${diffMins} মি. আগে আপডেট`;
    if (diffHours < 24) return `${diffHours} ঘণ্টা আগে`;
    if (diffDays === 1) return 'গতকাল';
    if (diffDays < 30) return `${diffDays} দিন আগে`;
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `${diffMonths} মাস আগে`;
    return `${Math.floor(diffDays / 365)} বছর আগে`;
  } catch (e) {
    return '';
  }
}

/**
 * Load Application State from LocalStorage
 */
export function loadLocalData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const rawProds = Array.isArray(parsed.production) ? parsed.production : [];
      return {
        income: Array.isArray(parsed.income) ? parsed.income : [],
        expense: Array.isArray(parsed.expense) ? parsed.expense : [],
        production: enrichProductionImages(rawProds),
        loan: Array.isArray(parsed.loan) ? parsed.loan : [],
        fund: Array.isArray(parsed.fund) ? parsed.fund : [],
        fund_transaction: Array.isArray(parsed.fund_transaction)
          ? parsed.fund_transaction
          : (Array.isArray(parsed.fundTransaction) ? parsed.fundTransaction : [])
      };
    }
  } catch (e) {
    console.warn('Could not parse local data:', e);
  }
  const initialCopy = JSON.parse(JSON.stringify(INITIAL_DATA));
  saveLocalData(initialCopy);
  return initialCopy;
}

/**
 * Save Application State to LocalStorage
 */
export function saveLocalData(data) {
  try {
    if (data && data.production) {
      enrichProductionImages(data.production);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save to localStorage', e);
  }
}

/**
 * Client-Side Image Compression using HTML5 Canvas
 * Max width 800px, JPEG format, ~70% quality
 * Returns Base64 Data URL string
 */
export function compressImageFile(file, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve('');
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('ইমেজ লোড করতে ব্যর্থ হয়েছে'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('ফাইল রিড করতে ব্যর্থ হয়েছে'));
    reader.readAsDataURL(file);
  });
}

/**
 * Core Mathematical Logic
 *
 * 1. Hand Cash (হাতে নগদ) = Total Income + Production Withdrawn − Total Expense − Total Loan Paid
 * 2. Company Due (কোম্পানি বকেয়া) = Total Production Earned − Total Production Withdrawn
 * 3. Remaining Loan (লোন বাকি) = Total Loan Taken − Total Loan Paid
 * 4. Total Expense (মোট খরচ) = Sum of expense records
 */
export function calculateMetrics(data) {
  const totalIncome = (data.income || []).reduce((sum, item) => sum + (Number(item.Amount) || 0), 0);

  let totalProductionEarned = 0;
  let totalProductionWithdrawn = 0;
  (data.production || []).forEach(item => {
    if (item.Type === 'Work') {
      totalProductionEarned += (Number(item.Earned) || 0);
    } else if (item.Type === 'Withdrawal') {
      totalProductionWithdrawn += (Number(item.Received) || Number(item.Amount) || 0);
    }
  });

  const totalExpense = (data.expense || []).reduce((sum, item) => sum + (Number(item.Amount) || 0), 0);

  let totalLoanTaken = 0;
  let totalLoanPaid = 0;
  (data.loan || []).forEach(item => {
    totalLoanTaken += (Number(item['Loan Taken']) || 0);
    totalLoanPaid += (Number(item['Loan Paid']) || 0);
  });

  const handCash = totalIncome + totalProductionWithdrawn - totalExpense - totalLoanPaid;
  const companyDue = totalProductionEarned - totalProductionWithdrawn;
  const remainingLoan = totalLoanTaken - totalLoanPaid;

  return {
    handCash,
    companyDue,
    remainingLoan,
    totalExpense,
    totalIncome,
    totalProductionEarned,
    totalProductionWithdrawn,
    totalLoanTaken,
    totalLoanPaid
  };
}

/**
 * Multi-Fund Balance Calculation
 * Balance = Sum(In) - Sum(Out)
 */
export function calculateFundBalances(funds, fundTransactions) {
  return (funds || []).map(f => {
    const txs = (fundTransactions || []).filter(tx => String(tx['Fund ID']) === String(f.ID));
    const totalIn = txs.filter(t => t.Type === 'In').reduce((s, t) => s + (Number(t.Amount) || 0), 0);
    const totalOut = txs.filter(t => t.Type === 'Out').reduce((s, t) => s + (Number(t.Amount) || 0), 0);
    const currentBalance = totalIn - totalOut;
    const target = Number(f['Target Budget']) || 0;
    const percent = target > 0 ? Math.min(100, Math.max(0, (currentBalance / target) * 100)) : 0;

    return {
      ...f,
      currentBalance,
      target,
      percent: Math.round(percent),
      transactionCount: txs.length
    };
  });
}

/**
 * Format Currency with Taka sign (৳) in JetBrains Mono / Space Grotesk
 */
export function formatTaka(amount) {
  const num = Number(amount) || 0;
  const isNegative = num < 0;
  const absFormatted = Math.abs(num).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return (isNegative ? '-৳' : '৳') + absFormatted;
}

export function formatNum(num) {
  return (Number(num) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
