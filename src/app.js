/**
 * Smart Hisab Pro (স্মার্ট হিসাব প্রো)
 * Neo-Fintech / Trading Terminal Edition
 * Google Sheets & Google Drive Cloud Engine
 */

import {
  loadLocalData,
  saveLocalData,
  calculateMetrics,
  calculateFundBalances,
  formatTaka,
  formatNum,
  compressImageFile,
  formatImageUrl,
  formatRelativeTime,
  saveImageToCache,
  getImageCache,
  extractDriveFileId,
  getDriveViewUrl,
  setRecordPendingStatus,
  getRecordPendingStatus,
  getStoredPasscode,
  setStoredPasscode,
  getStoredTheme,
  setStoredTheme,
  DEFAULT_PASSCODE,
  formatTime12,
  calculateTimeDuration
} from './data.js';

import {
  getActiveApiUrl,
  setActiveApiUrl,
  syncFromGoogleSheets,
  sendMutation,
  testConnection,
  updateBackendSecurityToken,
  verifyPinWithBackend,
  getAuthHeaders
} from './api.js';

import {
  initGoogleAuth,
  signInWithGoogle,
  signOutFromGoogle,
  getCurrentGoogleUser,
  getCachedAccessToken,
  setCachedAccessToken,
  ensureAccessToken,
  isEmailAuthorized,
  getAuthorizedEmails,
  saveAuthorizedEmails,
  DEFAULT_ADMIN_EMAIL,
  isDriveConnected,
  connectGoogleDrive,
  fetchDriveTokenFromServer
} from './auth.js';

import {
  uploadImageToDrive,
  getOrCreateDriveFolder,
  deleteDriveFileWithConfirmation,
  getDriveFolderUrl,
  fetchDriveImageBlob
} from './drive.js';

// Global Reactive State
let appData = loadLocalData();
let activeTab = 'dashboard';
let currentFilterRange = 'all';
let customStartDate = '';
let customEndDate = '';
let historyCategoryFilter = 'all';
let historySearchQuery = '';
let areaWaveChartInstance = null;
let editingRecord = null; // { sheet, data }
let currentCompressedImageBase64 = null;
let currentDriveUploadResult = null; // { fileId, directImageUrl, webViewLink }
let isUploadingToDrive = false;

// Production Tab Filtering State
let productionTypeFilter = 'all'; // 'all' | 'work' | 'withdrawal' | 'pending'
let productionTagFilter = 'all'; // 'all' | 'শার্ট' | 'গোলগোলা' | 'প্যান্ট' | 'কটি' | 'অন্যান্য'
let productionSearchQuery = '';
let productionDateRange = 'all'; // 'all' | 'thisMonth' | 'lastMonth' | 'today' | 'custom' | 'month'
let productionMonthFilter = ''; // e.g. '2026-09'
let productionStartDate = '';
let productionEndDate = '';

export const PRODUCTION_TAGS = ['শার্ট', 'গোলগোলা', 'প্যান্ট', 'কটি', 'অন্যান্য'];
export const TAG_ICONS = {
  'শার্ট': '👔',
  'গোলগোলা': '👕',
  'প্যান্ট': '👖',
  'কটি': '🦺',
  'অন্যান্য': '🏷️'
};
export const TAG_CLASSES = {
  'শার্ট': 'tag-shirt',
  'গোলগোলা': 'tag-golgola',
  'প্যান্ট': 'tag-pant',
  'কটি': 'tag-koti',
  'অন্যান্য': 'tag-other'
};

const BENGALI_DIGITS_MAP = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
export function toBengaliDigits(num) {
  if (num === null || num === undefined) return '';
  return String(num).replace(/[0-9]/g, d => BENGALI_DIGITS_MAP[Number(d)] || d);
}

const BENGALI_DAY_NAMES = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];

export function getBengaliDayName(dateObj) {
  if (!dateObj || isNaN(dateObj.getTime())) return '';
  return BENGALI_DAY_NAMES[dateObj.getDay()] || '';
}

export function formatBengaliTime12(hours, minutes) {
  let period = 'সকাল';
  if (hours >= 4 && hours < 12) {
    period = 'সকাল';
  } else if (hours >= 12 && hours < 15) {
    period = 'দুপুর';
  } else if (hours >= 15 && hours < 18) {
    period = 'বিকাল';
  } else if (hours >= 18 && hours < 20) {
    period = 'সন্ধ্যা';
  } else {
    period = 'রাত';
  }

  let h12 = hours % 12;
  if (h12 === 0) h12 = 12;

  const mStr = String(minutes).padStart(2, '0');
  return `${period} ${toBengaliDigits(h12)}:${toBengaliDigits(mStr)}`;
}

/**
 * Safely parse any date value into a Date object without throwing RangeError
 */
export function parseDateSafe(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const str = String(val).trim();
  if (!str) return null;
  // If YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str.substring(0, 10) + 'T00:00:00');
    if (!isNaN(d.getTime())) return d;
  }
  // If DD/MM/YYYY or DD-MM-YYYY
  const parts = str.split(/[/.-]/);
  if (parts.length === 3 && parts[2].length === 4) {
    const d = new Date(`${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}T00:00:00`);
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Safely parse any time string (24h, 12h AM/PM, Bengali digits)
 */
export function parseTimeSafe(val) {
  if (!val) return null;
  let s = String(val).trim();
  const bengaliToEng = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };
  s = s.replace(/[০-৯]/g, d => bengaliToEng[d] || d);
  const ampmMatch = s.match(/(\d{1,2}):(\d{1,2})(?::\d{1,2})?\s*(AM|PM|am|pm)?/i);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const mins = parseInt(ampmMatch[2], 10);
    const mer = (ampmMatch[3] || '').toUpperCase();
    if (mer === 'PM' && hours < 12) hours += 12;
    if (mer === 'AM' && hours === 12) hours = 0;
    return { hours, mins };
  }
  return null;
}

/**
 * Formats production start & end time with duration:
 * e.g. "শুরু - মঙ্গলবার সকাল ১০:২৫, শেষ - বুধবার সন্ধ্যা ৬:৪৫ (১ দিন ৮ ঘণ্টা ২০ মিনিট)"
 */
export function formatProductionTimeRange(p) {
  try {
    if (!p) return '';
    const rawStartTime = p['Start Time'] || p.StartTime || '';
    const rawEndTime = p['End Time'] || p.EndTime || '';
    const rawStartDate = p['Start Date'] || p.StartDate || p.Date || '';
    const rawEndDate = p['End Date'] || p.EndDate || '';

    const startT = parseTimeSafe(rawStartTime);
    const endT = parseTimeSafe(rawEndTime);

    if (!startT && !endT) {
      if (p.Duration) return `সময়কাল: ${p.Duration}`;
      return '';
    }

    let startDayName = '';
    let startDt = parseDateSafe(rawStartDate);
    if (startDt && startT) {
      startDt.setHours(startT.hours, startT.mins, 0, 0);
      startDayName = getBengaliDayName(startDt);
    } else if (startDt) {
      startDayName = getBengaliDayName(startDt);
    }

    const startPart = startT 
      ? `${startDayName ? startDayName + ' ' : ''}${formatBengaliTime12(startT.hours, startT.mins)}`
      : '';

    // If only start time is set (ongoing job)
    if (startT && !endT) {
      return `শুরু - ${startPart} (চলমান ⏳)`;
    }

    // Resolve end date
    let endDt = parseDateSafe(rawEndDate);
    if (!endDt && startDt && endT) {
      endDt = new Date(startDt.getTime());
      if (startT) {
        if (endT.hours < startT.hours || (endT.hours === startT.hours && endT.mins < startT.mins)) {
          endDt.setDate(endDt.getDate() + 1);
        }
      }
    }
    if (endDt && endT) {
      endDt.setHours(endT.hours, endT.mins, 0, 0);
    }

    let endDayName = endDt ? getBengaliDayName(endDt) : '';
    const endPart = endT 
      ? `${endDayName ? endDayName + ' ' : ''}${formatBengaliTime12(endT.hours, endT.mins)}`
      : '';

    // Calculate duration
    let durationFormatted = '';
    const durStr = String(p?.Duration || '');
    if (durStr && (durStr.includes('দিন') || durStr.includes('ঘণ্টা') || durStr.includes('মিনিট'))) {
      durationFormatted = durStr;
    } else if (startDt && endDt && endDt.getTime() >= startDt.getTime() && startT && endT) {
      const diffMs = endDt.getTime() - startDt.getTime();
      const totalMinutes = Math.floor(diffMs / (60 * 1000));
      const days = Math.floor(totalMinutes / (24 * 60));
      const remMins = totalMinutes % (24 * 60);
      const hours = Math.floor(remMins / 60);
      const mins = remMins % 60;
      const durParts = [];
      if (days > 0) durParts.push(`${toBengaliDigits(days)} দিন`);
      if (hours > 0) durParts.push(`${toBengaliDigits(hours)} ঘণ্টা`);
      if (mins > 0 || durParts.length === 0) durParts.push(`${toBengaliDigits(mins)} মিনিট`);
      durationFormatted = durParts.join(' ');
    } else if (startT && endT) {
      let totalMins = (endT.hours * 60 + endT.mins) - (startT.hours * 60 + startT.mins);
      if (totalMins < 0) totalMins += 24 * 60;
      const hours = Math.floor(totalMins / 60);
      const mins = totalMins % 60;
      const durParts = [];
      if (hours > 0) durParts.push(`${toBengaliDigits(hours)} ঘণ্টা`);
      if (mins > 0 || durParts.length === 0) durParts.push(`${toBengaliDigits(mins)} মিনিট`);
      durationFormatted = durParts.join(' ');
    }

    if (startPart && endPart) {
      return `শুরু - ${startPart}, শেষ - ${endPart}${durationFormatted ? ' (' + durationFormatted + ')' : ''}`;
    }
    if (endPart) {
      return `শেষ - ${endPart}${durationFormatted ? ' (' + durationFormatted + ')' : ''}`;
    }
    return startPart ? `শুরু - ${startPart}` : '';
  } catch (err) {
    console.warn('Error formatting production time:', err);
    return p?.Duration ? `সময়কাল: ${p.Duration}` : '';
  }
}

export function getProductionItemTag(item) {
  if (item && item.Tag) {
    const raw = String(item.Tag).trim();
    if (PRODUCTION_TAGS.includes(raw)) return raw;
    if (raw.includes('গোলগোলা') || raw.includes('গোল গলা') || raw.includes('গোল-গলা')) return 'গোলগোলা';
    if (raw.includes('শার্ট')) return 'শার্ট';
    if (raw.includes('প্যান্ট')) return 'প্যান্ট';
    if (raw.includes('কটি') || raw.includes('কোট')) return 'কটি';
    return 'অন্যান্য';
  }
  const noteStr = String(item?.Note || '');
  if (noteStr && noteStr.includes('[ট্যাগ:')) {
    const match = noteStr.match(/\[ট্যাগ:\s*([^\]]+)\]/);
    if (match && match[1]) {
      const t = match[1].trim();
      if (PRODUCTION_TAGS.includes(t)) return t;
    }
  }
  const name = String(item?.['Work Name'] || '').toLowerCase();
  if (name.includes('গোলগোলা') || name.includes('গোল গলা') || name.includes('গোল-গলা')) return 'গোলগোলা';
  if (name.includes('শার্ট') || name.includes('shirt')) return 'শার্ট';
  if (name.includes('প্যান্ট') || name.includes('pant') || name.includes('trouser')) return 'প্যান্ট';
  if (name.includes('কটি') || name.includes('koti') || name.includes('vest') || name.includes('কোটি')) return 'কটি';
  return 'অন্যান্য';
}

// Passcode & Auth Gate State
let enteredPin = '';
let isSessionUnlocked = sessionStorage.getItem('smart_hisab_unlocked') === 'true';

/**
 * Initialize on DOM Load
 */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initPasscodeGate();
  initNetworkStatus();
  initUnauthorizedListener();

  // Load persistent Google Drive token from backend (permanent cross-browser sync)
  fetchDriveTokenFromServer().then(t => {
    if (t) {
      console.log('✓ Google Drive token synchronized from backend');
      renderApp();
    }
  });

  // Initialize Google Identity & Security Gate Listener
  initGoogleAuth(
    (user, token) => {
      setStoredPasscode(DEFAULT_PASSCODE);
      isSessionUnlocked = true;
      sessionStorage.setItem('smart_hisab_unlocked', 'true');
      const screen = document.getElementById('passcodeScreen');
      if (screen) screen.style.display = 'none';
      const err = document.getElementById('passcodeError');
      if (err) err.textContent = '';
      updateHeaderUserBadge(user);
      renderApp();
      triggerBackgroundSync();
    },
    (reason, attemptedEmail) => {
      updateHeaderUserBadge(null);
      if (!isSessionUnlocked) {
        showPasscodeGate();
      }
      if (reason === 'unauthorized_email') {
        const err = document.getElementById('passcodeError');
        if (err) {
          err.innerHTML = `<span style="color: var(--red-coral);">❌ অননুমোদিত Google অ্যাকাউন্ট: <strong>${attemptedEmail}</strong>!<br>শুধুমাত্র অনুমোদিত অ্যাডমিন (<strong style="color: white;">${DEFAULT_ADMIN_EMAIL}</strong>) প্রবেশ করতে পারবে।</span>`;
        }
      }
    }
  );

  if (isSessionUnlocked) {
    const currentUser = getCurrentGoogleUser();
    if (currentUser) updateHeaderUserBadge(currentUser);
    renderApp();
    triggerBackgroundSync();
  } else {
    showPasscodeGate();
  }

  // Cross-browser & cross-device auto-sync when tab gains focus or becomes visible
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isSessionUnlocked) {
      triggerBackgroundSync();
    }
  });

  window.addEventListener('focus', () => {
    if (isSessionUnlocked) {
      triggerBackgroundSync();
    }
  });

  // Cross-tab real-time sync via BroadcastChannel
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const syncChannel = new BroadcastChannel('smart_hisab_sync_channel');
      syncChannel.onmessage = (event) => {
        if (event.data?.type === 'STATUS_UPDATED' || event.data?.type === 'DATA_MUTATED') {
          triggerBackgroundSync();
        }
      };
    } catch (e) {}
  }

  // Periodic background sync every 30 seconds
  setInterval(() => {
    if (isSessionUnlocked && document.visibilityState === 'visible') {
      triggerBackgroundSync();
    }
  }, 30000);
});

/**
 * Theme Preference Helpers (Dark / Light Mode)
 */
export function initTheme() {
  const theme = getStoredTheme();
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeToggleBtn(theme);
}

export function toggleTheme() {
  const current = getStoredTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  setStoredTheme(next);
  updateThemeToggleBtn(next);
  showToast(next === 'dark' ? '🌙 ডার্ক থিম সক্রিয়' : '☀️ লাইট থিম সক্রিয়', 'info');
}

export function updateThemeToggleBtn(theme) {
  const btn = document.getElementById('themeToggleBtn');
  if (btn) {
    btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    btn.title = theme === 'dark' ? 'লাইট মোডে পরিবর্তন করুন' : 'ডার্ক মোডে পরিবর্তন করুন';
  }
}

/**
 * 🔒 Passcode & Google Identity Security Gate System
 */
export function updateHeaderUserBadge(user) {
  const subtitle = document.getElementById('headerSubtitle');
  const badge = document.getElementById('userProfileBadge');
  const avatarContainer = document.getElementById('userAvatarContainer');
  const metaText = document.getElementById('userMetaText');

  // Greeting in Bengali, completely visible
  if (subtitle) {
    subtitle.textContent = '👋 শুভ দিন, তানজির';
  }

  // Account badge: full name next to avatar
  if (metaText) {
    metaText.textContent = 'তানজির আহমেদ ডলার';
  }

  if (avatarContainer) {
    if (user && user.photoURL) {
      avatarContainer.innerHTML = `<img src="${user.photoURL}" class="user-avatar" alt="তানজির আহমেদ ডলার" referrerpolicy="no-referrer" />`;
    } else {
      avatarContainer.innerHTML = `<span class="user-avatar-initials">তা</span>`;
    }
  }

  if (badge) {
    badge.style.display = 'inline-flex';
  }
}

export async function handleGoogleLogin() {
  const btn = document.getElementById('googleSignInBtn');
  const btnText = document.getElementById('googleBtnText');
  const err = document.getElementById('passcodeError');

  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'গুগল সাইন-ইন সংযোগ হচ্ছে...';
  if (err) err.textContent = '';

  try {
    const res = await signInWithGoogle();
    if (res && res.user) {
      setStoredPasscode(DEFAULT_PASSCODE);
      isSessionUnlocked = true;
      sessionStorage.setItem('smart_hisab_unlocked', 'true');
      const screen = document.getElementById('passcodeScreen');
      if (screen) screen.style.display = 'none';
      if (err) err.textContent = '';
      updateHeaderUserBadge(res.user);
      showToast(`✓ স্বাগতম, ${res.user.displayName || 'তানজির'}! টার্মিনাল সফলভাবে আনলক হয়েছে।`, 'success');
      renderApp();
      triggerBackgroundSync();
    }
  } catch (loginErr) {
    console.error('Google Sign-In Error:', loginErr);
    if (loginErr.code === 'auth/popup-closed-by-user') {
      if (err) err.textContent = 'সাইন-ইন উইন্ডো বন্ধ করা হয়েছে। পুনরায় চেষ্টা করুন।';
    } else if (loginErr.code === 'UNAUTHORIZED_ACCOUNT' || loginErr.message?.includes('অননুমোদিত')) {
      if (err) err.innerHTML = `<span style="color: var(--red-coral);">${loginErr.message}</span>`;
    } else {
      if (err) err.textContent = 'লগইন ত্রুটি: ' + (loginErr.message || 'আবার চেষ্টা করুন');
    }
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Google দিয়ে সাইন-ইন ও আনলক করুন';
  }
}

export async function handleGoogleLogout() {
  const ok = confirm('আপনি কি নিশ্চিত যে গুগল অ্যাকাউন্ট সাইন-আউট করতে চান? এটি টার্মিনাল সম্পূর্ণ লক করে দেবে।');
  if (!ok) return;

  try {
    await signOutFromGoogle();
    isSessionUnlocked = false;
    sessionStorage.removeItem('smart_hisab_unlocked');
    updateHeaderUserBadge(null);
    showPasscodeGate();
    showToast('গুগল অ্যাকাউন্ট সাইন-আউট ও টার্মিনাল সম্পূর্ণ লক করা হয়েছে', 'info');
  } catch (e) {
    showToast('সাইন-আউট ব্যর্থ: ' + e.message, 'error');
  }
}

function initPasscodeGate() {
  const hiddenInput = document.getElementById('hiddenPinInput');
  if (hiddenInput) {
    hiddenInput.addEventListener('input', (e) => {
      const val = e.target.value.replace(/\D/g, '');
      if (val.length <= 6) {
        enteredPin = val;
        updatePinDots();
        if (enteredPin.length >= 4) {
          verifyEnteredPin();
        }
      }
    });
  }

  // Keyboard shortcut listener for desktop PIN typing
  window.addEventListener('keydown', (e) => {
    const screen = document.getElementById('passcodeScreen');
    if (!screen || screen.style.display === 'none') return;

    if (e.key >= '0' && e.key <= '9') {
      enterKey(e.key);
    } else if (e.key === 'Backspace') {
      deleteKey();
    } else if (e.key === 'Escape' || e.key === 'c' || e.key === 'C') {
      clearKey();
    }
  });
}

export function showPasscodeGate() {
  isSessionUnlocked = false;
  sessionStorage.removeItem('smart_hisab_unlocked');
  enteredPin = '';
  updatePinDots();
  const screen = document.getElementById('passcodeScreen');
  if (screen) {
    screen.style.display = 'flex';
  }
  const quickPin = document.getElementById('quickPinSection');
  if (quickPin) {
    quickPin.style.display = 'block';
  }
  const err = document.getElementById('passcodeError');
  if (err) err.textContent = '';
}

export function lockApplication() {
  showPasscodeGate();
  showToast('টার্মিনাল সফলভাবে লক করা হয়েছে', 'info');
}

export function enterKey(digit) {
  if (enteredPin.length < 6) {
    enteredPin += digit;
    updatePinDots();
    if (enteredPin.length >= 4) {
      setTimeout(verifyEnteredPin, 100);
    }
  }
}

export function deleteKey() {
  if (enteredPin.length > 0) {
    enteredPin = enteredPin.slice(0, -1);
    updatePinDots();
    const err = document.getElementById('passcodeError');
    if (err) err.textContent = '';
  }
}

export function clearKey() {
  enteredPin = '';
  updatePinDots();
  const err = document.getElementById('passcodeError');
  if (err) err.textContent = '';
}

export function focusPhysicalPinInput() {
  const input = document.getElementById('hiddenPinInput');
  if (input) {
    input.focus();
    input.click();
  }
}

function updatePinDots() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById(`dot${i}`);
    if (dot) {
      dot.classList.toggle('filled', i < enteredPin.length);
    }
  }
}

export function emergencyResetAndUnlock() {
  setStoredPasscode(DEFAULT_PASSCODE);
  isSessionUnlocked = true;
  sessionStorage.setItem('smart_hisab_unlocked', 'true');
  const screen = document.getElementById('passcodeScreen');
  if (screen) screen.style.display = 'none';
  const err = document.getElementById('passcodeError');
  if (err) err.textContent = '';
  enteredPin = '';
  updatePinDots();
  showToast('✓ টার্মিনাল সফলভাবে আনলক হয়েছে (ডিফল্ট পিন: 1234)', 'success');
  renderApp();
  triggerBackgroundSync();
}

let isVerifyingPin = false;

async function verifyEnteredPin() {
  if (isVerifyingPin) return;
  const pinCandidate = String(enteredPin).trim();
  if (!pinCandidate || pinCandidate.length < 4) return;

  const err = document.getElementById('passcodeError');
  const localCached = getStoredPasscode();

  // Instant Check 1: Direct match with default PIN (1234) or stored passcode
  const isDirectMatch = (localCached && pinCandidate === localCached) || pinCandidate === DEFAULT_PASSCODE || pinCandidate === '1234';

  if (isDirectMatch) {
    setStoredPasscode(pinCandidate);
    isSessionUnlocked = true;
    sessionStorage.setItem('smart_hisab_unlocked', 'true');
    const screen = document.getElementById('passcodeScreen');
    if (screen) screen.style.display = 'none';
    if (err) err.textContent = '';
    enteredPin = '';
    updatePinDots();
    showToast('টার্মিনাল আনলক সম্পন্ন', 'success');
    renderApp();
    triggerBackgroundSync();
    return;
  }

  // Check 2: Verify with backend
  if (err) err.textContent = '🔄 ক্লাউড পিন যাচাই হচ্ছে...';
  isVerifyingPin = true;

  try {
    const result = await verifyPinWithBackend(pinCandidate);
    if (result && result.success) {
      setStoredPasscode(pinCandidate);
      isSessionUnlocked = true;
      sessionStorage.setItem('smart_hisab_unlocked', 'true');
      const screen = document.getElementById('passcodeScreen');
      if (screen) screen.style.display = 'none';
      if (err) err.textContent = '';
      enteredPin = '';
      updatePinDots();
      showToast('টার্মিনাল আনলক সম্পন্ন', 'success');
      renderApp();
      triggerBackgroundSync();
    } else {
      const errorMsg = (result && result.error) || 'ভুল পাসকোড! পুনরায় চেষ্টা করুন (ডিফল্ট: 1234)';
      if (err) err.textContent = '❌ ' + errorMsg;
      const card = document.getElementById('passcodeCard');
      if (card) {
        card.classList.add('shake');
        setTimeout(() => card.classList.remove('shake'), 500);
      }
      setTimeout(() => {
        enteredPin = '';
        updatePinDots();
        if (err) err.textContent = '';
      }, 900);
    }
  } catch (ex) {
    if (pinCandidate === '1234' || pinCandidate === DEFAULT_PASSCODE || (localCached && pinCandidate === localCached)) {
      setStoredPasscode(pinCandidate);
      isSessionUnlocked = true;
      sessionStorage.setItem('smart_hisab_unlocked', 'true');
      const screen = document.getElementById('passcodeScreen');
      if (screen) screen.style.display = 'none';
      if (err) err.textContent = '';
      enteredPin = '';
      updatePinDots();
      showToast('টার্মিনাল আনলক সম্পন্ন', 'success');
      renderApp();
    } else {
      if (err) err.textContent = '❌ ভুল পাসকোড! (ডিফল্ট: 1234)';
      const card = document.getElementById('passcodeCard');
      if (card) {
        card.classList.add('shake');
        setTimeout(() => card.classList.remove('shake'), 500);
      }
      setTimeout(() => {
        enteredPin = '';
        updatePinDots();
        if (err) err.textContent = '';
      }, 900);
    }
  } finally {
    isVerifyingPin = false;
  }
}

function initUnauthorizedListener() {
  window.addEventListener('smart_hisab_unauthorized', (e) => {
    const currentUser = getCurrentGoogleUser();
    const isUnlocked = isSessionUnlocked || sessionStorage.getItem('smart_hisab_unlocked') === 'true';

    if (currentUser || isUnlocked) {
      console.warn('Google Sheets token warning, keeping session unlocked for authenticated user:', currentUser?.email);
      // Auto-heal passcode to default '1234'
      setStoredPasscode(DEFAULT_PASSCODE);
      showToast('গুগল শীট সিঙ্ক নোটিস: ব্যাকএন্ড সিকিউরিটি টোকেন স্বয়ংক্রিয়ভাবে পুনর্নির্ধারণ করা হয়েছে।', 'info');
      return;
    }

    showToast('গুগল শীট অ্যাক্সেস ব্যর্থ: পাসকোড সঠিক নয়!', 'error');
    showPasscodeGate();
    const err = document.getElementById('passcodeError');
    if (err) err.textContent = 'গুগল শীট টোকেন প্রত্যাখ্যান করেছে (UNAUTHORIZED)';
  });
}

/**
 * Toast Notification System
 */
export function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span> ${message}`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

/**
 * Network Connectivity & Live Pulse Sync
 */
function initNetworkStatus() {
  window.addEventListener('online', () => {
    updateSyncStatus('live', '● LIVE SYNC');
    showToast('অনলাইন সংযোগ সক্রিয় হয়েছে', 'info');
  });
  window.addEventListener('offline', () => {
    updateSyncStatus('offline', '● অফলাইন');
    showToast('ইন্টারনেট সংযোগ বিচ্ছিন্ন, অফলাইন মোড চলছে', 'error');
  });
}

function updateSyncStatus(status, label) {
  const dot = document.getElementById('syncDot');
  const text = document.getElementById('syncText');
  if (dot) {
    dot.className = `sync-dot ${status}`;
  }
  if (text) {
    text.textContent = label;
  }
}

export function triggerManualSync() {
  updateSyncStatus('offline', '● সিঙ্ক হচ্ছে...');
  showToast('গুগল শীট থেকে ডাটা রিফ্রেশ হচ্ছে...', 'info');

  syncFromGoogleSheets().then(res => {
    if (res.success) {
      appData = res.data;
      updateSyncStatus('live', '● LIVE SYNC');
      showToast('গুগল শীট থেকে সফলভাবে সিঙ্ক সম্পন্ন!', 'success');
      renderApp();
    } else {
      updateSyncStatus('error', '● সিঙ্ক ত্রুটি');
      showToast(res.error || 'সিঙ্ক ব্যর্থ হয়েছে, লোকাল ডাটা ব্যবহৃত হচ্ছে', 'error');
    }
  });
}

function triggerBackgroundSync() {
  if (getActiveApiUrl()) {
    updateSyncStatus('offline', '● সিঙ্ক হচ্ছে...');
    syncFromGoogleSheets().then(res => {
      if (res.success) {
        appData = res.data;
        updateSyncStatus('live', '● LIVE SYNC');
        renderApp();
      } else {
        updateSyncStatus('offline', '● লোকাল মোড');
      }
    });
  } else {
    updateSyncStatus('offline', '● লোকাল মোড');
  }
}

/**
 * Date Range Filters & Aggregation
 */
export function setDateRange(range) {
  currentFilterRange = range;
  const customBox = document.getElementById('customDateInputs');
  if (customBox) {
    customBox.style.display = range === 'custom' ? 'flex' : 'none';
  }

  document.querySelectorAll('.filter-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.range === range);
  });

  renderApp();
}

export function applyCustomDates() {
  customStartDate = document.getElementById('startDateInput')?.value || '';
  customEndDate = document.getElementById('endDateInput')?.value || '';
  renderApp();
}

function isDateInRange(dateStr) {
  if (!dateStr) return true;
  const d = new Date(dateStr);
  const now = new Date();

  if (currentFilterRange === 'all') return true;

  if (currentFilterRange === 'today') {
    return d.toDateString() === now.toDateString();
  }

  if (currentFilterRange === 'thisWeek') {
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    return d >= startOfWeek && d <= now;
  }

  if (currentFilterRange === 'thisMonth') {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }

  if (currentFilterRange === 'lastMonth') {
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.getFullYear() === prevMonth.getFullYear() && d.getMonth() === prevMonth.getMonth();
  }

  if (currentFilterRange === 'custom') {
    if (customStartDate && d < new Date(customStartDate)) return false;
    if (customEndDate && d > new Date(customEndDate + 'T23:59:59')) return false;
    return true;
  }

  return true;
}

/**
 * Navigation Tab Switcher
 */
export function switchTab(tabId, filterParam = null) {
  activeTab = tabId;
  if (filterParam) {
    historyCategoryFilter = filterParam;
  }

  document.querySelectorAll('.nav-tab-btn, .mobile-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tabId);
  });

  renderApp();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function filterFromCard(targetType) {
  switchTab('history', targetType);
}

/**
 * Main App Router & View Renderer
 */
export function renderApp() {
  const container = document.getElementById('viewContainer');
  if (!container) return;

  if (activeTab === 'dashboard') {
    renderDashboardView(container);
  } else if (activeTab === 'history') {
    renderHistoryView(container);
  } else if (activeTab === 'production') {
    renderProductionView(container);
  } else if (activeTab === 'loan') {
    renderLoanView(container);
  } else if (activeTab === 'fund') {
    renderFundView(container);
  } else if (activeTab === 'settings') {
    renderSettingsView(container);
  }
}

/**
 * 1. DASHBOARD VIEW (NEO-FINTECH TERMINAL)
 */
function renderDashboardView(container) {
  const metrics = calculateMetrics(appData);

  container.innerHTML = `
    <!-- 4 Connected Stat Cards -->
    <div class="stat-cards-grid">
      <!-- Card 1: Hand Cash -->
      <div class="terminal-card stat-card handcash interactive" onclick="window.SmartHisab.filterFromCard('cashflow')" title="ক্লিক করে ক্যাশফ্লো লেনদেন হিস্ট্রি দেখুন">
        <div class="stat-header">
          <span class="stat-title">
            হাতে নগদ (Hand Cash)
          </span>
          <span style="color: var(--green-electric); font-size: 1.1rem;">💵</span>
        </div>
        <div class="stat-value ${metrics.handCash < 0 ? 'text-red-500' : ''}">${formatTaka(metrics.handCash)}</div>
        <div class="stat-footer">
          <span>আয় + উইথড্রয়াল − খরচ − লোন পেইড</span>
          <span class="filter-hint">হিস্ট্রি দেখুন →</span>
        </div>
      </div>

      <!-- Card 2: Company Due -->
      <div class="terminal-card stat-card companydue interactive" onclick="window.SmartHisab.switchTab('production')" title="ক্লিক করে প্রোডাকশন খাতা দেখুন">
        <div class="stat-header">
          <span class="stat-title">
            কোম্পানি বকেয়া (Company Due)
          </span>
          <span style="color: var(--cyan-cyber); font-size: 1.1rem;">🏭</span>
        </div>
        <div class="stat-value">${formatTaka(metrics.companyDue)}</div>
        <div class="stat-footer">
          <span>মোট আর্নড − মোট উইথড্রয়াল</span>
          <span class="filter-hint">প্রোডাকশন দেখুন →</span>
        </div>
      </div>

      <!-- Card 3: Remaining Loan -->
      <div class="terminal-card stat-card loan interactive" onclick="window.SmartHisab.switchTab('loan')" title="ক্লিক করে লোন ট্র্যাকার দেখুন">
        <div class="stat-header">
          <span class="stat-title">
            লোন বাকি (Remaining Loan)
          </span>
          <span style="color: #FB923C; font-size: 1.1rem;">🤝</span>
        </div>
        <div class="stat-value">${formatTaka(metrics.remainingLoan)}</div>
        <div class="stat-footer">
          <span>গৃহীত ঋণ − মোট পরিশোধ</span>
          <span class="filter-hint">লোন দেখুন →</span>
        </div>
      </div>

      <!-- Card 4: Total Expense -->
      <div class="terminal-card stat-card expense interactive" onclick="window.SmartHisab.filterFromCard('expense')" title="ক্লিক করে খরচের বিস্তারিত হিস্ট্রি দেখুন">
        <div class="stat-header">
          <span class="stat-title">
            মোট খরচ (Total Expense)
          </span>
          <span style="color: var(--red-coral); font-size: 1.1rem;">📉</span>
        </div>
        <div class="stat-value">${formatTaka(metrics.totalExpense)}</div>
        <div class="stat-footer">
          <span>সকল ব্যয়ের সামগ্রিক হিসাব</span>
          <span class="filter-hint">খরচ দেখুন →</span>
        </div>
      </div>
    </div>

    <!-- TradingView Area Wave Chart -->
    <div class="terminal-card chart-container-card">
      <div class="chart-header">
        <div class="chart-title">
          ট্রেডিং টার্মিনাল ক্যাশফ্লো ও আর্নিং ট্রেন্ড (TradingView Sparkline)
        </div>
        <div style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-dim); display: flex; gap: 12px;">
          <span style="color: var(--green-electric);">● আয় (Income)</span>
          <span style="color: var(--cyan-cyber);">● প্রোডাকশন (Earned)</span>
          <span style="color: var(--red-coral);">● খরচ (Expense)</span>
        </div>
      </div>
      <div class="chart-wrapper">
        <canvas id="areaWaveChart"></canvas>
      </div>
    </div>

    <!-- Secondary Grid: Recent Feed & Quick Stats (100% Mobile-Fluid) -->
    <div class="dashboard-grid-2">
      <!-- Recent Transactions Feed -->
      <div class="terminal-card" style="padding: 16px 14px; min-width: 0;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; gap: 8px;">
          <h3 style="font-size: 0.95rem; font-weight: 700; color: var(--text-pure); display: flex; align-items: center; gap: 6px; white-space: nowrap;">
            সাম্প্রতিক লেনদেন
          </h3>
          <button type="button" class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.74rem; white-space: nowrap;" onclick="window.SmartHisab.switchTab('history')">
            সকল লেনদেন →
          </button>
        </div>
        ${renderRecentTransactionsTable()}
      </div>

      <!-- Quick Action Summary Card -->
      <div class="terminal-card" style="padding: 16px 14px; min-width: 0;">
        <h3 style="font-size: 0.95rem; font-weight: 700; color: var(--text-pure); margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
          হিসাব সারসংক্ষেপ
        </h3>

        <div style="display: flex; flex-direction: column; gap: 10px; font-size: 0.84rem;">
          <div class="summary-metric-row">
            <span class="summary-metric-label">মোট প্রাপ্ত আয়:</span>
            <span class="summary-metric-value" style="color: var(--green-electric);">${formatTaka(metrics.totalIncome)}</span>
          </div>
          <div class="summary-metric-row">
            <span class="summary-metric-label">প্রোডাকশন আর্নড:</span>
            <span class="summary-metric-value" style="color: var(--cyan-cyber);">${formatTaka(metrics.totalProductionEarned)}</span>
          </div>
          <div class="summary-metric-row">
            <span class="summary-metric-label">উত্তোলন গ্রহণ:</span>
            <span class="summary-metric-value" style="color: var(--gold-neon);">${formatTaka(metrics.totalProductionWithdrawn)}</span>
          </div>
          <div class="summary-metric-row">
            <span class="summary-metric-label">লোন পরিশোধকৃত:</span>
            <span class="summary-metric-value" style="color: #FB923C;">${formatTaka(metrics.totalLoanPaid)}</span>
          </div>
          <div class="summary-metric-row" style="border-bottom: none; padding-top: 4px;">
            <span class="summary-metric-label" style="color: var(--text-pure); font-weight: 700;">হাতে প্রকৃত উদ্বৃত্ত:</span>
            <span class="summary-metric-value" style="color: var(--green-electric); font-size: 1.05rem;">${formatTaka(metrics.handCash)}</span>
          </div>
        </div>
      </div>
    </div>
  `;

  setTimeout(renderAreaWaveChart, 60);
}

function renderRecentTransactionsTable() {
  const combined = [];
  (appData.income || []).forEach(i => combined.push({ ...i, _sheet: 'income', _typeBadge: 'badge-income', _label: 'আয়' }));
  (appData.expense || []).forEach(e => combined.push({ ...e, _sheet: 'expense', _typeBadge: 'badge-expense', _label: 'খরচ' }));
  (appData.production || []).forEach(p => combined.push({
    ...p,
    _sheet: 'production',
    _typeBadge: p.Type === 'Work' ? 'badge-work' : 'badge-withdrawal',
    _label: p.Type === 'Work' ? 'মজুরি' : 'উত্তোলন',
    Amount: p.Type === 'Work' ? p.Earned : (p.Received || p.Amount),
    Category: p['Work Name']
  }));

  combined.sort((a, b) => new Date(b.Date || 0) - new Date(a.Date || 0));
  const recents = combined.slice(0, 5);

  if (recents.length === 0) {
    return `<div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 0.85rem;">কোনো লেনদেন রেকর্ড পাওয়া যায়নি।</div>`;
  }

  return `
    <div class="recent-tx-feed">
      ${recents.map(item => {
        const isPositive = item._sheet === 'income' || item.Type === 'Work';
        const dateSub = item.Date ? item.Date.substring(5) : '';
        const titleText = item.Category || item.Description || item.Note || '-';
        const isPending = Boolean(item.IsPending || item.Status === 'Pending');
        return `
          <div class="recent-tx-row ${isPending ? 'is-pending' : ''}" onclick="window.SmartHisab.openRecordDetailModal('${item._sheet}', '${item.ID}')" title="বিস্তারিত দেখতে ট্যাপ করুন">
            <div class="recent-tx-left">
              <span class="recent-tx-date font-mono">${dateSub}</span>
              <span class="badge-term ${item._typeBadge}" style="font-size: 0.68rem; padding: 1px 5px;">${item._label}</span>
              ${isPending ? `<span class="badge-term badge-pending" style="font-size: 0.68rem; padding: 1px 5px;">পেন্ডিং</span>` : ''}
              <span class="recent-tx-desc">${titleText}</span>
            </div>
            <div class="recent-tx-right">
              <span class="recent-tx-amount font-mono" style="color: ${isPositive ? 'var(--green-electric)' : 'var(--red-coral)'};">
                ${isPositive ? '+' : '-'}${formatTaka(item.Amount || 0)}
              </span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/**
 * Render TradingView Style Sparkline Wave Chart (Chart.js)
 */
function renderAreaWaveChart() {
  const canvas = document.getElementById('areaWaveChart');
  if (!canvas || typeof Chart === 'undefined') return;

  if (areaWaveChartInstance) {
    areaWaveChartInstance.destroy();
  }

  // Aggregate monthly amounts for last 6 months
  const months = [];
  const incomeSeries = [];
  const expenseSeries = [];
  const earnedSeries = [];

  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthKey = d.toLocaleString('en-US', { month: 'short' });
    months.push(monthKey);

    const mIncome = (appData.income || []).filter(item => {
      const id = new Date(item.Date);
      return id.getFullYear() === d.getFullYear() && id.getMonth() === d.getMonth();
    }).reduce((s, item) => s + (Number(item.Amount) || 0), 0);

    const mExpense = (appData.expense || []).filter(item => {
      const ed = new Date(item.Date);
      return ed.getFullYear() === d.getFullYear() && ed.getMonth() === d.getMonth();
    }).reduce((s, item) => s + (Number(item.Amount) || 0), 0);

    const mEarned = (appData.production || []).filter(item => {
      const pd = new Date(item.Date);
      return item.Type === 'Work' && pd.getFullYear() === d.getFullYear() && pd.getMonth() === d.getMonth();
    }).reduce((s, item) => s + (Number(item.Earned) || 0), 0);

    incomeSeries.push(mIncome);
    expenseSeries.push(mExpense);
    earnedSeries.push(mEarned);
  }

  const ctx = canvas.getContext('2d');

  // Green gradient for Income
  const greenGrad = ctx.createLinearGradient(0, 0, 0, 240);
  greenGrad.addColorStop(0, 'rgba(0, 242, 157, 0.35)');
  greenGrad.addColorStop(1, 'rgba(0, 242, 157, 0.0)');

  // Red gradient for Expense
  const redGrad = ctx.createLinearGradient(0, 0, 0, 240);
  redGrad.addColorStop(0, 'rgba(255, 59, 105, 0.35)');
  redGrad.addColorStop(1, 'rgba(255, 59, 105, 0.0)');

  // Cyan gradient for Production
  const cyanGrad = ctx.createLinearGradient(0, 0, 0, 240);
  cyanGrad.addColorStop(0, 'rgba(0, 210, 255, 0.35)');
  cyanGrad.addColorStop(1, 'rgba(0, 210, 255, 0.0)');

  areaWaveChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels: months,
      datasets: [
        {
          label: 'আয় (Income)',
          data: incomeSeries,
          borderColor: '#00F29D',
          borderWidth: 2.2,
          backgroundColor: greenGrad,
          fill: true,
          tension: 0.38,
          pointRadius: 4,
          pointBackgroundColor: '#00F29D',
          pointHoverRadius: 6
        },
        {
          label: 'প্রোডাকশন (Earned)',
          data: earnedSeries,
          borderColor: '#00D2FF',
          borderWidth: 2,
          backgroundColor: cyanGrad,
          fill: true,
          tension: 0.38,
          pointRadius: 4,
          pointBackgroundColor: '#00D2FF',
          pointHoverRadius: 6
        },
        {
          label: 'খরচ (Expense)',
          data: expenseSeries,
          borderColor: '#FF3B69',
          borderWidth: 2,
          backgroundColor: redGrad,
          fill: true,
          tension: 0.38,
          pointRadius: 4,
          pointBackgroundColor: '#FF3B69',
          pointHoverRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(8, 11, 16, 0.94)',
          titleFont: { family: 'JetBrains Mono', size: 12 },
          bodyFont: { family: 'JetBrains Mono', size: 12 },
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: function (ctx) {
              return ` ${ctx.dataset.label}: ৳${Number(ctx.raw).toLocaleString('en-IN')}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.04)'
          },
          ticks: {
            color: '#8E9BAE',
            font: { family: 'JetBrains Mono', size: 11 }
          }
        },
        y: {
          grid: {
            color: 'rgba(255, 255, 255, 0.04)'
          },
          ticks: {
            color: '#8E9BAE',
            font: { family: 'JetBrains Mono', size: 11 },
            callback: function (val) {
              return '৳' + Number(val).toLocaleString('en-IN');
            }
          }
        }
      }
    }
  });
}

/**
 * Helper: Format Date as DD Mon DayName (e.g. 15 Sep • Tue / মঙ্গল)
 */
export function formatHistoryDate(dateStr) {
  if (!dateStr) return { dateNum: '--', dayName: '--', full: '--' };
  try {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) {
      return { dateNum: dateStr, dayName: '', full: dateStr };
    }
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const daysEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const daysBn = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি'];
    const day = d.getDate();
    const mon = months[d.getMonth()];
    const dayName = daysBn[d.getDay()] || daysEn[d.getDay()];
    return {
      dateNum: `${day < 10 ? '0' + day : day} ${mon}`,
      dayName: dayName,
      full: `${day} ${mon} ${d.getFullYear()} (${dayName}বার)`
    };
  } catch (e) {
    return { dateNum: dateStr, dayName: '', full: dateStr };
  }
}

/**
 * Helper: Format Date as DD Mon DayName in Bengali (e.g. ২০ সেপ্টেম্বর ২০২৬)
 */
export function formatBengaliDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    const monthsBn = [
      'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
      'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'
    ];
    const enToBnDigits = {
      '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪',
      '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯'
    };
    const toBn = num => String(num).replace(/\d/g, d => enToBnDigits[d] || d);
    return `${toBn(d.getDate())} ${monthsBn[d.getMonth()]} ${toBn(d.getFullYear())}`;
  } catch (e) {
    return dateStr;
  }
}

/**
 * Helper: Aggregate and filter History data
 */
function getHistoryFilteredData() {
  let list = [];

  // 1. Production Records (Work / Wage & Withdrawals)
  (appData.production || []).forEach(p => {
    const isWork = p.Type === 'Work';
    list.push({
      ...p,
      _sheet: 'production',
      _type: isWork ? 'wage' : 'withdrawal',
      _badge: isWork ? 'badge-work' : 'badge-withdrawal',
      _label: isWork ? 'মজুরি' : 'উত্তোলন',
      Wage: isWork ? (Number(p.Earned) || 0) : 0,
      Withdrawn: isWork ? 0 : (Number(p.Received) || Number(p.Amount) || 0),
      WorkName: p['Work Name'] || (isWork ? 'পোশাক মজুরি' : 'বিল উত্তোলন'),
      Category: p['Work Name'],
      Size: p.Size || '-',
      Color: p.Color || '-',
      Pcs: Number(p.Pcs) || 0,
      Dozen: Number(p.Dozen) || 0,
      Rate: Number(p.Rate) || 0,
      Tag: p.Tag || getProductionItemTag(p),
      Artisan: p.Artisan || '',
      'Start Time': p['Start Time'] || p.StartTime || '',
      'End Time': p['End Time'] || p.EndTime || '',
      'Start Date': p['Start Date'] || p.StartDate || '',
      'End Date': p['End Date'] || p.EndDate || '',
      Duration: p.Duration || '',
      Note: p.Note || '',
      Image_URL: p.Image_URL || p.Image_Base64 || '',
      Image_Base64: p.Image_Base64 || null
    });
  });

  // 2. General Income
  (appData.income || []).forEach(i => list.push({
    ...i,
    _sheet: 'income',
    _type: 'income',
    _badge: 'badge-income',
    _label: 'আয়',
    Wage: Number(i.Amount) || 0,
    Withdrawn: 0,
    WorkName: i.Category || 'সাধারণ আয়',
    Category: i.Category,
    Account: i.Account || i['Payment Method'] || '',
    Note: i.Note || '',
    Image_URL: ''
  }));

  // 3. General Expense
  (appData.expense || []).forEach(e => list.push({
    ...e,
    _sheet: 'expense',
    _type: 'expense',
    _badge: 'badge-expense',
    _label: 'খরচ',
    Wage: 0,
    Withdrawn: Number(e.Amount) || 0,
    WorkName: e.Category || 'সাধারণ খরচ',
    Category: e.Category,
    Account: e.Account || e['Payment Method'] || '',
    Note: e.Note || '',
    Image_URL: ''
  }));

  // 4. Loan Records
  (appData.loan || []).forEach(l => {
    const isPaid = (Number(l['Loan Paid']) || 0) > 0;
    list.push({
      ...l,
      _sheet: 'loan',
      _type: 'loan',
      _badge: 'badge-loan',
      _label: isPaid ? 'লোন পরিশোধ' : 'লোন গ্রহণ',
      Wage: Number(l['Loan Paid']) || 0,
      Withdrawn: Number(l['Loan Taken']) || 0,
      WorkName: l.Description || 'লোন লেনদেন',
      Category: l.Description,
      Person: l.Person || l.Name || '',
      Note: l.Note || '',
      Image_URL: ''
    });
  });

  // 5. Fund Transactions
  (appData.fund_transaction || []).forEach(ft => list.push({
    ...ft,
    _sheet: 'fund_transaction',
    _type: 'fund',
    _badge: 'badge-fund',
    _label: ft.Type === 'In' ? 'ফান্ড জমা' : 'ফান্ড ব্যয়',
    Wage: ft.Type === 'In' ? (Number(ft.Amount) || 0) : 0,
    Withdrawn: ft.Type === 'Out' ? (Number(ft.Amount) || 0) : 0,
    WorkName: ft['Category/Note'] || ft.Note || 'ফান্ড লেনদেন',
    Category: ft['Category/Note'] || ft.Note,
    FundName: ft.Fund || ft.FundName || '',
    Note: ft.Note || '',
    Image_URL: ''
  }));

  // Count total pending items
  const pendingCount = list.filter(item => Boolean(item.IsPending || item.Status === 'Pending')).length;

  // Persistent Filter Logic
  if (historyCategoryFilter === 'wage') {
    list = list.filter(item => item._type === 'wage');
  } else if (historyCategoryFilter === 'withdrawal') {
    list = list.filter(item => item._type === 'withdrawal');
  } else if (historyCategoryFilter === 'income') {
    list = list.filter(item => item._type === 'income');
  } else if (historyCategoryFilter === 'expense') {
    list = list.filter(item => item._type === 'expense');
  } else if (historyCategoryFilter === 'loan') {
    list = list.filter(item => item._type === 'loan');
  } else if (historyCategoryFilter === 'pending') {
    list = list.filter(item => Boolean(item.IsPending || item.Status === 'Pending'));
  } else if (historyCategoryFilter !== 'all') {
    list = list.filter(item => item._type === historyCategoryFilter);
  }

  // Date Range Filter
  list = list.filter(item => isDateInRange(item.Date));

  // Search Filter
  if (historySearchQuery && historySearchQuery.trim()) {
    const q = historySearchQuery.trim().toLowerCase();
    list = list.filter(item =>
      String(item.WorkName || '').toLowerCase().includes(q) ||
      String(item.Category || '').toLowerCase().includes(q) ||
      String(item.Note || '').toLowerCase().includes(q) ||
      String(item.ID || '').toLowerCase().includes(q) ||
      String(item.Color || '').toLowerCase().includes(q) ||
      String(item.Size || '').toLowerCase().includes(q) ||
      String(item.Tag || '').toLowerCase().includes(q) ||
      String(item.Artisan || '').toLowerCase().includes(q)
    );
  }

  // Sort Descending by Date
  list.sort((a, b) => new Date(b.Date || 0) - new Date(a.Date || 0));

  return { list, pendingCount };
}

/**
 * Render individual history cards displaying ALL details clearly
 */
function renderHistoryCardsHtml(list) {
  if (list.length === 0) {
    return `
      <div class="terminal-card" style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
        <div style="font-size: 2rem; margin-bottom: 8px;">📑</div>
        কোনো লেনদেন রেকর্ড পাওয়া যায়নি।
      </div>
    `;
  }

  return list.map(item => {
    const dateObj = formatHistoryDate(item.Date);
    const hasImg = Boolean(item.Image_URL || item.Image_Base64);
    const imgSrc = item.Image_Base64 || item.Image_URL || '';
    const formattedImg = formatImageUrl(imgSrc, item.ID);
    const driveFileId = extractDriveFileId(item.Image_URL) || item.DriveFileId || '';
    const relativeTime = formatRelativeTime(item.UpdatedAt || item.Date);
    const isPending = Boolean(item.IsPending || item.Status === 'Pending');

    // Bengali Day for Date chip
    let dayOfWeekStr = '';
    if (item.Date) {
      const dt = parseDateSafe(item.Date);
      if (dt) {
        const shortDays = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি'];
        dayOfWeekStr = shortDays[dt.getDay()] || '';
      }
    }

    const isProduction = item._sheet === 'production';
    const isWork = isProduction && item._type === 'wage';

    // Tags & Timings for production
    const tag = isProduction ? (item.Tag || getProductionItemTag(item)) : '';
    const tagIcon = tag ? (TAG_ICONS[tag] || '🏷️') : '';
    const tagClass = tag ? (TAG_CLASSES[tag] || 'tag-other') : '';
    const timeRangeStr = isProduction ? formatProductionTimeRange(item) : '';

    return `
      <div class="history-card-redesigned ${isPending ? 'is-pending' : ''}" onclick="window.SmartHisab.openRecordDetailModal('${item._sheet}', '${item.ID}')" title="সম্পূর্ণ বিবরণ দেখতে ট্যাপ করুন">
        
        <!-- Header Row: Date Chip, Tag / Category Pill, Type Badge, Meta chips & Large Net Amount -->
        <div class="prod-card-header">
          <div class="prod-tags-group">
            <span class="prod-date-chip" title="${dateObj.full}">
              📅 ${dateObj.dateNum}${dayOfWeekStr ? ' • ' + dayOfWeekStr : ''}
            </span>
            ${tag ? `
              <span class="prod-tag-pill ${tagClass}" title="ক্যাটাগরি ট্যাগ">
                ${tagIcon} ${tag}
              </span>
            ` : ''}
            <span class="badge-term ${item._badge} prod-badge">
              ${item._label}
            </span>
            ${item.Artisan ? `
              <span class="prod-artisan-chip" title="কারিগর">👤 ${item.Artisan}</span>
            ` : ''}
            ${item.Account ? `
              <span class="badge-term badge-fund" style="font-size: 0.68rem;" title="একাউন্ট">💳 ${item.Account}</span>
            ` : ''}
            ${item.Person ? `
              <span class="prod-artisan-chip" title="ব্যক্তি / প্রতিষ্ঠান">🤝 ${item.Person}</span>
            ` : ''}
            ${item.FundName ? `
              <span class="badge-term badge-fund" style="font-size: 0.68rem;" title="ফান্ড">💰 ${item.FundName}</span>
            ` : ''}
            ${isPending ? `
              <span class="prod-pending-chip">⏳ পেন্ডিং</span>
            ` : ''}
          </div>

          <div class="prod-line-1-right">
            ${item.Wage > 0 ? `
              <span class="prod-amount-earned font-mono">+${formatTaka(item.Wage)}</span>
            ` : ''}
            ${item.Withdrawn > 0 ? `
              <span class="prod-amount-withdrawn font-mono">-${formatTaka(item.Withdrawn)}</span>
            ` : ''}
            ${item.Wage === 0 && item.Withdrawn === 0 ? `
              <span class="prod-amount-zero font-mono">৳০</span>
            ` : ''}
          </div>
        </div>

        <!-- Body Row: Left Thumbnail + Right Work / Transaction Details -->
        <div class="prod-card-body">
          <div class="prod-photo-side" onclick="event.stopPropagation(); window.SmartHisab.openImagePreview('${formattedImg}', '${(item.WorkName || 'ছবি').replace(/'/g, "\\'")}', '${item.Image_URL || ''}')" title="${hasImg ? 'বড় করে ছবি দেখুন' : ''}">
            ${hasImg ? `
              <img src="${formattedImg}" 
                   data-file-id="${driveFileId}" 
                   data-record-id="${item.ID}" 
                   data-original-src="${item.Image_URL || ''}" 
                   class="prod-photo-img" 
                   alt="ছবি" 
                   loading="lazy" 
                   referrerpolicy="no-referrer" 
                   onerror="window.SmartHisab.handleImageError(this, '${driveFileId}', '${item.ID}')" />
              <span class="prod-photo-zoom-hint" title="বড় করে দেখুন">🔍</span>
            ` : `
              <div class="prod-photo-placeholder">
                <span class="prod-photo-icon">${isWork ? (tagIcon || '🏭') : item._type === 'withdrawal' ? '💸' : item._type === 'income' ? '📈' : item._type === 'expense' ? '📉' : item._type === 'loan' ? '🤝' : '💰'}</span>
              </div>
            `}
          </div>

          <div class="prod-main-info">
            <div class="prod-work-title">
              ${item.WorkName}
            </div>

            ${isWork ? `
              <div class="prod-metrics-grid">
                <span class="prod-metric-item">
                  <span class="metric-lbl">পরিমাণ:</span> <strong>${toBengaliDigits(item.Pcs || 0)} pcs</strong> (${toBengaliDigits(item.Dozen || 0)} ডজন)
                </span>
                <span class="prod-metric-item">
                  <span class="metric-lbl">দর:</span> <strong>৳${toBengaliDigits(item.Rate || 0)}</strong>/ডজন
                </span>
                ${item.Size && item.Size !== '-' ? `
                  <span class="prod-metric-item">
                    <span class="metric-lbl">সাইজ:</span> <strong>${item.Size}</strong>
                  </span>
                ` : ''}
                ${item.Color && item.Color !== '-' ? `
                  <span class="prod-metric-item">
                    <span class="metric-lbl">কালার:</span> <strong>${item.Color}</strong>
                  </span>
                ` : ''}
              </div>
            ` : isProduction ? `
              <div style="font-size: 0.8rem; color: var(--text-muted); font-family: var(--font-bangla);">
                কারিগর বিল ক্যাশ গ্রহণ / উত্তোলন
              </div>
            ` : `
              <div style="font-size: 0.8rem; color: var(--text-muted); font-family: var(--font-bangla);">
                ${item.Category ? `খাত: ${item.Category}` : ''}${item.Account ? ` • মাধ্যম: ${item.Account}` : ''}${item.Person ? ` • ব্যক্তি: ${item.Person}` : ''}
              </div>
            `}
          </div>
        </div>

        <!-- Dedicated Timing Banner (Always displayed when start/end times exist) -->
        ${timeRangeStr ? `
          <div class="prod-time-banner">
            <span class="prod-time-icon">⏱️</span>
            <span class="prod-time-text">${timeRangeStr}</span>
          </div>
        ` : ''}

        <!-- Footer: Full Note Box & Relative Update Time -->
        ${(item.Note || relativeTime) ? `
          <div class="prod-card-footer">
            ${item.Note ? `
              <div class="prod-note-box">
                <span>📝</span> ${item.Note}
              </div>
            ` : '<div></div>'}
            ${relativeTime ? `
              <div class="prod-rel-time" title="সর্বশেষ আপডেট">আপডেট: ${relativeTime}</div>
            ` : ''}
          </div>
        ` : ''}

      </div>
    `;
  }).join('');
}

/**
 * 2. TRANSACTION HISTORY & LEDGER VIEW (SIMPLIFIED & RESPONSIVE)
 */
function renderHistoryView(container) {
  const { list, pendingCount } = getHistoryFilteredData();

  container.innerHTML = `
    <!-- Top Filter & Search Bar -->
    <div class="terminal-card filter-bar" style="margin-bottom: 16px;">
      <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">
        <button type="button" class="filter-pill ${historyCategoryFilter === 'all' ? 'active' : ''}" onclick="window.SmartHisab.setHistoryFilter('all')">সব লেজার</button>
        <button type="button" class="filter-pill ${historyCategoryFilter === 'pending' ? 'active' : ''}" style="${historyCategoryFilter === 'pending' ? 'background: #F59E0B; color: #000; border-color: #F59E0B;' : 'color: #F59E0B; border-color: rgba(245,158,11,0.4);'}" onclick="window.SmartHisab.setHistoryFilter('pending')">⏳ পেন্ডিং (${pendingCount})</button>
        <button type="button" class="filter-pill ${historyCategoryFilter === 'wage' ? 'active' : ''}" onclick="window.SmartHisab.setHistoryFilter('wage')">মজুরি</button>
        <button type="button" class="filter-pill ${historyCategoryFilter === 'withdrawal' ? 'active' : ''}" onclick="window.SmartHisab.setHistoryFilter('withdrawal')">উত্তোলন</button>
        <button type="button" class="filter-pill ${historyCategoryFilter === 'income' ? 'active' : ''}" onclick="window.SmartHisab.setHistoryFilter('income')">আয়</button>
        <button type="button" class="filter-pill ${historyCategoryFilter === 'expense' ? 'active' : ''}" onclick="window.SmartHisab.setHistoryFilter('expense')">খরচ</button>
      </div>

      <div style="position: relative; flex: 1; max-width: 380px; min-width: 180px;">
        <input type="text" id="historySearchInput" class="terminal-input" placeholder="🔍 কাজের নাম, নোট, আইডি..." value="${historySearchQuery}" oninput="window.SmartHisab.onHistorySearchInput(this.value)" style="width: 100%; padding-right: 28px;" />
        <button type="button" id="historySearchClearBtn" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; color: var(--text-dim); cursor: pointer; display: ${historySearchQuery ? 'inline-flex' : 'none'}; font-size: 0.9rem;" onclick="window.SmartHisab.clearHistorySearch()">✕</button>
      </div>
    </div>

    <!-- Simplified Responsive Ledger List -->
    <div class="ledger-list" id="historyLedgerList">
      ${renderHistoryCardsHtml(list)}
    </div>
  `;
}

export function onHistorySearchInput(val) {
  historySearchQuery = val;
  const clearBtn = document.getElementById('historySearchClearBtn');
  if (clearBtn) clearBtn.style.display = val ? 'inline-flex' : 'none';

  const listContainer = document.getElementById('historyLedgerList');
  if (listContainer) {
    const { list } = getHistoryFilteredData();
    listContainer.innerHTML = renderHistoryCardsHtml(list);
  }
}

export function clearHistorySearch() {
  historySearchQuery = '';
  const searchInput = document.getElementById('historySearchInput');
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }
  const clearBtn = document.getElementById('historySearchClearBtn');
  if (clearBtn) clearBtn.style.display = 'none';

  const listContainer = document.getElementById('historyLedgerList');
  if (listContainer) {
    const { list } = getHistoryFilteredData();
    listContainer.innerHTML = renderHistoryCardsHtml(list);
  }
}

export function setHistoryFilter(cat) {
  historyCategoryFilter = cat;
  renderApp();
}

export function setHistorySearch(q) {
  onHistorySearchInput(q);
}

/**
 * Helper: Aggregate and filter Production data
 */
function getFilteredProductionData() {
  let prods = [...(appData.production || [])];

  // Count total pending in production
  const prodPendingCount = prods.filter(p => Boolean(p.IsPending || p.Status === 'Pending')).length;

  // 1. Filter by Type: all | work | withdrawal | pending
  if (productionTypeFilter === 'work') {
    prods = prods.filter(p => p.Type === 'Work');
  } else if (productionTypeFilter === 'withdrawal') {
    prods = prods.filter(p => p.Type === 'Withdrawal');
  } else if (productionTypeFilter === 'pending') {
    prods = prods.filter(p => Boolean(p.IsPending || p.Status === 'Pending'));
  }

  // 2. Filter by Date Range / Month
  const now = new Date();
  if (productionDateRange === 'today') {
    const todayStr = now.toISOString().split('T')[0];
    prods = prods.filter(p => p.Date === todayStr);
  } else if (productionDateRange === 'thisMonth') {
    prods = prods.filter(p => {
      if (!p.Date) return false;
      const d = new Date(p.Date + 'T00:00:00');
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
  } else if (productionDateRange === 'lastMonth') {
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    prods = prods.filter(p => {
      if (!p.Date) return false;
      const d = new Date(p.Date + 'T00:00:00');
      return d.getFullYear() === prevMonth.getFullYear() && d.getMonth() === prevMonth.getMonth();
    });
  } else if (productionDateRange === 'month' && productionMonthFilter) {
    prods = prods.filter(p => p.Date && p.Date.startsWith(productionMonthFilter));
  } else if (productionDateRange === 'custom') {
    if (productionStartDate) {
      prods = prods.filter(p => p.Date >= productionStartDate);
    }
    if (productionEndDate) {
      prods = prods.filter(p => p.Date <= productionEndDate);
    }
  }

  // Base list before tag filtering for tag counts
  const baseForTags = [...prods];
  const tagCounts = {
    all: baseForTags.length,
    'শার্ট': baseForTags.filter(p => getProductionItemTag(p) === 'শার্ট').length,
    'গোলগোলা': baseForTags.filter(p => getProductionItemTag(p) === 'গোলগোলা').length,
    'প্যান্ট': baseForTags.filter(p => getProductionItemTag(p) === 'প্যান্ট').length,
    'কটি': baseForTags.filter(p => getProductionItemTag(p) === 'কটি').length,
    'অন্যান্য': baseForTags.filter(p => getProductionItemTag(p) === 'অন্যান্য').length
  };

  // 3. Filter by Tag: all | 'শার্ট' | 'গোলগোলা' | 'প্যান্ট' | 'কটি' | 'অন্যান্য'
  if (productionTagFilter !== 'all') {
    prods = prods.filter(p => getProductionItemTag(p) === productionTagFilter);
  }

  // 4. Search Filter
  if (productionSearchQuery && productionSearchQuery.trim()) {
    const q = productionSearchQuery.trim().toLowerCase();
    prods = prods.filter(p =>
      String(p['Work Name'] || '').toLowerCase().includes(q) ||
      String(p.Size || '').toLowerCase().includes(q) ||
      String(p.Color || '').toLowerCase().includes(q) ||
      String(p.Note || '').toLowerCase().includes(q) ||
      String(p.ID || '').toLowerCase().includes(q) ||
      String(p.Pcs || '').toLowerCase().includes(q) ||
      String(getProductionItemTag(p)).toLowerCase().includes(q)
    );
  }

  // Sort descending by Date
  prods.sort((a, b) => new Date(b.Date || 0) - new Date(a.Date || 0));

  // Filtered sub-totals
  const filteredEarned = prods.filter(p => p.Type === 'Work').reduce((s, p) => s + (Number(p.Earned) || 0), 0);
  const filteredWithdrawn = prods.filter(p => p.Type === 'Withdrawal').reduce((s, p) => s + (Number(p.Received) || Number(p.Amount) || 0), 0);

  return { prods, prodPendingCount, filteredEarned, filteredWithdrawn, tagCounts };
}

/**
 * Render individual production cards with high-contrast, structured layout & full time format
 */
function renderProductionCardsHtml(prods) {
  if (prods.length === 0) {
    return `
      <div class="terminal-card" style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
        <div style="font-size: 2rem; margin-bottom: 8px;">🏭</div>
        কোনো প্রোডাকশন রেকর্ড পাওয়া যায়নি।
      </div>
    `;
  }

  return prods.map(p => {
    const dateObj = formatHistoryDate(p.Date);
    const isWork = p.Type === 'Work';
    const hasImg = Boolean(p.Image_URL || p.Image_Base64);
    const rawImg = p.Image_Base64 || p.Image_URL || '';
    const formattedImg = formatImageUrl(rawImg, p.ID);
    const driveFileId = extractDriveFileId(p.Image_URL) || p.DriveFileId || '';
    const relativeTime = formatRelativeTime(p.UpdatedAt || p.Date);
    const isPending = Boolean(p.IsPending || p.Status === 'Pending');

    // Tag resolution
    const tag = getProductionItemTag(p);
    const tagIcon = TAG_ICONS[tag] || '🏷️';
    const tagClass = TAG_CLASSES[tag] || 'tag-other';

    // Formatted time range
    const timeRangeStr = formatProductionTimeRange(p);

    // Bengali Day for Date chip
    let dayOfWeekStr = '';
    if (p.Date) {
      const dt = new Date(p.Date + 'T00:00:00');
      if (!isNaN(dt.getTime())) {
        const shortDays = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি'];
        dayOfWeekStr = shortDays[dt.getDay()] || '';
      }
    }

    return `
      <div class="prod-card-redesigned ${isPending ? 'is-pending' : ''}" onclick="window.SmartHisab.openRecordDetailModal('production', '${p.ID}')" title="সম্পূর্ণ বিবরণ দেখতে ট্যাপ করুন">
        
        <!-- Header Row: Date Chip, Tag Badge, Type Badge, Artisan & Big Net Amount -->
        <div class="prod-card-header">
          <div class="prod-tags-group">
            <span class="prod-date-chip" title="${dateObj.full}">
              📅 ${dateObj.dateNum}${dayOfWeekStr ? ' • ' + dayOfWeekStr : ''}
            </span>
            ${isWork ? `
              <span class="prod-tag-pill ${tagClass}" title="ক্যাটাগরি ট্যাগ">
                ${tagIcon} ${tag}
              </span>
            ` : ''}
            <span class="badge-term ${isWork ? 'badge-work' : 'badge-withdrawal'} prod-badge">
              ${isWork ? 'মজুরি' : 'উত্তোলন'}
            </span>
            ${p.Artisan ? `
              <span class="prod-artisan-chip" title="কারিগর">👤 ${p.Artisan}</span>
            ` : ''}
            ${isPending ? `
              <span class="prod-pending-chip">⏳ পেন্ডিং</span>
            ` : ''}
          </div>

          <div class="prod-line-1-right">
            ${isWork && p.Earned > 0 ? `
              <span class="prod-amount-earned font-mono">+${formatTaka(p.Earned)}</span>
            ` : ''}
            ${(!isWork || p.Received > 0) ? `
              <span class="prod-amount-withdrawn font-mono">-${formatTaka(p.Received || p.Amount || 0)}</span>
            ` : ''}
            ${isWork && p.Earned === 0 && (!p.Received || p.Received === 0) ? `
              <span class="prod-amount-zero font-mono">৳০</span>
            ` : ''}
          </div>
        </div>

        <!-- Body Row: Left Photo Thumbnail + Right Main Work Info & Specs -->
        <div class="prod-card-body">
          <div class="prod-photo-side" onclick="event.stopPropagation(); window.SmartHisab.openImagePreview('${formattedImg}', '${(p['Work Name'] || 'প্রোডাকশন ছবি').replace(/'/g, "\\'")}', '${p.Image_URL || ''}')" title="${hasImg ? 'বড় করে ছবি দেখুন' : ''}">
            ${hasImg ? `
              <img src="${formattedImg}" 
                   data-file-id="${driveFileId}" 
                   data-record-id="${p.ID}" 
                   data-original-src="${p.Image_URL || ''}" 
                   class="prod-photo-img" 
                   alt="ছবি" 
                   loading="lazy" 
                   referrerpolicy="no-referrer" 
                   onerror="window.SmartHisab.handleImageError(this, '${driveFileId}', '${p.ID}')" />
              <span class="prod-photo-zoom-hint" title="বড় করে দেখুন">🔍</span>
            ` : `
              <div class="prod-photo-placeholder">
                <span class="prod-photo-icon">${isWork ? (tagIcon || '🏭') : '💸'}</span>
              </div>
            `}
          </div>

          <div class="prod-main-info">
            <div class="prod-work-title">
              ${p['Work Name'] || (isWork ? 'পোশাকের কাজ' : 'বিল উত্তোলন')}
            </div>

            ${isWork ? `
              <div class="prod-metrics-grid">
                <span class="prod-metric-item">
                  <span class="metric-lbl">পরিমাণ:</span> <strong>${toBengaliDigits(p.Pcs || 0)} pcs</strong> (${toBengaliDigits(p.Dozen || 0)} ডজন)
                </span>
                <span class="prod-metric-item">
                  <span class="metric-lbl">দর:</span> <strong>৳${toBengaliDigits(p.Rate || 0)}</strong>/ডজন
                </span>
                ${p.Size && p.Size !== '-' ? `
                  <span class="prod-metric-item">
                    <span class="metric-lbl">সাইজ:</span> <strong>${p.Size}</strong>
                  </span>
                ` : ''}
                ${p.Color && p.Color !== '-' ? `
                  <span class="prod-metric-item">
                    <span class="metric-lbl">কালার:</span> <strong>${p.Color}</strong>
                  </span>
                ` : ''}
              </div>
            ` : `
              <div style="font-size: 0.8rem; color: var(--text-muted); font-family: var(--font-bangla);">
                কারিগর বিল ক্যাশ গ্রহণ / উত্তোলন
              </div>
            `}
          </div>
        </div>

        <!-- Dedicated Time Banner (Highlighted Row: শুরু - [বার সময়], শেষ - [বার সময়] ([মোট সময়])) -->
        ${timeRangeStr ? `
          <div class="prod-time-banner">
            <span class="prod-time-icon">⏱️</span>
            <span class="prod-time-text">${timeRangeStr}</span>
          </div>
        ` : ''}

        <!-- Footer: Note & Relative Time -->
        ${(p.Note || relativeTime) ? `
          <div class="prod-card-footer">
            ${p.Note ? `
              <div class="prod-note-box">
                <span>📝</span> ${p.Note}
              </div>
            ` : '<div></div>'}
            ${relativeTime ? `
              <div class="prod-rel-time" title="সর্বশেষ আপডেট">আপডেট: ${relativeTime}</div>
            ` : ''}
          </div>
        ` : ''}

      </div>
    `;
  }).join('');
}

/**
 * Production Tab Filtering Handlers
 */
export function onProductionSearchInput(val) {
  productionSearchQuery = val;
  const clearBtn = document.getElementById('productionSearchClearBtn');
  if (clearBtn) clearBtn.style.display = val ? 'inline-flex' : 'none';

  const listContainer = document.getElementById('productionLedgerList');
  if (listContainer) {
    const { prods, filteredEarned, filteredWithdrawn } = getFilteredProductionData();
    listContainer.innerHTML = renderProductionCardsHtml(prods);

    const statsEl = document.getElementById('prodFilterStats');
    if (statsEl) {
      const hasActiveFilters = productionTypeFilter !== 'all' || productionDateRange !== 'all' || Boolean(productionMonthFilter) || Boolean(productionStartDate) || Boolean(productionEndDate) || Boolean(productionSearchQuery.trim());
      statsEl.innerHTML = `রেকর্ড: <strong style="color: var(--text-pure);">${prods.length}</strong> টি ${hasActiveFilters ? `(অর্জিত: <span style="color: var(--green-electric);">${formatTaka(filteredEarned)}</span>, উত্তোলন: <span style="color: var(--red-coral);">${formatTaka(filteredWithdrawn)}</span>)` : ''}`;
    }
  }
}

export function clearProductionSearch() {
  productionSearchQuery = '';
  const searchInput = document.getElementById('productionSearchInput');
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }
  const clearBtn = document.getElementById('productionSearchClearBtn');
  if (clearBtn) clearBtn.style.display = 'none';

  const listContainer = document.getElementById('productionLedgerList');
  if (listContainer) {
    const { prods, filteredEarned, filteredWithdrawn } = getFilteredProductionData();
    listContainer.innerHTML = renderProductionCardsHtml(prods);

    const statsEl = document.getElementById('prodFilterStats');
    if (statsEl) {
      const hasActiveFilters = productionTypeFilter !== 'all' || productionDateRange !== 'all' || Boolean(productionMonthFilter) || Boolean(productionStartDate) || Boolean(productionEndDate);
      statsEl.innerHTML = `রেকর্ড: <strong style="color: var(--text-pure);">${prods.length}</strong> টি ${hasActiveFilters ? `(অর্জিত: <span style="color: var(--green-electric);">${formatTaka(filteredEarned)}</span>, উত্তোলন: <span style="color: var(--red-coral);">${formatTaka(filteredWithdrawn)}</span>)` : ''}`;
    }
  }
}

export function setProductionTypeFilter(type) {
  productionTypeFilter = type;
  renderApp();
}

export function setProductionTagFilter(tag) {
  productionTagFilter = tag;
  renderApp();
}

export function setProductionDateRange(range) {
  productionDateRange = range;
  if (range !== 'custom') {
    productionStartDate = '';
    productionEndDate = '';
  }
  if (range !== 'month') {
    productionMonthFilter = '';
  }
  renderApp();
}

export function setProductionMonth(monthVal) {
  productionMonthFilter = monthVal || '';
  productionDateRange = monthVal ? 'month' : 'all';
  renderApp();
}

export function onProductionDateChange(start, end) {
  productionStartDate = start || '';
  productionEndDate = end || '';
  productionDateRange = 'custom';
  renderApp();
}

export function setProductionCustomDates(start, end) {
  onProductionDateChange(start, end);
}

export function clearProductionFilters() {
  productionTypeFilter = 'all';
  productionTagFilter = 'all';
  productionDateRange = 'all';
  productionMonthFilter = '';
  productionStartDate = '';
  productionEndDate = '';
  productionSearchQuery = '';
  renderApp();
}

/**
 * 3. PRODUCTION LEDGER VIEW (COMPACT ROW FEED + FILTERS + RELATIVE TIMESTAMPS)
 */
function renderProductionView(container) {
  const { prods, prodPendingCount, filteredEarned, filteredWithdrawn, tagCounts } = getFilteredProductionData();

  // Calculate totals from entire collection
  const allProds = appData.production || [];
  const totalEarned = allProds.filter(p => p.Type === 'Work').reduce((s, p) => s + (Number(p.Earned) || 0), 0);
  const totalWithdrawn = allProds.filter(p => p.Type === 'Withdrawal').reduce((s, p) => s + (Number(p.Received) || Number(p.Amount) || 0), 0);
  const netDue = totalEarned - totalWithdrawn;

  const hasActiveFilters = productionTypeFilter !== 'all' || productionTagFilter !== 'all' || productionDateRange !== 'all' || Boolean(productionMonthFilter) || Boolean(productionStartDate) || Boolean(productionEndDate) || Boolean(productionSearchQuery.trim());

  container.innerHTML = `
    <!-- Top Summary Banner -->
    <div class="terminal-card filter-bar" style="margin-bottom: 16px;">
      <div>
        <h2 style="font-size: 1.15rem; font-weight: 700; color: var(--text-pure); display: flex; align-items: center; gap: 8px;">
          গার্মেন্টস ও প্রোডাকশন খাতা
        </h2>
        <p style="font-size: 0.78rem; color: var(--text-muted); font-family: var(--font-mono);">
          মোট অর্জিত: <span style="color: var(--cyan-cyber);">${formatTaka(totalEarned)}</span> |
          উত্তোলন: <span style="color: var(--gold-neon);">${formatTaka(totalWithdrawn)}</span> |
          বকেয়া প্রাপ্য: <strong style="color: ${netDue >= 0 ? 'var(--green-electric)' : 'var(--red-coral)'};">${formatTaka(netDue)}</strong>
        </p>
      </div>
    </div>

    <!-- Production Filter Controls: Search Bar + Type Toggle + Tag Filters + Date Range Picker -->
    <div class="terminal-card" style="padding: 14px 16px; margin-bottom: 16px;">
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <!-- Row 1: Search Bar -->
        <div style="position: relative; width: 100%;">
          <input type="text" id="productionSearchInput" class="terminal-input" placeholder="🔍 কাজের নাম, ট্যাগ, কালার, সাইজ, নোট..." value="${productionSearchQuery}" oninput="window.SmartHisab.onProductionSearchInput(this.value)" style="width: 100%; padding-right: 28px;" />
          <button type="button" id="productionSearchClearBtn" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; color: var(--text-dim); cursor: pointer; display: ${productionSearchQuery ? 'inline-flex' : 'none'}; font-size: 0.9rem;" onclick="window.SmartHisab.clearProductionSearch()">✕</button>
        </div>

        <!-- Row 2: Type Filters: সব | মজুরি | উত্তোলন | পেন্ডিং -->
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <span style="font-size: 0.78rem; font-family: var(--font-mono); color: var(--text-muted); margin-right: 4px;">ধরন:</span>
            <button type="button" class="filter-pill ${productionTypeFilter === 'all' ? 'active' : ''}" onclick="window.SmartHisab.setProductionTypeFilter('all')">সব</button>
            <button type="button" class="filter-pill ${productionTypeFilter === 'work' ? 'active' : ''}" onclick="window.SmartHisab.setProductionTypeFilter('work')">মজুরি</button>
            <button type="button" class="filter-pill ${productionTypeFilter === 'withdrawal' ? 'active' : ''}" onclick="window.SmartHisab.setProductionTypeFilter('withdrawal')">উত্তোলন</button>
            <button type="button" class="filter-pill ${productionTypeFilter === 'pending' ? 'active' : ''}" style="${productionTypeFilter === 'pending' ? 'background: #F59E0B; color: #000; border-color: #F59E0B;' : 'color: #F59E0B; border-color: rgba(245,158,11,0.4);'}" onclick="window.SmartHisab.setProductionTypeFilter('pending')">⏳ পেন্ডিং (${prodPendingCount})</button>
          </div>

          <!-- Active Records Counter & Filter Subtotal -->
          <div id="prodFilterStats" style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-muted);">
            রেকর্ড: <strong style="color: var(--text-pure);">${prods.length}</strong> টি
            ${hasActiveFilters ? `(অর্জিত: <span style="color: var(--green-electric);">${formatTaka(filteredEarned)}</span>, উত্তোলন: <span style="color: var(--red-coral);">${formatTaka(filteredWithdrawn)}</span>)` : ''}
          </div>
        </div>

        <!-- Row 2.5: Tag Filter Bar (৫টি ট্যাগ: শার্ট, গোলগোলা, প্যান্ট, কটি, অন্যান্য) -->
        <div class="prod-tag-filter-bar">
          <span style="font-size: 0.76rem; font-family: var(--font-mono); color: var(--text-muted); margin-right: 4px;">ট্যাগ ফিল্টার:</span>
          <button type="button" class="prod-tag-filter-pill ${productionTagFilter === 'all' ? 'active' : ''}" onclick="window.SmartHisab.setProductionTagFilter('all')">
            ✨ সব (${toBengaliDigits(tagCounts.all)})
          </button>
          <button type="button" class="prod-tag-filter-pill ${productionTagFilter === 'শার্ট' ? 'active' : ''}" data-tag="শার্ট" onclick="window.SmartHisab.setProductionTagFilter('শার্ট')">
            👔 শার্ট (${toBengaliDigits(tagCounts['শার্ট'])})
          </button>
          <button type="button" class="prod-tag-filter-pill ${productionTagFilter === 'গোলগোলা' ? 'active' : ''}" data-tag="গোলগোলা" onclick="window.SmartHisab.setProductionTagFilter('গোলগোলা')">
            👕 গোলগোলা (${toBengaliDigits(tagCounts['গোলগোলা'])})
          </button>
          <button type="button" class="prod-tag-filter-pill ${productionTagFilter === 'প্যান্ট' ? 'active' : ''}" data-tag="প্যান্ট" onclick="window.SmartHisab.setProductionTagFilter('প্যান্ট')">
            👖 প্যান্ট (${toBengaliDigits(tagCounts['প্যান্ট'])})
          </button>
          <button type="button" class="prod-tag-filter-pill ${productionTagFilter === 'কটি' ? 'active' : ''}" data-tag="কটি" onclick="window.SmartHisab.setProductionTagFilter('কটি')">
            🦺 কটি (${toBengaliDigits(tagCounts['কটি'])})
          </button>
          <button type="button" class="prod-tag-filter-pill ${productionTagFilter === 'অন্যান্য' ? 'active' : ''}" data-tag="অন্যান্য" onclick="window.SmartHisab.setProductionTagFilter('অন্যান্য')">
            🏷️ অন্যান্য (${toBengaliDigits(tagCounts['অন্যান্য'])})
          </button>
        </div>

        <!-- Row 3: Date Range & Custom Picker -->
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 8px; border-top: 1px solid var(--border-subtle);">
          <span style="font-size: 0.78rem; font-family: var(--font-mono); color: var(--text-muted); margin-right: 4px;">সময়কাল:</span>
          <button type="button" class="filter-pill ${productionDateRange === 'all' && !productionMonthFilter && !productionStartDate && !productionEndDate ? 'active' : ''}" onclick="window.SmartHisab.setProductionDateRange('all')">সব সময়</button>
          <button type="button" class="filter-pill ${productionDateRange === 'today' ? 'active' : ''}" onclick="window.SmartHisab.setProductionDateRange('today')">আজ</button>
          <button type="button" class="filter-pill ${productionDateRange === 'thisMonth' ? 'active' : ''}" onclick="window.SmartHisab.setProductionDateRange('thisMonth')">এই মাস</button>
          <button type="button" class="filter-pill ${productionDateRange === 'lastMonth' ? 'active' : ''}" onclick="window.SmartHisab.setProductionDateRange('lastMonth')">গত মাস</button>
          <button type="button" class="filter-pill ${productionDateRange === 'custom' ? 'active' : ''}" onclick="window.SmartHisab.setProductionDateRange('custom')">কাস্টম রেঞ্জ</button>

          <!-- Month Selector -->
          <div style="display: inline-flex; align-items: center; gap: 4px; margin-left: 4px;">
            <label for="prodMonthPicker" style="font-size: 0.74rem; font-family: var(--font-mono); color: var(--text-muted);">মাস:</label>
            <input type="month" id="prodMonthPicker" class="terminal-input" style="padding: 3px 8px; font-size: 0.78rem;" value="${productionMonthFilter}" onchange="window.SmartHisab.setProductionMonth(this.value)" />
          </div>

          ${hasActiveFilters ? `
            <button type="button" class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.74rem; color: var(--red-coral); margin-left: auto;" onclick="window.SmartHisab.clearProductionFilters()" title="ফিল্টার রিসেট">
              ✕ ফিল্টার রিসেট
            </button>
          ` : ''}
        </div>

        <!-- Custom Date Range Inputs Row (যেমন: ২০ সেপ্টেম্বর ২০২৬ থেকে ২৮ সেপ্টেম্বর ২০২৬) -->
        <div id="prodCustomDateRow" style="display: ${productionDateRange === 'custom' ? 'flex' : 'none'}; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 10px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-subtle); border-radius: var(--radius-xs);">
          <span style="font-size: 0.76rem; font-family: var(--font-mono); color: var(--text-muted);">শুরু:</span>
          <input type="date" id="prodStartDate" class="terminal-input" style="padding: 4px 8px; font-size: 0.78rem;" value="${productionStartDate}" onchange="window.SmartHisab.onProductionDateChange(this.value, document.getElementById('prodEndDate')?.value || '')" />
          <span style="font-size: 0.76rem; font-family: var(--font-mono); color: var(--text-muted);">থেকে শেষ:</span>
          <input type="date" id="prodEndDate" class="terminal-input" style="padding: 4px 8px; font-size: 0.78rem;" value="${productionEndDate}" onchange="window.SmartHisab.onProductionDateChange(document.getElementById('prodStartDate')?.value || '', this.value)" />
          ${(productionStartDate || productionEndDate) ? `
            <span class="badge-term" style="background: rgba(0, 242, 157, 0.08); color: var(--green-electric); border: 1px solid rgba(0, 242, 157, 0.3); font-size: 0.76rem; padding: 4px 8px; border-radius: var(--radius-xs);">
              📅 ${formatBengaliDate(productionStartDate) || 'শুরু'} থেকে ${formatBengaliDate(productionEndDate) || 'বর্তমান'}
            </span>
          ` : ''}
        </div>
      </div>
    </div>

    <!-- Production Row Feed (Modern Compact Layout Matching History View) -->
    <div class="ledger-list" id="productionLedgerList">
      ${renderProductionCardsHtml(prods)}
    </div>
  `;
}

/**
 * 4. LOAN TRACKER VIEW
 */
function renderLoanView(container) {
  const loans = appData.loan || [];
  const totalTaken = loans.reduce((s, l) => s + (Number(l['Loan Taken']) || 0), 0);
  const totalPaid = loans.reduce((s, l) => s + (Number(l['Loan Paid']) || 0), 0);
  const totalRemaining = totalTaken - totalPaid;

  container.innerHTML = `
    <div class="terminal-card filter-bar" style="margin-bottom: 16px;">
      <div>
        <h2 style="font-size: 1.15rem; font-weight: 700; color: var(--text-pure); display: flex; align-items: center; gap: 8px;">
          লোন ও দেনা ট্র্যাকার
        </h2>
        <p style="font-size: 0.78rem; color: var(--text-muted); font-family: var(--font-mono);">
          মোট গৃহীত: <span style="color: var(--red-coral);">${formatTaka(totalTaken)}</span> |
          মোট পরিশোধ: <span style="color: var(--green-electric);">${formatTaka(totalPaid)}</span> |
          বাকি লোন: <strong style="color: #FB923C;">${formatTaka(totalRemaining)}</strong>
        </p>
      </div>

      <button type="button" class="btn btn-primary" style="padding: 8px 14px; font-size: 0.85rem;" onclick="window.SmartHisab.openAddModal('loan')">
        + নতুন লোন রেকর্ড
      </button>
    </div>

    <!-- Loans Table -->
    <div class="terminal-table-container">
      <table class="terminal-table">
        <thead>
          <tr>
            <th>তারিখ</th>
            <th>বিবরণ / ঋণদাতা</th>
            <th style="text-align: right;">গৃহীত ঋণ</th>
            <th style="text-align: right;">পরিশোধকৃত</th>
            <th style="text-align: right;">বাকি ব্যালেন্স</th>
            <th>নোট</th>
            <th style="text-align: center;">অ্যাকশন</th>
          </tr>
        </thead>
        <tbody>
          ${loans.length === 0 ? `
            <tr><td colspan="7" style="text-align: center; padding: 32px; color: var(--text-muted);">কোনো লোন রেকর্ড নেই।</td></tr>
          ` : loans.map(l => {
            const taken = Number(l['Loan Taken']) || 0;
            const paid = Number(l['Loan Paid']) || 0;
            const rem = taken - paid;
            return `
              <tr>
                <td class="font-mono" style="color: var(--text-dim);">${l.Date}</td>
                <td><strong>${l.Description || '-'}</strong></td>
                <td class="font-mono" style="text-align: right; color: var(--red-coral);">${formatTaka(taken)}</td>
                <td class="font-mono" style="text-align: right; color: var(--green-electric);">${formatTaka(paid)}</td>
                <td class="font-mono" style="text-align: right; font-weight: 700; color: #FB923C;">${formatTaka(rem)}</td>
                <td style="color: var(--text-muted); font-size: 0.82rem;">${l.Note || '-'}</td>
                <td style="text-align: center;">
                  <button type="button" class="icon-btn" style="width: 28px; height: 28px; margin: 0 auto;" onclick="window.SmartHisab.openEditModal('loan', '${l.ID}')" title="সম্পাদনা">
                    ✏️
                  </button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * 5. MULTI-FUND VIEW (WITH CASCADING DELETION)
 */
function renderFundView(container) {
  const funds = calculateFundBalances(appData.fund, appData.fund_transaction);
  const allFundsTotalIn = funds.reduce((s, f) => s + (Number(f.totalIn) || 0), 0);
  const allFundsTotalOut = funds.reduce((s, f) => s + (Number(f.totalOut) || 0), 0);
  const allFundsNetBalance = funds.reduce((s, f) => s + (Number(f.currentBalance) || 0), 0);

  container.innerHTML = `
    <div class="terminal-card filter-bar" style="margin-bottom: 16px;">
      <div>
        <h2 style="font-size: 1.15rem; font-weight: 700; color: var(--text-pure); display: flex; align-items: center; gap: 8px;">
          মাল্টি-ফান্ড ও সঞ্চয় ব্যবস্থাপনা
        </h2>
        <p style="font-size: 0.78rem; color: var(--text-muted); font-family: var(--font-mono); margin-top: 4px;">
          সর্বমোট জমা: <span style="color: var(--green-electric); font-weight: 700;">+${formatTaka(allFundsTotalIn)}</span> |
          সর্বমোট খরচ: <span style="color: var(--red-coral); font-weight: 700;">-${formatTaka(allFundsTotalOut)}</span> |
          মোট স্থিতি: <strong style="color: var(--purple-neon); font-weight: 700;">${formatTaka(allFundsNetBalance)}</strong>
        </p>
      </div>

      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <button type="button" class="btn btn-primary" style="padding: 8px 14px; font-size: 0.85rem;" onclick="window.SmartHisab.openAddModal('fund')">
          + নতুন ফান্ড তৈরি
        </button>
        <button type="button" class="btn btn-secondary" style="padding: 8px 14px; font-size: 0.85rem;" onclick="window.SmartHisab.openAddModal('fund_transaction')">
          + ফান্ডে লেনদেন (In/Out)
        </button>
      </div>
    </div>

    <!-- Fund Cards Grid -->
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; margin-bottom: 24px;">
      ${funds.map(f => `
        <div class="terminal-card" style="padding: 18px 20px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
            <div>
              <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--text-pure);">${f['Fund Name']}</h3>
              <p style="font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono);">
                টার্গেট: ${formatTaka(f.target)} • ${f.transactionCount} টি লেনদেন
              </p>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="badge-term ${f.Status === 'Active' ? 'badge-income' : 'badge-expense'}">${f.Status === 'Active' ? 'সক্রিয়' : 'আর্কাইভ'}</span>
              <button type="button" class="icon-btn" style="width: 28px; height: 28px; color: var(--gold-neon); background: rgba(217, 119, 6, 0.1); border: 1px solid rgba(217, 119, 6, 0.3); border-radius: 6px;" onclick="window.SmartHisab.openEditModal('fund', '${f.ID}')" title="ফান্ড সম্পাদনা করুন">
                ✏️
              </button>
            </div>
          </div>

          <!-- Fund Financial Summary Box: মোট জমা, মোট খরচ, নীট ব্যালেন্স -->
          <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 12px 14px; margin: 12px 0 12px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.06);">
              <div>
                <span style="display: block; font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-bangla);">📥 মোট জমা (Total In):</span>
                <span class="font-mono" style="font-size: 1.05rem; font-weight: 700; color: var(--green-electric);">+${formatTaka(f.totalIn || 0)}</span>
              </div>
              <div style="text-align: right;">
                <span style="display: block; font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-bangla);">📤 মোট খরচ (Total Out):</span>
                <span class="font-mono" style="font-size: 1.05rem; font-weight: 700; color: var(--red-coral);">-${formatTaka(f.totalOut || 0)}</span>
              </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: baseline;">
              <span style="font-size: 0.8rem; color: var(--text-main); font-weight: 600;">বর্তমান নীট ব্যালেন্স:</span>
              <span class="font-mono" style="font-size: 1.35rem; font-weight: 800; color: ${f.currentBalance >= 0 ? 'var(--purple-neon)' : 'var(--red-coral)'};">
                ${formatTaka(f.currentBalance)}
              </span>
            </div>
          </div>

          <!-- Progress Bar -->
          <div style="height: 6px; background: var(--bg-input); border-radius: 999px; overflow: hidden; margin-bottom: 6px;">
            <div style="height: 100%; width: ${Math.min(100, f.percent)}%; background: linear-gradient(90deg, var(--purple-neon), var(--cyan-cyber));"></div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--text-dim); font-family: var(--font-mono);">
            <span>পূরণ: ${f.percent}%</span>
            <span>অবশিষ্ট: ${formatTaka(Math.max(0, f.target - f.currentBalance))}</span>
          </div>

          <!-- Actions -->
          <div style="display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap;">
            <button type="button" class="btn btn-secondary" style="flex: 1; min-width: 70px; padding: 6px 8px; font-size: 0.8rem;" onclick="window.SmartHisab.openQuickFundTx('${f.ID}', 'In')">📥 জমা (In)</button>
            <button type="button" class="btn btn-secondary" style="flex: 1; min-width: 70px; padding: 6px 8px; font-size: 0.8rem;" onclick="window.SmartHisab.openQuickFundTx('${f.ID}', 'Out')">📤 খরচ (Out)</button>
            <button type="button" class="btn btn-secondary" style="padding: 6px 12px; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 4px; color: var(--gold-neon); border-color: rgba(217, 119, 6, 0.4);" onclick="window.SmartHisab.openEditModal('fund', '${f.ID}')" title="ফান্ড সম্পাদনা করুন">
              ✏️ এডিট
            </button>
            <button type="button" class="btn btn-danger" style="padding: 6px 10px; font-size: 0.8rem;" onclick="window.SmartHisab.confirmDeleteFundCascade('${f.ID}', '${f['Fund Name'].replace(/'/g, "\\'")}')" title="ফান্ড ও সকল লেনদেন একসাথে ডিলিট করুন">
              🗑️
            </button>
          </div>
        </div>
      `).join('')}
    </div>

    <!-- Fund Transactions Log -->
    <div class="terminal-card" style="padding: 18px 20px;">
      <h3 style="font-size: 0.95rem; font-weight: 700; color: var(--text-pure); margin-bottom: 12px;">ফান্ড ট্রানজেকশন হিস্ট্রি</h3>
      <div class="terminal-table-container">
        <table class="terminal-table">
          <thead>
            <tr>
              <th>তারিখ</th>
              <th>ফান্ড নাম</th>
              <th>ধরন</th>
              <th>ক্যাটাগরি / নোট</th>
              <th style="text-align: right;">পরিমাণ</th>
              <th style="text-align: center;">অ্যাকশন</th>
            </tr>
          </thead>
          <tbody>
            ${(appData.fund_transaction || []).length === 0 ? `
              <tr><td colspan="6" style="text-align: center; padding: 24px; color: var(--text-muted);">কোনো ফান্ড লেনদেন রেকর্ড নেই।</td></tr>
            ` : (appData.fund_transaction || []).map(tx => {
              const fundObj = (appData.fund || []).find(f => String(f.ID) === String(tx['Fund ID']));
              return `
                <tr>
                  <td class="font-mono" style="color: var(--text-dim);">${tx.Date}</td>
                  <td><strong>${fundObj ? fundObj['Fund Name'] : tx['Fund ID']}</strong></td>
                  <td><span class="badge-term ${tx.Type === 'In' ? 'badge-income' : 'badge-expense'}">${tx.Type === 'In' ? 'জমা' : 'খরচ'}</span></td>
                  <td>${tx['Category/Note'] || tx.Note || '-'}</td>
                  <td class="font-mono" style="text-align: right; font-weight: 700; color: ${tx.Type === 'In' ? 'var(--green-electric)' : 'var(--red-coral)'};">
                    ${tx.Type === 'In' ? '+' : '-'}${formatTaka(tx.Amount)}
                  </td>
                  <td style="text-align: center; white-space: nowrap;">
                    <button type="button" class="icon-btn" style="width: 26px; height: 26px; margin-right: 4px; color: var(--cyan-cyber); display: inline-flex; align-items: center; justify-content: center;" onclick="window.SmartHisab.openEditModal('fund_transaction', '${tx.ID}')" title="সম্পাদনা করুন">
                      ✏️
                    </button>
                    <button type="button" class="icon-btn" style="width: 26px; height: 26px; color: var(--red-coral); display: inline-flex; align-items: center; justify-content: center;" onclick="window.SmartHisab.deleteRecordDirect('fund_transaction', '${tx.ID}')" title="মুছে ফেলুন">
                      ✕
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * Cascading Fund Deletion Handler
 */
export async function confirmDeleteFundCascade(fundId, fundName) {
  const ok = confirm(`সতর্কতা: "${fundName}" ফান্ড এবং এর সাথে যুক্ত সকল জমা/খরচের লেনদেন একসাথে মুছে ফেলা হবে। আপনি কি নিশ্চিত?`);
  if (!ok) return;

  const linkedTxs = (appData.fund_transaction || []).filter(tx => String(tx['Fund ID']) === String(fundId));

  appData.fund = (appData.fund || []).filter(f => String(f.ID) !== String(fundId));
  appData.fund_transaction = (appData.fund_transaction || []).filter(tx => String(tx['Fund ID']) !== String(fundId));

  saveLocalData(appData);
  renderApp();
  showToast(`"${fundName}" ফান্ড ও সংশ্লিষ্ট লেনদেন মুছে ফেলা হয়েছে`, 'success');

  // Sync delete to Google Sheets
  sendMutation('delete', 'fund', { ID: fundId });
  for (const tx of linkedTxs) {
    sendMutation('delete', 'fund_transaction', { ID: tx.ID });
  }
}

export function openQuickFundTx(fundId, type) {
  openAddModal('fund_transaction');
  setTimeout(() => {
    const fId = document.getElementById('f_FundId');
    const fType = document.getElementById('f_FundTxType');
    if (fId) fId.value = fundId;
    if (fType) fType.value = type;
  }, 50);
}

/**
 * 6. SETTINGS & GOOGLE APPS SCRIPT ENGINE CONFIG
 */
function renderSettingsView(container) {
  const currentUrl = getActiveApiUrl();
  const currentPin = getStoredPasscode() || DEFAULT_PASSCODE;
  const user = getCurrentGoogleUser();
  const allowedEmails = getAuthorizedEmails();
  const driveFolderUrl = getDriveFolderUrl();

  container.innerHTML = `
    <div style="max-width: 800px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px;">
      <!-- 🔐 Google Account & Drive Cloud Storage Manager Card -->
      <div class="terminal-card" style="padding: 24px; border-color: rgba(66, 133, 244, 0.4); background: linear-gradient(180deg, rgba(66, 133, 244, 0.04) 0%, var(--bg-card) 100%);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;">
          <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-pure); display: flex; align-items: center; gap: 8px; margin: 0;">
            <span style="font-size: 1.25rem;">🔐</span> গুগল অ্যাকাউন্ট ও ড্রাইভ সিকিউরিটি
          </h3>
          <span class="badge-term badge-income" style="font-size: 0.72rem; padding: 3px 10px;">
            ${user ? '● সংযুক্ত (CONNECTED)' : '○ বিচ্ছিন্ন'}
          </span>
        </div>

        <p style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 18px; line-height: 1.5;">
          টার্মিনালে প্রবেশাধিকার শুধুমাত্র আপনার অনুমোদিত Google Account দ্বারা সুরক্ষিত। প্রোডাকশন স্যাম্পল ছবি সরাসরি আপনার নিজস্ব Google Drive ক্লাউডে স্থায়ীভাবে আপলোড ও হোস্ট হয়।
        </p>

        <!-- Current User Profile Box -->
        <div style="display: flex; align-items: center; gap: 14px; padding: 14px 16px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); margin-bottom: 18px;">
          ${user && user.photoURL ? `
            <img src="${user.photoURL}" alt="User Avatar" style="width: 46px; height: 46px; border-radius: 50%; border: 2px solid var(--cyan-cyber); object-fit: cover;" referrerpolicy="no-referrer" />
          ` : `
            <div style="width: 46px; height: 46px; border-radius: 50%; background: var(--gold-subtle); color: var(--gold-neon); font-size: 1.2rem; font-weight: 700; display: flex; align-items: center; justify-content: center; border: 2px solid var(--gold-neon);">
              ${(user?.displayName || 'T')[0].toUpperCase()}
            </div>
          `}
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 0.95rem; font-weight: 700; color: var(--text-pure); display: flex; align-items: center; gap: 8px;">
              ${user ? (user.displayName || 'তানজির আহমেদ') : 'সাইন-ইন করা নেই'}
              ${user ? '<span style="font-size: 0.7rem; background: rgba(0, 242, 157, 0.15); color: var(--green-electric); padding: 1px 6px; border-radius: 4px; font-weight: 600;">অ্যাডমিন</span>' : ''}
            </div>
            <div class="font-mono" style="font-size: 0.8rem; color: var(--cyan-cyber); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${user ? user.email : 'লগইন করুন'}
            </div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 4px; display: flex; align-items: center; gap: 6px;">
              📁 Google Drive ফোল্ডার: <span class="font-mono" style="color: #8AB4F8;">Smart Hisab Production Photos</span>
            </div>
          </div>
        </div>

        <!-- Google Actions -->
        <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 20px;">
          ${!user ? `
            <button type="button" class="btn btn-primary" onclick="window.SmartHisab.connectGoogleDriveFromSettings()" style="display: flex; align-items: center; gap: 6px;">
              🔗 Google Drive সিঙ্ক সংযুক্ত করুন
            </button>
          ` : `
            <button type="button" class="btn btn-primary" onclick="window.SmartHisab.connectGoogleDriveFromSettings()" style="display: flex; align-items: center; gap: 6px;">
              🔄 Google Drive টোকেন রিফ্রেশ করুন
            </button>
            <button type="button" class="btn btn-secondary" onclick="window.SmartHisab.openGoogleDriveFolder()">
              📁 Google Drive ফোল্ডার ওপেন করুন
            </button>
            <button type="button" class="btn btn-secondary" style="border-color: rgba(255, 59, 105, 0.4); color: var(--red-coral);" onclick="window.SmartHisab.handleGoogleLogout()">
              🚪 Google অ্যাকাউন্ট সাইন আউট করুন
            </button>
          `}
        </div>

        <!-- Authorized Emails Whitelist -->
        <div style="border-top: 1px solid var(--border-subtle); padding-top: 16px;">
          <label class="form-label" style="display: flex; justify-content: space-between; align-items: center;">
            <span>অনুমোদিত অ্যাডমিন Google Account ইমেইল তালিকা:</span>
            <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: normal;">(কমা দিয়ে একাধিক ইমেইল যোগ করতে পারেন)</span>
          </label>
          <div style="display: flex; gap: 10px; margin-top: 6px;">
            <input type="text" id="allowedEmailsInput" class="form-input font-mono" value="${allowedEmails.join(', ')}" placeholder="tanjir.dollar@gmail.com, example@gmail.com" />
            <button type="button" class="btn btn-primary" onclick="window.SmartHisab.saveAllowedEmailsFromSettings()" style="white-space: nowrap;">
              ✓ আপডেট করুন
            </button>
          </div>
          <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 6px;">
            🛡️ নিরাপত্তা সতর্কতা: এই তালিকায় যে ইমেইলগুলো থাকবে, শুধুমাত্র সেই Google Account দিয়ে এই টার্মিনালে প্রবেশ করা যাবে।
          </p>
        </div>
      </div>

      <!-- Google Apps Script Connection Card -->
      <div class="terminal-card" style="padding: 24px;">
        <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-pure); margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
          গুগল শীট ও ক্লাউড API সংযোগ
        </h3>
        <p style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 16px;">
          আপনার লাইভ Google Apps Script Web App URL এখানে সেট করুন। আপনার প্রদত্ত স্ক্রিপ্ট URL ইতিমধ্যে কনফিগার করা আছে।
        </p>

        <div class="form-group">
          <label class="form-label">Google Apps Script Web App URL (/exec):</label>
          <input type="url" id="apiUrlInput" class="form-input font-mono" value="${currentUrl}" placeholder="https://script.google.com/macros/s/.../exec" />
        </div>

        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <button type="button" class="btn btn-primary" onclick="window.SmartHisab.saveApiUrl()">
            💾 URL সংরক্ষণ করুন
          </button>
          <button type="button" class="btn btn-secondary" onclick="window.SmartHisab.testApiConnection()">
            ⚡ সংযোগ টেস্ট করুন
          </button>
          <button type="button" class="btn btn-secondary" onclick="window.SmartHisab.triggerManualSync()">
            🔄 সম্পূর্ণ সিঙ্ক করুন
          </button>
        </div>
      </div>

      <!-- 🏷️ Expense Categories Management Card -->
      <div class="terminal-card" style="padding: 24px; border-color: rgba(217, 119, 6, 0.35); background: linear-gradient(180deg, rgba(217, 119, 6, 0.04) 0%, var(--bg-card) 100%);">
        <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-pure); margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
          <span>🏷️</span> খরচের ক্যাটাগরি ব্যবস্থাপনা (Expense Categories)
        </h3>
        <p style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 16px; line-height: 1.5;">
          ডিফল্ট ক্যাটাগরির পাশাপাশি আপনার ইচ্ছামতো যেকোনো নতুন ক্যাটাগরি যোগ করতে পারেন। খরচের এন্ট্রিতে এগুলো সরাসরি ড্রপডাউনে পাওয়া যাবে।
        </p>

        <!-- Category Tags -->
        <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px;">
          ${getExpenseCategories().map(cat => `
            <span style="display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 20px; font-size: 0.85rem; color: var(--text-pure); font-weight: 500;">
              ${cat}
              <button type="button" style="background: none; border: none; color: var(--red-coral); cursor: pointer; padding: 0 2px; font-size: 0.85rem; line-height: 1;" onclick="window.SmartHisab.handleRemoveCategoryFromSettings('${cat}')" title="মুছে ফেলুন">✕</button>
            </span>
          `).join('')}
        </div>

        <!-- Add Category Form -->
        <div style="display: flex; gap: 8px; max-width: 520px; flex-wrap: wrap;">
          <input type="text" id="settingsNewCatInput" class="form-input" style="flex: 1; min-width: 180px;" placeholder="নতুন ক্যাটাগরির নাম লিখুন..." onkeydown="if(event.key === 'Enter'){ event.preventDefault(); window.SmartHisab.handleAddCategoryFromSettings(); }" />
          <button type="button" class="btn btn-primary" style="white-space: nowrap;" onclick="window.SmartHisab.handleAddCategoryFromSettings()">
            + যুক্ত করুন
          </button>
          <button type="button" class="btn btn-secondary" style="white-space: nowrap; font-size: 0.78rem;" onclick="window.SmartHisab.handleResetCategoriesToDefault()" title="ডিফল্ট ৫টি ক্যাটাগরিতে ফেরত যান">
            ↺ ডিফল্ট ক্যাটাগরি
          </button>
        </div>
      </div>

      <!-- Passcode Security Manager -->
      <div class="terminal-card" style="padding: 24px;">
        <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-pure); margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
          ডিভাইস কুইক পিন (Quick PIN) কনফিগারেশন
        </h3>
        <p style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 16px;">
          Google Identity যাচাইয়ের পর লোকাল ডিভাইসে দ্রুত স্ক্রিন আনলকের জন্য ঐচ্ছিক ৪ থেকে ৬ সংখ্যার পিন।
        </p>

        <div class="form-grid-3">
          <div class="form-group">
            <label class="form-label">বর্তমান পাসকোড:</label>
            <input type="password" id="currentPasscodeInput" class="form-input font-mono" maxlength="6" placeholder="••••" autocomplete="current-password" />
          </div>
          <div class="form-group">
            <label class="form-label">নতুন পাসকোড (৪-৬ সংখ্যা):</label>
            <input type="password" id="newPasscodeInput" class="form-input font-mono" maxlength="6" placeholder="••••" autocomplete="new-password" />
          </div>
          <div class="form-group">
            <label class="form-label">নতুন পাসকোড নিশ্চিত করুন:</label>
            <input type="password" id="confirmPasscodeInput" class="form-input font-mono" maxlength="6" placeholder="••••" autocomplete="new-password" />
          </div>
        </div>

        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <button type="button" id="btnUpdatePin" class="btn btn-primary" onclick="window.SmartHisab.updatePasscode()">
            🔒 পাসকোড পরিবর্তন ও সিঙ্ক করুন
          </button>
          <button type="button" class="btn btn-secondary" onclick="window.SmartHisab.lockApplication()">
            🚪 এখনি টার্মিনাল লক করুন
          </button>
        </div>
      </div>

      <!-- Data Backup & Reset -->
      <div class="terminal-card" style="padding: 24px;">
        <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-pure); margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
          ডাটা ব্যাকআপ ও রিসেট
        </h3>
        <p style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 16px;">
          আপনার ডিভাইসের লোকাল ডাটা ব্যাকআপ ফাইল আকারে সংরক্ষণ বা ডেমো ডাটা পুনরুদ্ধার করুন।
        </p>

        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <button type="button" class="btn btn-secondary" onclick="window.SmartHisab.exportJsonBackup()">
            📤 JSON ব্যাকআপ ডাউনলোড
          </button>
          <label class="btn btn-secondary" style="cursor: pointer;">
            📥 JSON ইম্পোর্ট
            <input type="file" accept=".json" style="display: none;" onchange="window.SmartHisab.importJsonBackup(event)" />
          </label>
          <button type="button" class="btn btn-danger" onclick="window.SmartHisab.resetToDemoData()">
            ⚠️ ডেমো ডাটায় রিসেট
          </button>
        </div>
      </div>
    </div>
  `;
}

export function saveApiUrl() {
  const url = document.getElementById('apiUrlInput')?.value || '';
  setActiveApiUrl(url);
  showToast('API URL সফলভাবে সংরক্ষিত হয়েছে!', 'success');
  triggerManualSync();
}

export function openGoogleDriveFolder() {
  const url = getDriveFolderUrl();
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function saveAllowedEmailsFromSettings() {
  const input = document.getElementById('allowedEmailsInput');
  const raw = input?.value || '';
  const list = raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

  if (list.length === 0) {
    list.push(DEFAULT_ADMIN_EMAIL.toLowerCase());
  } else if (!list.includes(DEFAULT_ADMIN_EMAIL.toLowerCase())) {
    list.push(DEFAULT_ADMIN_EMAIL.toLowerCase());
  }

  saveAuthorizedEmails(list);
  if (input) input.value = list.join(', ');
  showToast('✓ অনুমোদিত ইমেইল তালিকা সফলভাবে আপডেট হয়েছে!', 'success');
}

export async function testApiConnection() {
  showToast('গুগল শীটে সংযোগ যাচাই করা হচ্ছে...', 'info');
  const res = await testConnection();
  if (res.success) {
    showToast('✓ ' + res.message, 'success');
  } else {
    showToast('✕ ' + res.message, 'error');
  }
}

export async function updatePasscode() {
  const currentInput = document.getElementById('currentPasscodeInput');
  const newInput = document.getElementById('newPasscodeInput');
  const confirmInput = document.getElementById('confirmPasscodeInput');
  const updateBtn = document.getElementById('btnUpdatePin');

  const oldPin = currentInput?.value?.trim() || '';
  const newPin = newInput?.value?.trim() || '';
  const confirmPin = confirmInput?.value?.trim() || '';

  const activePin = getStoredPasscode() || DEFAULT_PASSCODE;
  const isOldPinValid = (oldPin === activePin) || (oldPin === DEFAULT_PASSCODE) || (oldPin === '1234');

  if (!oldPin) {
    showToast('অনুগ্রহ করে আপনার বর্তমান পাসকোড লিখুন', 'error');
    currentInput?.focus();
    return;
  }

  if (!isOldPinValid) {
    showToast('❌ বর্তমান পাসকোডটি সঠিক নয়! (ডিফল্ট: 1234)', 'error');
    currentInput?.focus();
    return;
  }

  if (!newPin || newPin.length < 4 || newPin.length > 6 || !/^\d+$/.test(newPin)) {
    showToast('নতুন পাসকোডটি অবশ্যই ৪ থেকে ৬ সংখ্যার ডিজিট হতে হবে', 'error');
    newInput?.focus();
    return;
  }

  if (newPin !== confirmPin) {
    showToast('❌ উভয় নতুন পাসকোড হুবহু মিলছে না!', 'error');
    confirmInput?.focus();
    return;
  }

  if (newPin === oldPin) {
    showToast('নতুন পাসকোডটি বর্তমান পাসকোড থেকে ভিন্ন হতে হবে', 'error');
    return;
  }

  if (updateBtn) {
    updateBtn.disabled = true;
    updateBtn.textContent = '⏳ পাসকোড সিঙ্ক হচ্ছে...';
  }

  try {
    // 1. Persist new PIN to localStorage immediately
    setStoredPasscode(newPin);

    // 2. Try updating backend token in Google Apps Script (PropertiesService)
    const backendRes = await updateBackendSecurityToken(oldPin, newPin);

    // Clear input fields
    if (currentInput) currentInput.value = '';
    if (newInput) newInput.value = '';
    if (confirmInput) confirmInput.value = '';

    if (backendRes && backendRes.success) {
      showToast('✓ অ্যাপ-লক পিন এই ডিভাইসে আপডেট হয়েছে (ডেটার নিরাপত্তা Google লগইনে সুরক্ষিত)', 'success');
    } else {
      showToast('✓ নতুন পাসকোড ডিভাইসে সক্রিয় হয়েছে! (ক্লাউডে সম্পূর্ণ সিঙ্ক করতে Code.gs স্ক্রিপ্ট আপডেট ডিপ্লয় করুন)', 'info');
    }
  } catch (err) {
    setStoredPasscode(newPin);
    if (currentInput) currentInput.value = '';
    if (newInput) newInput.value = '';
    if (confirmInput) confirmInput.value = '';
    showToast('✓ পাসকোড লোকাল ডিভাইসে সংরক্ষিত হয়েছে (ডিভাইস আনলক নতুন পিন দিয়ে হবে)', 'info');
  } finally {
    if (updateBtn) {
      updateBtn.disabled = false;
      updateBtn.textContent = '🔒 পাসকোড পরিবর্তন ও সিঙ্ক করুন';
    }
  }
}

export function exportJsonBackup() {
  const jsonStr = JSON.stringify(appData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SmartHisab_Backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('JSON ব্যাকআপ ডাউনলোড সম্পন্ন', 'success');
}

export function importJsonBackup(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);
      if (parsed && typeof parsed === 'object') {
        appData = {
          income: parsed.income || [],
          expense: parsed.expense || [],
          production: parsed.production || [],
          loan: parsed.loan || [],
          fund: parsed.fund || [],
          fund_transaction: parsed.fund_transaction || []
        };
        saveLocalData(appData);
        renderApp();
        showToast('ব্যাকআপ সফলভাবে পুনরুদ্ধার হয়েছে!', 'success');
      }
    } catch (err) {
      showToast('অবৈধ ব্যাকআপ ফাইল ফরম্যাট', 'error');
    }
  };
  reader.readAsText(file);
}

export function resetToDemoData() {
  if (confirm('আপনি কি নিশ্চিত যে সকল ডাটা ডেমো ডাটায় রিসেট করতে চান?')) {
    localStorage.removeItem('smart_hisab_pro_data_v2');
    appData = loadLocalData();
    renderApp();
    showToast('ডেমো ডাটা সফলভাবে লোড হয়েছে', 'info');
  }
}

/**
 * 7. BOTTOM SHEET CRUD MODAL & PRODUCTION IMAGE WORKFLOW
 */
export function openAddModal(sheet, defaultType = null) {
  editingRecord = null;
  currentCompressedImageBase64 = null;
  currentDriveUploadResult = null;
  isUploadingToDrive = false;
  const modal = document.getElementById('bottomSheetModal');
  const overlay = document.getElementById('modalOverlay');
  const title = document.getElementById('sheetModalTitle');
  const body = document.getElementById('sheetModalBody');
  const delBtn = document.getElementById('sheetDeleteBtn');

  if (!modal || !overlay || !body) return;

  delBtn.style.display = 'none';

  let sheetTitle = 'নতুন রেকর্ড';
  if (sheet === 'income') sheetTitle = '🟢 নতুন আয় রেকর্ড (Income)';
  if (sheet === 'expense') sheetTitle = '🔴 নতুন খরচ রেকর্ড (Expense)';
  if (sheet === 'production') sheetTitle = defaultType === 'Withdrawal' ? '💵 প্রোডাকশন বিল উইথড্রয়াল' : '🏭 প্রোডাকশন কাজ (Work)';
  if (sheet === 'loan') sheetTitle = '🤝 নতুন লোন রেকর্ড (Loan)';
  if (sheet === 'fund') sheetTitle = '💰 নতুন ফান্ড তৈরি (Fund)';
  if (sheet === 'fund_transaction') sheetTitle = '💳 ফান্ডে জমা / খরচ (Fund Transaction)';

  title.innerHTML = sheetTitle;
  body.innerHTML = getFormFieldsHtml(sheet, null, defaultType);

  overlay.classList.add('active');
  modal.classList.add('active');

  // Attach auto-calculate listeners for production
  if (sheet === 'production') {
    initProductionCalculationListeners();
  }
}

export function openEditModal(sheet, id) {
  const list = appData[sheet] || [];
  const record = list.find(r => String(r.ID) === String(id));
  if (!record) return;

  editingRecord = { sheet, record };
  currentCompressedImageBase64 = null;
  currentDriveUploadResult = record.Image_URL ? {
    directImageUrl: record.Image_URL,
    fileId: record.DriveFileId || extractDriveFileId(record.Image_URL),
    webViewLink: record.DriveWebViewLink || ''
  } : null;
  isUploadingToDrive = false;

  const modal = document.getElementById('bottomSheetModal');
  const overlay = document.getElementById('modalOverlay');
  const title = document.getElementById('sheetModalTitle');
  const body = document.getElementById('sheetModalBody');
  const delBtn = document.getElementById('sheetDeleteBtn');

  if (!modal || !overlay || !body) return;

  delBtn.style.display = 'inline-flex';
  const displayName = record['Fund Name'] || record['Work Name'] || record.Description || record.Category || record.ID;
  title.innerHTML = `✏️ সম্পাদনা: ${displayName}`;
  body.innerHTML = getFormFieldsHtml(sheet, record, record.Type);

  overlay.classList.add('active');
  modal.classList.add('active');

  if (sheet === 'production') {
    initProductionCalculationListeners();
  }
}

export function closeSheetModal() {
  const modal = document.getElementById('bottomSheetModal');
  const overlay = document.getElementById('modalOverlay');
  if (modal) modal.classList.remove('active');
  if (overlay) overlay.classList.remove('active');
  editingRecord = null;
  currentCompressedImageBase64 = null;
  currentDriveUploadResult = null;
  isUploadingToDrive = false;
}

/**
 * 🏷️ Dynamic Expense Categories Management
 */
export const DEFAULT_EXPENSE_CATEGORIES = [
  'পরিবার',
  'যাতায়াত',
  'খাবার',
  'মোবাইল বিল',
  'ইন্টারনেট বিল'
];

export function getExpenseCategories() {
  try {
    const raw = localStorage.getItem('smart_hisab_expense_categories');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Error reading expense categories:', err);
  }
  return [...DEFAULT_EXPENSE_CATEGORIES];
}

export function saveExpenseCategories(categories) {
  try {
    localStorage.setItem('smart_hisab_expense_categories', JSON.stringify(categories));
  } catch (err) {
    console.error('Error saving expense categories:', err);
  }
}

export function addExpenseCategory(cat) {
  if (!cat || !cat.trim()) return null;
  const trimmed = cat.trim();
  const current = getExpenseCategories();
  if (!current.includes(trimmed)) {
    current.push(trimmed);
    saveExpenseCategories(current);
  }
  return trimmed;
}

export function removeExpenseCategory(cat) {
  const current = getExpenseCategories().filter(c => c !== cat);
  saveExpenseCategories(current.length > 0 ? current : ['অন্যান্য']);
}

export function toggleCustomCategoryInput(show = null) {
  const box = document.getElementById('customCategoryBox');
  const input = document.getElementById('f_NewCategoryInput');
  if (!box) return;
  const shouldShow = show !== null ? show : (box.style.display === 'none' || !box.style.display);
  box.style.display = shouldShow ? 'block' : 'none';
  if (shouldShow && input) {
    input.focus();
  }
}

export function handleCategorySelectChange(selectElem) {
  if (selectElem.value === '__ADD_NEW__') {
    toggleCustomCategoryInput(true);
  } else {
    toggleCustomCategoryInput(false);
  }
}

export function saveAndSelectCustomCategory() {
  const input = document.getElementById('f_NewCategoryInput');
  const select = document.getElementById('f_Category');
  if (!input || !select) return;
  const name = input.value.trim();
  if (!name) {
    showToast('অনুগ্রহ করে ক্যাটাগরির নাম লিখুন', 'error');
    return;
  }
  
  const saved = addExpenseCategory(name);
  let opt = Array.from(select.options).find(o => o.value === saved);
  if (!opt) {
    opt = document.createElement('option');
    opt.value = saved;
    opt.textContent = saved;
    const addNewOpt = select.querySelector('option[value="__ADD_NEW__"]');
    if (addNewOpt) {
      select.insertBefore(opt, addNewOpt);
    } else {
      select.appendChild(opt);
    }
  }
  select.value = saved;
  input.value = '';
  toggleCustomCategoryInput(false);
  showToast(`✓ নতুন ক্যাটাগরি "${saved}" যোগ করা হয়েছে!`, 'success');
}

export function handleAddCategoryFromSettings() {
  const input = document.getElementById('settingsNewCatInput');
  if (!input) return;
  const name = input.value.trim();
  if (!name) {
    showToast('ক্যাটাগরির নাম লিখুন', 'error');
    return;
  }
  addExpenseCategory(name);
  input.value = '';
  showToast(`✓ ক্যাটাগরি "${name}" যুক্ত হয়েছে`, 'success');
  renderApp();
}

export function handleRemoveCategoryFromSettings(cat) {
  removeExpenseCategory(cat);
  showToast(`ক্যাটাগরি "${cat}" সরানো হয়েছে`, 'info');
  renderApp();
}

export function handleResetCategoriesToDefault() {
  saveExpenseCategories([...DEFAULT_EXPENSE_CATEGORIES]);
  showToast('✓ ক্যাটাগরি ডিফল্ট ৫টি তালিকায় রিসেট করা হয়েছে', 'info');
  renderApp();
}

function getTodayString() {
  return new Date().toISOString().split('T')[0];
}

function getFormFieldsHtml(sheet, record = null, defaultType = null) {
  const isEdit = Boolean(record);
  const today = getTodayString();
  const dateVal = record ? record.Date : today;

  if (sheet === 'income' || sheet === 'expense') {
    const isIncome = sheet === 'income';
    let categories = isIncome
      ? ['পণ্য বিক্রি', 'সার্ভিস চার্জ', 'বকেয়া আদায়', 'কমিশন', 'অন্যান্য']
      : getExpenseCategories();

    // Preserve existing category if editing a record with a custom/previous category
    if (record && record.Category && !categories.includes(record.Category)) {
      categories = [record.Category, ...categories];
    }

    return `
      <input type="hidden" id="f_Sheet" value="${sheet}" />
      <input type="hidden" id="f_ID" value="${record ? record.ID : ''}" />
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">তারিখ (Date):</label>
          <input type="date" id="f_Date" class="form-input font-mono" value="${dateVal}" required />
        </div>
        <div class="form-group">
          <label class="form-label">টাকার পরিমাণ (৳):</label>
          <input type="number" id="f_Amount" class="form-input font-mono" step="any" placeholder="0.00" value="${record ? record.Amount : ''}" required />
        </div>
      </div>
      <div class="form-group">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <label class="form-label" style="margin-bottom: 0;">ক্যাটাগরি:</label>
          ${!isIncome ? `
            <button type="button" class="btn btn-secondary" style="padding: 2px 8px; font-size: 0.72rem; line-height: 1.4; color: var(--gold-neon); border-color: rgba(217, 119, 6, 0.4);" onclick="window.SmartHisab.toggleCustomCategoryInput()">
              ➕ নতুন ক্যাটাগরি তৈরি
            </button>
          ` : ''}
        </div>
        <select id="f_Category" class="form-select" ${!isIncome ? 'onchange="window.SmartHisab.handleCategorySelectChange(this)"' : ''}>
          ${categories.map(c => `<option value="${c}" ${record && record.Category === c ? 'selected' : ''}>${c}</option>`).join('')}
          ${!isIncome ? '<option value="__ADD_NEW__">➕ নতুন ক্যাটাগরি তৈরি করুন...</option>' : ''}
        </select>

        ${!isIncome ? `
          <!-- Inline Custom Category Creator Box -->
          <div id="customCategoryBox" style="display: none; margin-top: 8px; padding: 10px; background: rgba(217, 119, 6, 0.08); border: 1px dashed rgba(217, 119, 6, 0.35); border-radius: var(--radius-xs);">
            <label style="display: block; font-size: 0.72rem; color: var(--gold-neon); margin-bottom: 4px; font-weight: 600;">নতুন ক্যাটাগরির নাম লিখুন:</label>
            <div style="display: flex; gap: 6px;">
              <input type="text" id="f_NewCategoryInput" class="form-input" style="padding: 6px 10px; font-size: 0.85rem;" placeholder="যেমন: উপহার, চিকিৎসা, যাতায়াত" onkeydown="if(event.key === 'Enter'){ event.preventDefault(); window.SmartHisab.saveAndSelectCustomCategory(); }" />
              <button type="button" class="btn btn-primary" style="padding: 6px 12px; font-size: 0.82rem; white-space: nowrap;" onclick="window.SmartHisab.saveAndSelectCustomCategory()">
                যোগ করুন
              </button>
              <button type="button" class="btn btn-secondary" style="padding: 6px 8px; font-size: 0.82rem;" onclick="window.SmartHisab.toggleCustomCategoryInput(false)">
                ✕
              </button>
            </div>
          </div>
        ` : ''}
      </div>
      <div class="form-group">
        <label class="form-label">নোট / বিবরণ:</label>
        <textarea id="f_Note" class="form-textarea" rows="2" placeholder="প্রয়োজনীয় বিবরণ লিখুন...">${record ? (record.Note || '') : ''}</textarea>
      </div>

      <div class="form-group" style="display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 8px 12px; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: var(--radius-xs);">
        <input type="checkbox" id="f_IsPending" style="width: 18px; height: 18px; accent-color: #F59E0B; cursor: pointer;" ${record && (record.IsPending || record.Status === 'Pending') ? 'checked' : ''} />
        <label for="f_IsPending" style="font-size: 0.82rem; font-weight: 600; color: #F59E0B; cursor: pointer; margin: 0;">
          ⏳ পেন্ডিং ট্রানজ্যাকশন (অনিষ্পন্ন লেনদেন)
        </label>
      </div>
    `;
  }

  if (sheet === 'production') {
    const prodType = record ? record.Type : (defaultType || 'Work');
    const selectedTag = (record && getProductionItemTag(record)) || 'শার্ট';
    return `
      <input type="hidden" id="f_Sheet" value="production" />
      <input type="hidden" id="f_ID" value="${record ? record.ID : ''}" />
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">ধরন (Type):</label>
          <select id="f_ProdType" class="form-select" onchange="window.SmartHisab.toggleProductionFields(this.value)">
            <option value="Work" ${prodType === 'Work' ? 'selected' : ''}>প্রোডাকশন কাজ (Work)</option>
            <option value="Withdrawal" ${prodType === 'Withdrawal' ? 'selected' : ''}>বিল উত্তোলন (Withdrawal)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">তারিখ (Date):</label>
          <input type="date" id="f_Date" class="form-input font-mono" value="${dateVal}" required />
        </div>
      </div>

      <div id="prodWorkFields" style="display: ${prodType === 'Work' ? 'block' : 'none'};">
        <!-- 🏷️ ৫টি ট্যাগ নির্বাচন: শার্ট, গোলগোলা, প্যান্ট, কটি, অন্যান্য -->
        <div class="form-group">
          <label class="form-label" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-weight: 700; color: var(--gold-neon);">🏷️ কাজের ট্যাগ (Tag / Category):</span>
            <span style="font-size: 0.72rem; color: var(--text-muted);">৫টি ক্যাটাগরির যেকোনো একটি বেছে নিন</span>
          </label>
          <div class="tag-selector-chips">
            <button type="button" class="prod-tag-btn ${selectedTag === 'শার্ট' ? 'active' : ''}" data-tag="শার্ট" onclick="window.SmartHisab.selectProductionTag('শার্ট')">👔 শার্ট</button>
            <button type="button" class="prod-tag-btn ${selectedTag === 'গোলগোলা' ? 'active' : ''}" data-tag="গোলগোলা" onclick="window.SmartHisab.selectProductionTag('গোলগোলা')">👕 গোলগোলা</button>
            <button type="button" class="prod-tag-btn ${selectedTag === 'প্যান্ট' ? 'active' : ''}" data-tag="প্যান্ট" onclick="window.SmartHisab.selectProductionTag('প্যান্ট')">👖 প্যান্ট</button>
            <button type="button" class="prod-tag-btn ${selectedTag === 'কটি' ? 'active' : ''}" data-tag="কটি" onclick="window.SmartHisab.selectProductionTag('কটি')">🦺 কটি</button>
            <button type="button" class="prod-tag-btn ${selectedTag === 'অন্যান্য' ? 'active' : ''}" data-tag="অন্যান্য" onclick="window.SmartHisab.selectProductionTag('অন্যান্য')">🏷️ অন্যান্য</button>
          </div>
          <input type="hidden" id="f_Tag" value="${selectedTag}" />
        </div>

        <div class="form-group">
          <label class="form-label">কাজের নাম (Work Name):</label>
          <input type="text" id="f_WorkName" class="form-input" placeholder="যেমন: পোলো শার্ট, গোল গলা টি-শার্ট, চিনো প্যান্ট" value="${record ? (record['Work Name'] || '') : ''}" oninput="window.SmartHisab.onWorkNameInput(this.value)" />
        </div>
        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label">সাইজ (Size):</label>
            <input type="text" id="f_Size" class="form-input" placeholder="M, L, XL" value="${record ? (record.Size || '') : ''}" />
          </div>
          <div class="form-group">
            <label class="form-label">রং (Color):</label>
            <input type="text" id="f_Color" class="form-input" placeholder="কালো, নেভি" value="${record ? (record.Color || '') : ''}" />
          </div>
        </div>
        <div class="form-grid-3">
          <div class="form-group">
            <label class="form-label">পিস (Pcs):</label>
            <input type="number" id="f_Pcs" class="form-input font-mono" placeholder="120" value="${record ? (record.Pcs || '') : ''}" />
          </div>
          <div class="form-group">
            <label class="form-label">ডজন (Dozen):</label>
            <input type="number" id="f_Dozen" class="form-input font-mono" step="0.01" placeholder="10" value="${record ? (record.Dozen || '') : ''}" />
          </div>
          <div class="form-group">
            <label class="form-label">রেট / ডজন (৳):</label>
            <input type="number" id="f_Rate" class="form-input font-mono" step="any" placeholder="650" value="${record ? (record.Rate || '') : ''}" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">মোট অর্জিত টাকা (Auto Earned ৳):</label>
          <input type="number" id="f_Earned" class="form-input font-mono" style="font-weight: 700; color: var(--cyan-cyber);" placeholder="0" value="${record ? (record.Earned || '') : ''}" />
        </div>

        <!-- ⏱️ কাজের শুরু ও শেষ সময় (Work Start & End Time) -->
        <div class="form-group" style="background: rgba(0, 242, 157, 0.04); border: 1px solid rgba(0, 242, 157, 0.25); border-radius: var(--radius-sm); padding: 12px 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <label class="form-label" style="margin: 0; color: var(--green-electric); font-weight: 700; display: flex; align-items: center; gap: 6px;">
              <span>⏱️ কাজের সময়কাল (Start & End Time)</span>
            </label>
            <span id="prodDurationBadge" style="font-size: 0.76rem; font-family: var(--font-mono); color: var(--gold-neon); font-weight: 700;">
              ${record && (record['Duration'] || record.Duration) ? `(${record['Duration'] || record.Duration})` : ''}
            </span>
          </div>
          
          <div class="form-grid-2">
            <!-- Start Section -->
            <div style="background: rgba(0,0,0,0.25); padding: 9px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                <span style="font-size: 0.74rem; color: var(--green-electric); font-weight: 700;">🟢 শুরুর সময়:</span>
                <button type="button" class="chip-btn" style="font-size: 0.7rem; padding: 2px 8px; border-color: rgba(0, 242, 157, 0.4); color: var(--green-electric);" onclick="window.SmartHisab.setProductionCurrentTime('start')">⏰ এখন শুরু</button>
              </div>
              <div style="display: flex; flex-direction: column; gap: 6px;">
                <input type="date" id="f_StartDate" class="form-input font-mono" style="font-size: 0.78rem; padding: 5px 8px;" value="${record ? (record['Start Date'] || record.StartDate || record.Date || dateVal) : dateVal}" onchange="window.SmartHisab.calcProductionDuration()" />
                <input type="time" id="f_StartTime" class="form-input font-mono" value="${record ? (record['Start Time'] || record.StartTime || '') : ''}" onchange="window.SmartHisab.calcProductionDuration()" />
              </div>
            </div>

            <!-- End Section -->
            <div style="background: rgba(0,0,0,0.25); padding: 9px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                <span style="font-size: 0.74rem; color: var(--gold-neon); font-weight: 700;">🔴 শেষ করার সময়:</span>
                <div style="display: flex; gap: 4px;">
                  <button type="button" class="chip-btn" style="font-size: 0.68rem; padding: 2px 5px;" onclick="window.SmartHisab.setEndDatePreset('same')" title="শুরুর দিনের সমান">একই দিন</button>
                  <button type="button" class="chip-btn" style="font-size: 0.68rem; padding: 2px 5px;" onclick="window.SmartHisab.setEndDatePreset('next')" title="পরের দিন">+১ দিন</button>
                  <button type="button" class="chip-btn" style="font-size: 0.7rem; padding: 2px 8px; border-color: rgba(245, 158, 11, 0.4); color: var(--gold-neon);" onclick="window.SmartHisab.setProductionCurrentTime('end')">⏰ এখন শেষ</button>
                </div>
              </div>
              <div style="display: flex; flex-direction: column; gap: 6px;">
                <input type="date" id="f_EndDate" class="form-input font-mono" style="font-size: 0.78rem; padding: 5px 8px;" value="${record ? (record['End Date'] || record.EndDate || record['Start Date'] || record.Date || dateVal) : dateVal}" onchange="window.SmartHisab.calcProductionDuration()" />
                <input type="time" id="f_EndTime" class="form-input font-mono" value="${record ? (record['End Time'] || record.EndTime || '') : ''}" onchange="window.SmartHisab.calcProductionDuration()" />
              </div>
            </div>
          </div>

          <!-- Dynamic Live Time Preview Box -->
          <div id="prodLiveTimePreview" style="margin-top: 8px; padding: 8px 12px; background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(0, 242, 157, 0.2); border-radius: var(--radius-xs);">
            ${record && (record['Start Time'] || record['End Time']) ? `
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.1rem;">⏱️</span>
                <span style="font-family: var(--font-bangla); font-size: 0.84rem; color: var(--text-pure); font-weight: 600;">
                  ${formatProductionTimeRange(record)}
                </span>
              </div>
            ` : `
              <span style="color: var(--text-dim); font-size: 0.76rem;">কাজের শুরুর ও শেষ সময় দিলে ফরম্যাটেড প্রিভিউ এখানে দৃশ্যমান হবে (যেমন: শুরু - মঙ্গলবার সকাল ১০:২৫, শেষ - বুধবার সন্ধ্যা ৬:৪৫ (১ দিন ৮ ঘণ্টা ২০ মিনিট))</span>
            `}
          </div>

          <input type="hidden" id="f_Duration" value="${record ? (record['Duration'] || record.Duration || '') : ''}" />
        </div>

        <!-- 📸 Image Attachment Options (Phone Storage, Camera, Google Photos) -->
        <div class="form-group">
          <label class="form-label" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span>কাজের স্যাম্পল ছবি (Drive Storage):</span>
            <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 400;">Google Drive এ স্থায়ীভাবে সংরক্ষিত হবে</span>
          </label>

          <!-- ☁️ Google Drive Cloud Sync Status & Quick Connect Card -->
          <div id="driveSyncStatusBox" style="margin-bottom: 10px; padding: 10px 14px; border-radius: var(--radius-sm); border: 1px solid ${isDriveConnected() ? 'rgba(0, 242, 157, 0.35)' : 'rgba(245, 158, 11, 0.45)'}; background: ${isDriveConnected() ? 'rgba(0, 242, 157, 0.06)' : 'rgba(245, 158, 11, 0.08)'};">
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.2rem;">${isDriveConnected() ? '🟢' : '☁️'}</span>
                <div>
                  <div style="font-size: 0.82rem; font-weight: 700; color: ${isDriveConnected() ? 'var(--green-electric)' : 'var(--gold-neon)'};">
                    ${isDriveConnected() ? 'Google Drive ক্লাউড সিঙ্ক সক্রিয়' : 'Google Drive ক্লাউড সিঙ্ক সংযুক্ত নেই'}
                  </div>
                  <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">
                    ${isDriveConnected() ? 'ছবি সরাসরি Google Drive এ সংরক্ষিত হয়ে অন্য সব ব্রাউজার ও ডিভাইসে সিঙ্ক হবে।' : 'অন্যান্য ব্রাউজার ও ডিভাইসে ছবি দেখতে এক ক্লিকে অনুমতি দিন:'}
                  </div>
                </div>
              </div>
              ${!isDriveConnected() ? `
                <button type="button" class="btn btn-primary" style="font-size: 0.76rem; padding: 6px 12px; white-space: nowrap;" onclick="window.SmartHisab.connectGoogleDriveFromForm()">
                  🔗 Google Drive সংযুক্ত করুন
                </button>
              ` : `
                <span class="font-mono" style="font-size: 0.72rem; color: var(--green-electric); font-weight: 600;">✓ সিঙ্ক সক্রিয়</span>
              `}
            </div>
          </div>

          <!-- Hidden Native File Inputs -->
          <input type="file" id="f_prodImageStorage" accept="image/*" style="display: none;" onchange="window.SmartHisab.handleImageSelected(event)" />
          <input type="file" id="f_prodImageCamera" accept="image/*" capture="environment" style="display: none;" onchange="window.SmartHisab.handleImageSelected(event)" />

          <!-- Attachment Options Selector Card -->
          <div class="image-upload-options-card" style="background: var(--bg-input); border: 1.5px dashed var(--border-subtle); border-radius: var(--radius-sm); padding: 14px;">
            <div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 10px; text-align: center;">
              ছবি যুক্ত করার অপশন বেছে নিন:
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(105px, 1fr)); gap: 8px;">
              <button type="button" class="btn btn-secondary" style="font-size: 0.78rem; padding: 8px 10px; border-color: rgba(66, 133, 244, 0.4); color: #8AB4F8;" onclick="document.getElementById('f_prodImageStorage').click()" title="ফোনের ফাইল ম্যানেজার, গ্যালারি বা Google Photos অ্যাপ থেকে ছবি সিলেক্ট করুন">
                📱 ফোন স্টোরেজ
              </button>
              <button type="button" class="btn btn-secondary" style="font-size: 0.78rem; padding: 8px 10px; border-color: rgba(0, 242, 157, 0.4); color: var(--green-electric);" onclick="document.getElementById('f_prodImageCamera').click()" title="সরাসরি ক্যামেরা দিয়ে ছবি তুলুন">
                📷 ক্যামেরা
              </button>
              <button type="button" class="btn btn-secondary" style="font-size: 0.78rem; padding: 8px 10px; border-color: rgba(245, 158, 11, 0.4); color: var(--gold-neon);" onclick="window.SmartHisab.togglePhotoUrlInput()" title="Google Photos শেয়ার্ড লিঙ্ক বা ইমেজ লিঙ্ক দিয়ে ছবি আনুন">
                🖼️ Google Photos
              </button>
            </div>

            <!-- Inline Google Photos / URL Link Box -->
            <div id="photoUrlInputBox" style="display: none; margin-top: 12px; padding: 10px; background: rgba(0, 210, 255, 0.05); border: 1px dashed rgba(0, 210, 255, 0.35); border-radius: var(--radius-xs);">
              <label style="display: block; font-size: 0.72rem; color: var(--cyan-cyber); margin-bottom: 4px; font-weight: 600;">
                Google Photos শেয়ার্ড লিঙ্ক বা ছবির URL পেস্ট করুন:
              </label>
              <div style="display: flex; gap: 6px;">
                <input type="url" id="f_photoUrlInput" class="form-input" style="font-size: 0.8rem; padding: 6px 10px;" placeholder="https://photos.app.goo.gl/... বা ড্রাইভ লিঙ্ক" onkeydown="if(event.key === 'Enter'){ event.preventDefault(); window.SmartHisab.handleLoadImageFromUrl(); }" />
                <button type="button" class="btn btn-primary" style="padding: 6px 12px; font-size: 0.8rem; white-space: nowrap;" onclick="window.SmartHisab.handleLoadImageFromUrl()">
                  আনুন
                </button>
                <button type="button" class="btn btn-secondary" style="padding: 6px 8px; font-size: 0.8rem;" onclick="window.SmartHisab.togglePhotoUrlInput(false)">
                  ✕
                </button>
              </div>
              <div style="font-size: 0.68rem; color: var(--text-muted); margin-top: 5px;">
                💡 Google Photos অ্যাপে ছবির <strong>Share &gt; "Create link"</strong>-এ ক্লিক করে লিংকটি এখানে পেস্ট করতে পারেন।
              </div>
            </div>

            <!-- Image Preview Area -->
            <div id="imagePreviewBox" style="display: ${record && record.Image_URL ? 'block' : 'none'}; margin-top: 12px; text-align: center;">
              <div class="image-preview-wrapper" style="position: relative; display: inline-block;">
                <img id="attachedImgThumb" src="${record ? (record.Image_URL || '') : ''}" alt="প্রোডাকশন স্যাম্পল" style="max-height: 160px; max-width: 100%; border-radius: 8px; border: 1px solid var(--border-subtle); object-fit: contain; background: #000;" />
                <button type="button" class="img-remove-btn" onclick="window.SmartHisab.removeAttachedImage(event)" title="ছবি রিমুভ / পরিবর্তন করুন">✕</button>
              </div>
              <p id="imageCompressionBadge" style="font-size: 0.75rem; color: var(--green-electric); margin-top: 6px; font-family: var(--font-mono);">
                ✓ ছবি প্রস্তুত (Google Drive এ স্বয়ংক্রিয়ভাবে সংরক্ষিত হবে)
              </p>
            </div>
          </div>
        </div>
      </div>

      <div id="prodWithdrawalFields" style="display: ${prodType === 'Withdrawal' ? 'block' : 'none'};">
        <div class="form-group">
          <label class="form-label">উত্তোলনকৃত টাকার পরিমাণ (Received ৳):</label>
          <input type="number" id="f_Received" class="form-input font-mono" step="any" style="font-weight: 700; color: var(--gold-neon);" placeholder="0.00" value="${record ? (record.Received || record.Amount || '') : ''}" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">নোট / রিমার্কস:</label>
        <textarea id="f_ProdNote" class="form-textarea" rows="2" placeholder="প্রয়োজনীয় নোট...">${record ? (record.Note || '') : ''}</textarea>
      </div>

      <div class="form-group" style="display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 8px 12px; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: var(--radius-xs);">
        <input type="checkbox" id="f_IsPending" style="width: 18px; height: 18px; accent-color: #F59E0B; cursor: pointer;" ${record && (record.IsPending || record.Status === 'Pending') ? 'checked' : ''} />
        <label for="f_IsPending" style="font-size: 0.82rem; font-weight: 600; color: #F59E0B; cursor: pointer; margin: 0;">
          ⏳ পেন্ডিং ট্রানজ্যাকশন (অনিষ্পন্ন লেনদেন)
        </label>
      </div>
    `;
  }

  if (sheet === 'loan') {
    return `
      <input type="hidden" id="f_Sheet" value="loan" />
      <input type="hidden" id="f_ID" value="${record ? record.ID : ''}" />
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">তারিখ (Date):</label>
          <input type="date" id="f_Date" class="form-input font-mono" value="${dateVal}" required />
        </div>
        <div class="form-group">
          <label class="form-label">বিবরণ / ঋণদাতার নাম:</label>
          <input type="text" id="f_LoanDesc" class="form-input" placeholder="যেমন: ব্যাংক লোন, করিম ভাই" value="${record ? (record.Description || '') : ''}" required />
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">গৃহীত ঋণ (Loan Taken ৳):</label>
          <input type="number" id="f_LoanTaken" class="form-input font-mono" step="any" placeholder="0.00" value="${record ? (record['Loan Taken'] || '') : ''}" />
        </div>
        <div class="form-group">
          <label class="form-label">পরিশোধকৃত টাকা (Loan Paid ৳):</label>
          <input type="number" id="f_LoanPaid" class="form-input font-mono" step="any" placeholder="0.00" value="${record ? (record['Loan Paid'] || '') : ''}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">নোট:</label>
        <textarea id="f_LoanNote" class="form-textarea" rows="2" placeholder="কিস্তির শর্ত বা বিবরণ...">${record ? (record.Note || '') : ''}</textarea>
      </div>

      <div class="form-group" style="display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 8px 12px; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: var(--radius-xs);">
        <input type="checkbox" id="f_IsPending" style="width: 18px; height: 18px; accent-color: #F59E0B; cursor: pointer;" ${record && (record.IsPending || record.Status === 'Pending') ? 'checked' : ''} />
        <label for="f_IsPending" style="font-size: 0.82rem; font-weight: 600; color: #F59E0B; cursor: pointer; margin: 0;">
          ⏳ পেন্ডিং ট্রানজ্যাকশন (অনিষ্পন্ন ঋণ)
        </label>
      </div>
    `;
  }

  if (sheet === 'fund') {
    return `
      <input type="hidden" id="f_Sheet" value="fund" />
      <input type="hidden" id="f_ID" value="${record ? record.ID : ''}" />
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">তারিখ (Date):</label>
          <input type="date" id="f_Date" class="form-input font-mono" value="${dateVal}" required />
        </div>
        <div class="form-group">
          <label class="form-label">ফান্ডের নাম:</label>
          <input type="text" id="f_FundName" class="form-input" placeholder="যেমন: ফ্যাক্টরি ইমার্জেন্সি ফান্ড" value="${record ? (record['Fund Name'] || '') : ''}" required />
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">টার্গেট বাজেট (Target Budget ৳):</label>
          <input type="number" id="f_FundTarget" class="form-input font-mono" step="any" placeholder="50000" value="${record ? (record['Target Budget'] || '') : ''}" />
        </div>
        <div class="form-group">
          <label class="form-label">স্ট্যাটাস:</label>
          <select id="f_FundStatus" class="form-select">
            <option value="Active" ${record && record.Status === 'Active' ? 'selected' : ''}>Active (চলমান)</option>
            <option value="Archived" ${record && record.Status === 'Archived' ? 'selected' : ''}>Archived (আর্কাইভ)</option>
          </select>
        </div>
      </div>
    `;
  }

  if (sheet === 'fund_transaction') {
    const funds = appData.fund || [];
    return `
      <input type="hidden" id="f_Sheet" value="fund_transaction" />
      <input type="hidden" id="f_ID" value="${record ? record.ID : ''}" />
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">তারিখ (Date):</label>
          <input type="date" id="f_Date" class="form-input font-mono" value="${dateVal}" required />
        </div>
        <div class="form-group">
          <label class="form-label">ফান্ড নির্বাচন করুন:</label>
          <select id="f_FundId" class="form-select">
            ${funds.map(f => `<option value="${f.ID}" ${record && String(record['Fund ID']) === String(f.ID) ? 'selected' : ''}>${f['Fund Name']}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">লেনদেনের ধরন:</label>
          <select id="f_FundTxType" class="form-select">
            <option value="In" ${record && record.Type === 'In' ? 'selected' : ''}>📥 ফান্ডে জমা (In)</option>
            <option value="Out" ${record && record.Type === 'Out' ? 'selected' : ''}>📤 ফান্ড থেকে খরচ (Out)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">টাকার পরিমাণ (৳):</label>
          <input type="number" id="f_FundAmount" class="form-input font-mono" step="any" placeholder="0.00" value="${record ? record.Amount : ''}" required />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">ক্যাটাগরি / বিবরণ নোট:</label>
        <input type="text" id="f_FundCategoryNote" class="form-input" placeholder="যেমন: সাপ্তাহিক উদ্বৃত্ত জমা" value="${record ? (record['Category/Note'] || record.Note || '') : ''}" />
      </div>

      <div class="form-group" style="display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 8px 12px; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: var(--radius-xs);">
        <input type="checkbox" id="f_IsPending" style="width: 18px; height: 18px; accent-color: #F59E0B; cursor: pointer;" ${record && (record.IsPending || record.Status === 'Pending') ? 'checked' : ''} />
        <label for="f_IsPending" style="font-size: 0.82rem; font-weight: 600; color: #F59E0B; cursor: pointer; margin: 0;">
          ⏳ পেন্ডিং ট্রানজ্যাকশন (অনিষ্পন্ন লেনদেন)
        </label>
      </div>
    `;
  }

  return '';
}

export function toggleProductionFields(type) {
  const w = document.getElementById('prodWorkFields');
  const d = document.getElementById('prodWithdrawalFields');
  if (w) w.style.display = type === 'Work' ? 'block' : 'none';
  if (d) d.style.display = type === 'Withdrawal' ? 'block' : 'none';
}

function initProductionCalculationListeners() {
  const pcsIn = document.getElementById('f_Pcs');
  const dozenIn = document.getElementById('f_Dozen');
  const rateIn = document.getElementById('f_Rate');
  const earnedIn = document.getElementById('f_Earned');

  if (!pcsIn || !dozenIn || !rateIn || !earnedIn) return;

  pcsIn.addEventListener('input', () => {
    const pcs = Number(pcsIn.value) || 0;
    if (pcs > 0) {
      dozenIn.value = (pcs / 12).toFixed(2);
      calcEarned();
    }
  });

  dozenIn.addEventListener('input', calcEarned);
  rateIn.addEventListener('input', calcEarned);

  function calcEarned() {
    const doz = Number(dozenIn.value) || 0;
    const rate = Number(rateIn.value) || 0;
    earnedIn.value = Math.round(doz * rate);
  }
}

/**
 * 🏷️ Interactive Tag Selection for Production Form
 */
export function selectProductionTag(tag) {
  const hiddenIn = document.getElementById('f_Tag');
  if (hiddenIn) {
    hiddenIn.value = tag;
    hiddenIn.dataset.userSelected = 'true';
  }

  const buttons = document.querySelectorAll('.prod-tag-btn');
  buttons.forEach(btn => {
    if (btn.getAttribute('data-tag') === tag) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

/**
 * Auto-suggest tag when user types work name
 */
export function onWorkNameInput(val) {
  if (!val) return;
  const tagInput = document.getElementById('f_Tag');
  if (tagInput && tagInput.dataset.userSelected === 'true') return; // User made manual choice

  const clean = String(val).toLowerCase();
  let suggested = '';
  if (clean.includes('গোলগোলা') || clean.includes('গোল গলা') || clean.includes('গোল-গলা')) suggested = 'গোলগোলা';
  else if (clean.includes('শার্ট') || clean.includes('shirt')) suggested = 'শার্ট';
  else if (clean.includes('প্যান্ট') || clean.includes('pant') || clean.includes('trouser')) suggested = 'প্যান্ট';
  else if (clean.includes('কটি') || clean.includes('koti') || clean.includes('কোটি')) suggested = 'কটি';

  if (suggested) {
    selectProductionTag(suggested);
  }
}

/**
 * Quick button to set current local time (HH:mm) for Production Start or End Time
 */
export function setProductionCurrentTime(type) {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;

  const targetInput = document.getElementById(type === 'start' ? 'f_StartTime' : 'f_EndTime');
  if (targetInput) {
    targetInput.value = timeStr;
    calcProductionDuration();
    showToast(`${type === 'start' ? 'শুরু করার সময়' : 'শেষ করার সময়'} সেট করা হয়েছে: ${formatBengaliTime12(Number(hours), Number(minutes))}`, 'info');
  }
}

/**
 * Quick preset for End Date (same day or next day)
 */
export function setEndDatePreset(mode) {
  const startDate = document.getElementById('f_StartDate')?.value || document.getElementById('f_Date')?.value || new Date().toISOString().split('T')[0];
  const endInput = document.getElementById('f_EndDate');
  if (!endInput) return;
  if (mode === 'same') {
    endInput.value = startDate;
  } else if (mode === 'next') {
    const d = new Date(startDate + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    endInput.value = d.toISOString().split('T')[0];
  }
  calcProductionDuration();
}

/**
 * Calculates and displays total work shift duration between Start and End Time in Bengali format
 */
export function calcProductionDuration() {
  const startDate = document.getElementById('f_StartDate')?.value || document.getElementById('f_Date')?.value || '';
  const startTime = document.getElementById('f_StartTime')?.value || '';
  let endDate = document.getElementById('f_EndDate')?.value || '';
  const endTime = document.getElementById('f_EndTime')?.value || '';
  const previewEl = document.getElementById('prodLiveTimePreview');
  const badge = document.getElementById('prodDurationBadge');
  const hiddenIn = document.getElementById('f_Duration');

  if (!startTime) {
    if (previewEl) {
      previewEl.innerHTML = '<span style="color: var(--text-dim); font-size: 0.76rem;">কাজের শুরুর ও শেষ সময় দিলে ফরম্যাটেড প্রিভিউ এখানে দৃশ্যমান হবে (যেমন: শুরু - মঙ্গলবার সকাল ১০:২৫, শেষ - বুধবার সন্ধ্যা ৬:৪৫ (১ দিন ৮ ঘণ্টা ২০ মিনিট))</span>';
    }
    if (badge) badge.textContent = '';
    if (hiddenIn) hiddenIn.value = '';
    return;
  }

  // Overnight or next day detection if endDate not explicitly set
  if (!endDate && startDate) {
    if (startTime && endTime) {
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      if (eh < sh || (eh === sh && em < sm)) {
        const nextD = new Date(startDate + 'T12:00:00');
        nextD.setDate(nextD.getDate() + 1);
        endDate = nextD.toISOString().split('T')[0];
        const endInput = document.getElementById('f_EndDate');
        if (endInput && !endInput.value) endInput.value = endDate;
      } else {
        endDate = startDate;
      }
    } else {
      endDate = startDate;
    }
  }

  const dummyRecord = {
    'Start Date': startDate,
    'Start Time': startTime,
    'End Date': endDate,
    'End Time': endTime,
    Date: startDate
  };

  const formattedStr = formatProductionTimeRange(dummyRecord);
  
  if (previewEl) {
    previewEl.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 1.1rem;">⏱️</span>
        <span style="font-family: var(--font-bangla); font-size: 0.84rem; color: var(--text-pure); font-weight: 600;">
          ${formattedStr}
        </span>
      </div>
    `;
  }

  const durMatch = formattedStr.match(/\(([^)]+)\)$/);
  const durVal = durMatch ? durMatch[1] : '';
  if (badge) {
    badge.innerHTML = durVal ? `(${durVal})` : '';
  }
  if (hiddenIn) {
    hiddenIn.value = durVal;
  }
}

/**
 * 🔗 Direct user-triggered Google Drive authorization from form
 */
export async function connectGoogleDriveFromForm() {
  try {
    showToast('Google Drive অনুমোদন স্ক্রিন চালু হচ্ছে...', 'info');
    const token = await connectGoogleDrive();
    if (token) {
      showToast('✓ Google Drive সফলভাবে সংযুক্ত হয়েছে!', 'success');
      const statusBox = document.getElementById('driveSyncStatusBox');
      if (statusBox) {
        statusBox.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1.2rem;">🟢</span>
              <div>
                <div style="font-size: 0.82rem; font-weight: 700; color: var(--green-electric);">
                  Google Drive ক্লাউড সিঙ্ক সক্রিয়
                </div>
                <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">
                  ছবি সরাসরি Google Drive এ সংরক্ষিত হয়ে অন্য সব ব্রাউজার ও ডিভাইসে সিঙ্ক হবে।
                </div>
              </div>
            </div>
            <span class="font-mono" style="font-size: 0.72rem; color: var(--green-electric); font-weight: 600;">✓ সিঙ্ক সক্রিয়</span>
          </div>
        `;
        statusBox.style.borderColor = 'rgba(0, 242, 157, 0.35)';
        statusBox.style.background = 'rgba(0, 242, 157, 0.06)';
      }
      if (currentCompressedImageBase64 && !currentDriveUploadResult) {
        triggerDriveUploadForCurrentForm();
      }
    }
  } catch (err) {
    console.error('Google Drive connect error:', err);
    showToast('Google Drive অনুমোদন ব্যর্থ: ' + (err.message || ''), 'warning');
  }
}

/**
 * 🔗 Google Drive connect from settings view
 */
export async function connectGoogleDriveFromSettings() {
  try {
    showToast('Google Drive অনুমোদন স্ক্রিন চালু হচ্ছে...', 'info');
    const token = await connectGoogleDrive();
    if (token) {
      showToast('✓ Google Drive সফলভাবে সংযুক্ত হয়েছে!', 'success');
      renderApp();
    }
  } catch (err) {
    console.error('Google Drive settings connect error:', err);
    showToast('Google Drive সংযোগে সমস্যা: ' + (err.message || ''), 'warning');
  }
}

/**
 * ☁️ Background uploader for current modal's image
 */
export async function triggerDriveUploadForCurrentForm() {
  if (!currentCompressedImageBase64) return;
  const token = getCachedAccessToken();
  if (!token) return;

  isUploadingToDrive = true;
  const badge = document.getElementById('imageCompressionBadge');
  if (badge) {
    badge.innerHTML = '<span style="color: var(--cyan-cyber); font-family: var(--font-mono);">☁️ Google Drive এ ব্যাকগ্রাউন্ডে আপলোড হচ্ছে...</span>';
  }

  try {
    const workName = document.getElementById('f_WorkName')?.value || 'Production';
    const cleanName = workName.replace(/[^a-zA-Z0-9_\u0980-\u09FF]/g, '_');
    const fileName = `SmartHisab_${cleanName}_${Date.now()}.jpg`;

    const driveUpload = await uploadImageToDrive(currentCompressedImageBase64, fileName, token, {
      workName
    });

    if (driveUpload && driveUpload.directImageUrl) {
      currentDriveUploadResult = driveUpload;
      if (badge) {
        badge.innerHTML = '<span style="color: var(--green-electric); font-weight: 700;">✓ Google Drive এ সফলভাবে আপলোড হয়েছে! (সব ব্রাউজারে সিঙ্ক সক্রিয়)</span>';
      }
      showToast('✓ Google Drive এ ছবি আপলোড সম্পন্ন হয়েছে!', 'success');
    }
  } catch (err) {
    console.warn('Background Drive upload notice:', err);
    if (badge) {
      badge.innerHTML = '<span style="color: var(--gold-neon);">⚠️ Google Drive আপলোডে বিলম্ব, সেভ করার সময় স্বয়ংক্রিয় ক্লাউড সিঙ্ক হবে</span>';
    }
  } finally {
    isUploadingToDrive = false;
  }
}

/**
 * Handle Production Image File Selection & Compression
 */
export async function handleImageSelected(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    showToast('ইমেজ অপটিমাইজ ও কম্প্রেস করা হচ্ছে...', 'info');
    const base64Data = await compressImageFile(file, 800, 0.7);
    currentCompressedImageBase64 = base64Data;
    currentDriveUploadResult = null;

    const previewBox = document.getElementById('imagePreviewBox');
    const thumb = document.getElementById('attachedImgThumb');
    const badge = document.getElementById('imageCompressionBadge');

    if (thumb) thumb.src = base64Data;
    if (previewBox) previewBox.style.display = 'block';

    if (isDriveConnected()) {
      if (badge) badge.innerHTML = '<span style="color: var(--cyan-cyber);">☁️ Google Drive এ ব্যাকগ্রাউন্ডে আপলোড হচ্ছে...</span>';
      triggerDriveUploadForCurrentForm();
    } else {
      if (badge) badge.innerHTML = '<span style="color: var(--gold-neon);">⚠️ Google Drive সংযুক্ত নেই — সব ব্রাউজারে দেখতে উপরের বাটনে ট্যাপ করে সিঙ্ক করুন</span>';
    }

    showToast('✓ ছবি সফলভাবে সিলেক্ট হয়েছে', 'success');
  } catch (err) {
    showToast('ইমেজ প্রক্রিয়াকরণ ত্রুটি: ' + err.message, 'error');
  }
}

export function togglePhotoUrlInput(forceState = null) {
  const box = document.getElementById('photoUrlInputBox');
  if (!box) return;
  const isVisible = box.style.display !== 'none';
  const next = forceState !== null ? forceState : !isVisible;
  box.style.display = next ? 'block' : 'none';
  if (next) {
    const input = document.getElementById('f_photoUrlInput');
    if (input) setTimeout(() => input.focus(), 50);
  }
}

/**
 * Load image from Google Photos share link or web image URL
 */
export async function handleLoadImageFromUrl() {
  const input = document.getElementById('f_photoUrlInput');
  const rawUrl = input?.value?.trim();
  if (!rawUrl) {
    showToast('দয়া করে Google Photos বা ছবির একটি লিঙ্ক দিন', 'warning');
    return;
  }

  showToast('ছবির লিঙ্ক প্রসেস করা হচ্ছে...', 'info');

  try {
    // Check if Google Drive link and convert to direct preview thumbnail
    const driveId = extractDriveFileId(rawUrl);
    let targetUrl = rawUrl;
    if (driveId) {
      targetUrl = `https://drive.google.com/thumbnail?id=${driveId}&sz=s1000`;
    }

    // Load image into canvas for high-performance offline base64 compression
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const loadedData = await new Promise((resolve) => {
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          let width = img.naturalWidth || img.width;
          let height = img.naturalHeight || img.height;
          const maxDim = 800;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.75));
        } catch (canvasErr) {
          console.warn('Canvas export fallback to direct URL:', canvasErr);
          resolve(targetUrl);
        }
      };
      img.onerror = () => {
        // Direct image URL fallback
        resolve(targetUrl);
      };
      img.src = targetUrl;
    });

    currentCompressedImageBase64 = (typeof loadedData === 'string' && loadedData.startsWith('data:image')) ? loadedData : null;

    const previewBox = document.getElementById('imagePreviewBox');
    const thumb = document.getElementById('attachedImgThumb');
    const badge = document.getElementById('imageCompressionBadge');

    if (thumb) thumb.src = loadedData;
    if (previewBox) previewBox.style.display = 'block';
    if (badge) badge.textContent = '✓ Google Photos / লিঙ্ক থেকে ছবি লোড হয়েছে';

    showToast('✓ ছবি সফলভাবে লোড হয়েছে!', 'success');
    togglePhotoUrlInput(false);
  } catch (err) {
    showToast('ছবি লোড করতে সমস্যা হয়েছে: ' + err.message, 'error');
  }
}

export function removeAttachedImage(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  currentCompressedImageBase64 = null;
  const storageInput = document.getElementById('f_prodImageStorage');
  if (storageInput) storageInput.value = '';
  const cameraInput = document.getElementById('f_prodImageCamera');
  if (cameraInput) cameraInput.value = '';
  const urlInput = document.getElementById('f_photoUrlInput');
  if (urlInput) urlInput.value = '';

  const previewBox = document.getElementById('imagePreviewBox');
  const thumb = document.getElementById('attachedImgThumb');

  if (thumb) thumb.src = '';
  if (previewBox) previewBox.style.display = 'none';
  showToast('ছবি রিমুভ করা হয়েছে', 'info');
}

/**
 * Submit Bottom Sheet Form
 */
export async function submitSheetForm() {
  const sheet = document.getElementById('f_Sheet')?.value;
  if (!sheet) return;

  const isEdit = Boolean(editingRecord && editingRecord.record);
  const existingId = editingRecord ? editingRecord.record.ID : null;
  const recordId = isEdit ? existingId : generateId(sheet);

  let newRow = { ID: recordId };

  if (sheet === 'income' || sheet === 'expense') {
    newRow.Date = document.getElementById('f_Date')?.value || getTodayString();
    newRow.Amount = Number(document.getElementById('f_Amount')?.value) || 0;
    let catVal = document.getElementById('f_Category')?.value || '';
    if (sheet === 'expense' && catVal === '__ADD_NEW__') {
      const customVal = document.getElementById('f_NewCategoryInput')?.value?.trim();
      if (customVal) {
        addExpenseCategory(customVal);
        catVal = customVal;
      } else {
        catVal = 'পরিবার';
      }
    }
    newRow.Category = catVal || (sheet === 'expense' ? 'পরিবার' : 'অন্যান্য');
    newRow.Note = document.getElementById('f_Note')?.value || '';
  } else if (sheet === 'production') {
    const type = document.getElementById('f_ProdType')?.value || 'Work';
    newRow.Date = document.getElementById('f_Date')?.value || getTodayString();
    newRow.Type = type;
    newRow.Note = document.getElementById('f_ProdNote')?.value || '';

    if (type === 'Work') {
      const tagVal = document.getElementById('f_Tag')?.value || 'অন্যান্য';
      newRow.Tag = tagVal;
      newRow['Work Name'] = document.getElementById('f_WorkName')?.value || '';
      newRow.Size = document.getElementById('f_Size')?.value || '';
      newRow.Color = document.getElementById('f_Color')?.value || '';
      newRow.Pcs = Number(document.getElementById('f_Pcs')?.value) || 0;
      newRow.Dozen = Number(document.getElementById('f_Dozen')?.value) || 0;
      newRow.Rate = Number(document.getElementById('f_Rate')?.value) || 0;
      newRow.Earned = Number(document.getElementById('f_Earned')?.value) || 0;
      newRow.Received = 0;

      // ⏱️ Start & End Date and Time tracking
      const startDate = document.getElementById('f_StartDate')?.value || newRow.Date;
      const startTime = document.getElementById('f_StartTime')?.value || '';
      const endDate = document.getElementById('f_EndDate')?.value || '';
      const endTime = document.getElementById('f_EndTime')?.value || '';

      newRow['Start Date'] = startDate;
      newRow['Start Time'] = startTime;
      newRow['End Date'] = endDate;
      newRow['End Time'] = endTime;

      const fullTimeStr = formatProductionTimeRange(newRow);
      const durMatch = fullTimeStr.match(/\(([^)]+)\)$/);
      const durVal = durMatch ? durMatch[1] : (document.getElementById('f_Duration')?.value || '');
      newRow.Duration = durVal;

      // Add tag & formatted time to Note for Google Sheets universal fallback
      const metaTags = [];
      if (tagVal) metaTags.push(`[ট্যাগ: ${tagVal}]`);
      if (fullTimeStr) metaTags.push(`[${fullTimeStr}]`);

      if (metaTags.length > 0) {
        let cleanNote = (newRow.Note || '').replace(/\[ট্যাগ:[^\]]*\]/g, '').replace(/\[সময়:[^\]]*\]/g, '').replace(/\[শুরু[^\]]*\]/g, '').trim();
        newRow.Note = cleanNote ? `${cleanNote} ${metaTags.join(' ')}` : metaTags.join(' ');
      }
    } else {
      newRow.Tag = 'অন্যান্য';
      newRow['Work Name'] = 'বিল উত্তোলন';
      newRow.Size = '-';
      newRow.Color = '-';
      newRow.Pcs = 0;
      newRow.Dozen = 0;
      newRow.Rate = 0;
      newRow.Earned = 0;
      newRow.Received = Number(document.getElementById('f_Received')?.value) || 0;
      newRow['Start Date'] = '';
      newRow['Start Time'] = '';
      newRow['End Date'] = '';
      newRow['End Time'] = '';
      newRow.Duration = '';
    }

    // Image handling with Google Drive Cloud Upload & Cross-Device Sync
    if (currentCompressedImageBase64) {
      newRow.Image_URL = currentCompressedImageBase64; // local preview immediate fallback
      newRow.Image_Base64 = currentCompressedImageBase64;
      saveImageToCache(newRow.ID, currentCompressedImageBase64);

      // 1. If background upload to Google Drive already finished
      if (currentDriveUploadResult && currentDriveUploadResult.directImageUrl) {
        newRow.Image_URL = currentDriveUploadResult.directImageUrl;
        newRow.DriveFileId = currentDriveUploadResult.fileId;
        newRow.DriveWebViewLink = currentDriveUploadResult.webViewLink;
        saveImageToCache(newRow.ID, currentCompressedImageBase64);
        saveImageToCache(currentDriveUploadResult.fileId, currentCompressedImageBase64);
        saveImageToCache(currentDriveUploadResult.directImageUrl, currentCompressedImageBase64);
      } else {
        // 2. Attempt Google Drive upload to get permanent URL synced across all devices
        let activeToken = getCachedAccessToken();
        let driveUploaded = false;

        if (activeToken) {
          try {
            showToast('☁️ Google Drive এ ছবি আপলোড হচ্ছে...', 'info');
            const cleanName = (newRow['Work Name'] || 'Production').replace(/[^a-zA-Z0-9_\u0980-\u09FF]/g, '_');
            const fileName = `SmartHisab_${cleanName}_${recordId}.jpg`;
            
            let driveUpload;
            try {
              driveUpload = await uploadImageToDrive(currentCompressedImageBase64, fileName, activeToken, {
                recordId,
                workName: newRow['Work Name'] || ''
              });
            } catch (uploadErr) {
              console.warn('First drive upload attempt failed, trying token refresh:', uploadErr);
              setCachedAccessToken(null);
              activeToken = await ensureAccessToken(false);
              if (activeToken) {
                driveUpload = await uploadImageToDrive(currentCompressedImageBase64, fileName, activeToken, {
                  recordId,
                  workName: newRow['Work Name'] || ''
                });
              }
            }

            if (driveUpload && driveUpload.directImageUrl) {
              newRow.Image_URL = driveUpload.directImageUrl;
              newRow.DriveFileId = driveUpload.fileId;
              newRow.DriveWebViewLink = driveUpload.webViewLink;
              saveImageToCache(newRow.ID, currentCompressedImageBase64);
              saveImageToCache(driveUpload.fileId, currentCompressedImageBase64);
              saveImageToCache(driveUpload.directImageUrl, currentCompressedImageBase64);
              driveUploaded = true;
              showToast('✓ Google Drive এ ছবি সফলভাবে সংরক্ষিত হয়েছে!', 'success');
            }
          } catch (driveErr) {
            console.error('Direct client Drive upload error:', driveErr);
          }
        }

        // 3. Fallback to server-side Google Drive / Cloud Storage (/api/upload-image)
        if (!driveUploaded) {
          try {
            const cleanName = (newRow['Work Name'] || 'Production').replace(/[^a-zA-Z0-9_\u0980-\u09FF]/g, '_');
            const upRes = await fetch('/api/upload-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
              body: JSON.stringify({
                imageBase64: currentCompressedImageBase64,
                fileName: `SmartHisab_${cleanName}_${recordId}`,
                recordId,
                accessToken: activeToken
              })
            });
            const upData = await upRes.json();
            if (upData && upData.success && (upData.directImageUrl || upData.url)) {
              const remoteUrl = upData.directImageUrl || upData.url;
              newRow.Image_URL = remoteUrl;
              if (upData.driveFileId) newRow.DriveFileId = upData.driveFileId;
              if (upData.webViewLink) newRow.DriveWebViewLink = upData.webViewLink;
              saveImageToCache(newRow.ID, currentCompressedImageBase64);
              saveImageToCache(remoteUrl, currentCompressedImageBase64);
              showToast('✓ ছবি ক্লাউড ড্রাইভে সংরক্ষিত হয়েছে (সব ব্রাউজারে দৃশ্যমান)', 'success');
            }
          } catch (srvErr) {
            console.warn('Server upload fallback notice:', srvErr);
          }
        }
      }
    } else {
      newRow.Image_URL = (isEdit && editingRecord.record.Image_URL) ? editingRecord.record.Image_URL : '';
      if (isEdit && editingRecord.record.Image_Base64) {
        newRow.Image_Base64 = editingRecord.record.Image_Base64;
      }
      if (isEdit && editingRecord.record.DriveFileId) {
        newRow.DriveFileId = editingRecord.record.DriveFileId;
      }
      if (isEdit && editingRecord.record.DriveWebViewLink) {
        newRow.DriveWebViewLink = editingRecord.record.DriveWebViewLink;
      }
      if (isEdit && !newRow['Start Time'] && editingRecord.record['Start Time']) {
        newRow['Start Time'] = editingRecord.record['Start Time'];
      }
      if (isEdit && !newRow['End Time'] && editingRecord.record['End Time']) {
        newRow['End Time'] = editingRecord.record['End Time'];
      }
      if (isEdit && !newRow.Duration && editingRecord.record.Duration) {
        newRow.Duration = editingRecord.record.Duration;
      }
    }
  } else if (sheet === 'loan') {
    newRow.Date = document.getElementById('f_Date')?.value || getTodayString();
    newRow.Description = document.getElementById('f_LoanDesc')?.value || '';
    newRow['Loan Taken'] = Number(document.getElementById('f_LoanTaken')?.value) || 0;
    newRow['Loan Paid'] = Number(document.getElementById('f_LoanPaid')?.value) || 0;
    newRow.Note = document.getElementById('f_LoanNote')?.value || '';
  } else if (sheet === 'fund') {
    newRow.Date = document.getElementById('f_Date')?.value || getTodayString();
    newRow['Fund Name'] = document.getElementById('f_FundName')?.value || '';
    newRow['Target Budget'] = Number(document.getElementById('f_FundTarget')?.value) || 0;
    newRow.Status = document.getElementById('f_FundStatus')?.value || 'Active';
  } else if (sheet === 'fund_transaction') {
    newRow.Date = document.getElementById('f_Date')?.value || getTodayString();
    newRow['Fund ID'] = document.getElementById('f_FundId')?.value || '';
    newRow.Type = document.getElementById('f_FundTxType')?.value || 'In';
    newRow.Amount = Number(document.getElementById('f_FundAmount')?.value) || 0;
    newRow['Category/Note'] = document.getElementById('f_FundCategoryNote')?.value || '';
    newRow.Note = newRow['Category/Note'];
  }

  newRow.UpdatedAt = new Date().toISOString();
  const isPending = Boolean(document.getElementById('f_IsPending')?.checked);
  newRow.IsPending = isPending;
  if (sheet !== 'fund') {
    newRow.Status = isPending ? 'Pending' : 'Completed';
  }
  setRecordPendingStatus(newRow.ID, isPending);

  if (currentCompressedImageBase64) {
    saveImageToCache(newRow.ID, currentCompressedImageBase64);
  }

  // Update in Local Storage optimistically
  if (!appData[sheet]) appData[sheet] = [];

  if (isEdit) {
    const idx = appData[sheet].findIndex(r => String(r.ID) === String(existingId));
    if (idx !== -1) {
      appData[sheet][idx] = { ...appData[sheet][idx], ...newRow };
    }
  } else {
    appData[sheet].unshift(newRow);
  }

  saveLocalData(appData);
  closeSheetModal();
  renderApp();
  showToast(isEdit ? 'রেকর্ড আপডেট হয়েছে' : 'নতুন রেকর্ড সফলভাবে সংরক্ষিত হয়েছে!', 'success');

  // Push mutation to Google Apps Script & Google Drive
  const action = isEdit ? 'update' : 'create';
  const payloadBase64 = (newRow.Image_URL && !newRow.Image_URL.startsWith('data:')) ? null : currentCompressedImageBase64;
  sendMutation(action, sheet, newRow, payloadBase64).then(res => {
    if (res.success && res.result && res.result.data) {
      // If server returned an updated Image_URL from Drive
      if (res.result.data.Image_URL) {
        newRow.Image_URL = res.result.data.Image_URL;
        delete newRow.Image_Base64;
        const targetList = appData[sheet] || [];
        const targetIdx = targetList.findIndex(r => String(r.ID) === String(newRow.ID));
        if (targetIdx !== -1) {
          targetList[targetIdx].Image_URL = res.result.data.Image_URL;
          delete targetList[targetIdx].Image_Base64;
        }
        saveLocalData(appData);
        renderApp();
      }
    }
  });
}

export function submitSheetDelete() {
  if (!editingRecord || !editingRecord.record) return;
  const { sheet, record } = editingRecord;
  if (!confirm('আপনি কি এই রেকর্ডটি স্থায়ীভাবে মুছে ফেলতে চান?')) return;

  appData[sheet] = (appData[sheet] || []).filter(r => String(r.ID) !== String(record.ID));
  saveLocalData(appData);
  closeSheetModal();
  renderApp();
  showToast('রেকর্ডটি সফলভাবে মুছে ফেলা হয়েছে', 'info');

  sendMutation('delete', sheet, { ID: record.ID });
}

export function deleteRecordDirect(sheet, id) {
  if (!confirm('রেকর্ডটি মুছে ফেলতে চান?')) return;
  appData[sheet] = (appData[sheet] || []).filter(r => String(r.ID) !== String(id));
  saveLocalData(appData);
  renderApp();
  showToast('মুছে ফেলা হয়েছে', 'info');
  sendMutation('delete', sheet, { ID: id });
}

/**
 * 7. RECORD DETAIL MODAL (TAP ON LEDGER ROW)
 */
export function openRecordDetailModal(sheet, id) {
  const list = appData[sheet] || [];
  const record = list.find(r => String(r.ID) === String(id));
  if (!record) return;

  const modal = document.getElementById('recordDetailModal');
  const overlay = document.getElementById('detailModalOverlay');
  const title = document.getElementById('detailModalTitle');
  const body = document.getElementById('detailModalBody');
  const editBtn = document.getElementById('detailEditBtn');
  const deleteBtn = document.getElementById('detailDeleteBtn');

  if (title) title.textContent = `রেকর্ড বিবরণী // ${record.ID || id}`;

  const hasImg = Boolean(record.Image_URL || record.Image_Base64);
  const rawImg = record.Image_Base64 || record.Image_URL || '';
  const formattedImg = formatImageUrl(rawImg, record.ID);
  const driveFileId = extractDriveFileId(record.Image_URL) || record.DriveFileId || '';
  const driveViewUrl = getDriveViewUrl(record.Image_URL || driveFileId);
  const dateObj = formatHistoryDate(record.Date);
  const relativeTime = formatRelativeTime(record.UpdatedAt || record.Date);

  let detailsHtml = '';

  if (hasImg) {
    detailsHtml += `
      <div class="detail-img-container" onclick="window.SmartHisab.openImagePreview('${formattedImg}', '${(record['Work Name'] || record.Category || 'ছবি').replace(/'/g, "\\'")}', '${record.Image_URL || ''}')" title="বড় করে দেখতে ক্লিক করুন">
        <img src="${formattedImg}" 
             data-file-id="${driveFileId}" 
             data-record-id="${record.ID}" 
             data-original-src="${record.Image_URL || ''}" 
             alt="রেকর্ড ছবি" 
             referrerpolicy="no-referrer" 
             onerror="window.SmartHisab.handleImageError(this, '${driveFileId}', '${record.ID}')" />
        <div style="display: flex; justify-content: center; gap: 12px; margin-top: 8px; flex-wrap: wrap;">
          <span style="font-size: 0.75rem; color: var(--gold-neon); font-family: var(--font-mono);">🔍 সম্পূর্ণ ছবি বড় করে দেখতে ট্যাপ করুন</span>
          ${driveViewUrl ? `
            <a href="${driveViewUrl}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();" style="font-size: 0.75rem; color: #8AB4F8; text-decoration: underline; font-family: var(--font-mono);">
              📁 Google Drive এ মূল ছবি দেখুন ↗
            </a>
          ` : ''}
        </div>
      </div>
    `;
  }

  const isPending = Boolean(record.IsPending || record.Status === 'Pending');

  if (sheet === 'production') {
    const isWork = record.Type === 'Work';
    const tag = getProductionItemTag(record);
    const tagIcon = TAG_ICONS[tag] || '🏷️';
    const tagClass = TAG_CLASSES[tag] || 'tag-other';
    const timeRangeStr = formatProductionTimeRange(record);

    detailsHtml += `
      <div class="detail-grid">
        <div class="detail-item">
          <div class="detail-item-label">তারিখ (DATE)</div>
          <div class="detail-item-value">${dateObj.full} ${relativeTime ? `<span class="relative-time-badge" style="margin-left: 6px;">${relativeTime}</span>` : ''}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">ধরন ও স্ট্যাটাস</div>
          <div class="detail-item-value" style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            <span class="badge-term ${isWork ? 'badge-work' : 'badge-withdrawal'}">
              ${isWork ? 'মজুরি (কাজ)' : 'উত্তোলন'}
            </span>
            ${isPending ? `<span class="badge-term badge-pending">পেন্ডিং</span>` : `<span class="badge-term badge-income" style="font-size: 0.7rem;">সম্পন্ন</span>`}
          </div>
        </div>
        ${record.Artisan ? `
          <div class="detail-item">
            <div class="detail-item-label">কারিগর (ARTISAN)</div>
            <div class="detail-item-value" style="color: var(--cyan-cyber); font-weight: 600;">👤 ${record.Artisan}</div>
          </div>
        ` : ''}
        ${isWork ? `
          <div class="detail-item">
            <div class="detail-item-label">কাজের ট্যাগ (TAG)</div>
            <div class="detail-item-value">
              <span class="prod-tag-pill ${tagClass}" style="font-size: 0.8rem; padding: 3px 10px;">
                ${tagIcon} ${tag}
              </span>
            </div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">কাজের নাম (WORK NAME)</div>
            <div class="detail-item-value" style="color: var(--text-pure); font-size: 1.05rem; font-weight: 700;">${record['Work Name'] || '-'}</div>
          </div>
        ` : `
          <div class="detail-item full-width">
            <div class="detail-item-label">কাজের নাম (WORK NAME)</div>
            <div class="detail-item-value" style="color: var(--text-pure); font-size: 1.05rem;">${record['Work Name'] || 'বিল উত্তোলন'}</div>
          </div>
        `}
        ${isWork ? `
          <div class="detail-item">
            <div class="detail-item-label">সাইজ (SIZE)</div>
            <div class="detail-item-value">${record.Size || '-'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">কালার (COLOR)</div>
            <div class="detail-item-value">${record.Color || '-'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">পরিমাণ (PCS)</div>
            <div class="detail-item-value font-mono">${toBengaliDigits(record.Pcs || 0)} পিস</div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">ডজন ও রেট (RATE)</div>
            <div class="detail-item-value font-mono">${toBengaliDigits(record.Dozen || 0)} ডজন @ ৳${toBengaliDigits(record.Rate || 0)}</div>
          </div>
          <div class="detail-item full-width" style="background: rgba(0, 242, 157, 0.06); border-color: var(--green-electric);">
            <div class="detail-item-label" style="color: var(--green-electric);">মোট অর্জিত মজুরি (TOTAL WAGE)</div>
            <div class="detail-item-value font-mono" style="color: var(--green-electric); font-size: 1.25rem;">${formatTaka(record.Earned || 0)}</div>
          </div>
          ${timeRangeStr ? `
            <div class="detail-item full-width" style="background: rgba(0, 242, 157, 0.04); border: 1px dashed rgba(0, 242, 157, 0.35); border-radius: var(--radius-xs);">
              <div class="detail-item-label" style="color: var(--green-electric); font-weight: 700;">⏱️ কাজের সময়কাল (WORK SHIFT TIME)</div>
              <div class="detail-item-value" style="display: flex; gap: 8px; align-items: center; font-size: 0.9rem; line-height: 1.45; font-family: var(--font-bangla);">
                <span style="font-size: 1.15rem;">⏱️</span>
                <span style="color: var(--text-pure); font-weight: 600;">${timeRangeStr}</span>
              </div>
            </div>
          ` : ''}
        ` : `
          <div class="detail-item full-width" style="background: rgba(255, 59, 105, 0.06); border-color: var(--red-coral);">
            <div class="detail-item-label" style="color: var(--red-coral);">উত্তোলনকৃত অর্থ (WITHDRAWN)</div>
            <div class="detail-item-value font-mono" style="color: var(--red-coral); font-size: 1.25rem;">${formatTaka(record.Received || record.Amount || 0)}</div>
          </div>
        `}
        <div class="detail-item full-width">
          <div class="detail-item-label">নোট / মন্তব্য (NOTE)</div>
          <div class="detail-item-value" style="font-weight: 400; color: var(--text-main); font-size: 0.85rem;">${record.Note || 'কোনো মন্তব্য নেই'}</div>
        </div>
      </div>
    `;
  } else {
    const isIncome = sheet === 'income';
    const isLoan = sheet === 'loan';
    const isFund = sheet === 'fund_transaction';
    const amountVal = isLoan 
      ? (Number(record['Loan Taken']) || Number(record['Loan Paid']) || Number(record.Amount) || 0)
      : Number(record.Amount || 0);

    detailsHtml += `
      <div class="detail-grid">
        <div class="detail-item">
          <div class="detail-item-label">তারিখ (DATE)</div>
          <div class="detail-item-value">${dateObj.full} ${relativeTime ? `<span class="relative-time-badge" style="margin-left: 6px;">${relativeTime}</span>` : ''}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">স্ট্যাটাস (STATUS)</div>
          <div class="detail-item-value">
            ${isPending ? `<span class="badge-term badge-pending">পেন্ডিং</span>` : `<span class="badge-term badge-income" style="font-size: 0.7rem;">সম্পন্ন</span>`}
          </div>
        </div>
        ${record.Account || record['Payment Method'] ? `
          <div class="detail-item">
            <div class="detail-item-label">মাধ্যম / একাউন্ট (ACCOUNT)</div>
            <div class="detail-item-value" style="color: var(--gold-neon);">💳 ${record.Account || record['Payment Method']}</div>
          </div>
        ` : ''}
        ${record.Person || record.Name ? `
          <div class="detail-item">
            <div class="detail-item-label">ব্যক্তি / প্রতিষ্ঠান (PERSON)</div>
            <div class="detail-item-value" style="color: var(--cyan-cyber);">🤝 ${record.Person || record.Name}</div>
          </div>
        ` : ''}
        ${record.Fund || record.FundName ? `
          <div class="detail-item">
            <div class="detail-item-label">ফান্ড (FUND)</div>
            <div class="detail-item-value" style="color: var(--gold-neon);">💰 ${record.Fund || record.FundName}</div>
          </div>
        ` : ''}
        <div class="detail-item full-width">
          <div class="detail-item-label">খাত / বিবরণ (CATEGORY / DESCRIPTION)</div>
          <div class="detail-item-value" style="color: var(--text-pure); font-weight: 600;">${record.Category || record['Category/Note'] || record.Description || '-'}</div>
        </div>
        <div class="detail-item full-width" style="background: ${isIncome || (isFund && record.Type === 'In') || (isLoan && record['Loan Paid']) ? 'rgba(0, 242, 157, 0.06)' : 'rgba(255, 59, 105, 0.06)'}; border-color: ${isIncome || (isFund && record.Type === 'In') || (isLoan && record['Loan Paid']) ? 'var(--green-electric)' : 'var(--red-coral)'};">
          <div class="detail-item-label" style="color: ${isIncome || (isFund && record.Type === 'In') || (isLoan && record['Loan Paid']) ? 'var(--green-electric)' : 'var(--red-coral)'};">পরিমাণ (AMOUNT)</div>
          <div class="detail-item-value font-mono" style="color: ${isIncome || (isFund && record.Type === 'In') || (isLoan && record['Loan Paid']) ? 'var(--green-electric)' : 'var(--red-coral)'}; font-size: 1.25rem;">
            ${formatTaka(amountVal)}
          </div>
        </div>
        <div class="detail-item full-width">
          <div class="detail-item-label">নোট / মন্তব্য (NOTE)</div>
          <div class="detail-item-value" style="font-weight: 400; color: var(--text-main); font-size: 0.85rem;">${record.Note || 'কোনো মন্তব্য নেই'}</div>
        </div>
      </div>
    `;
  }

  if (body) body.innerHTML = detailsHtml;

  const pendingToggleBtn = document.getElementById('detailPendingToggleBtn');
  if (pendingToggleBtn) {
    if (sheet === 'fund') {
      pendingToggleBtn.style.display = 'none';
    } else {
      pendingToggleBtn.style.display = 'inline-flex';
      if (isPending) {
        pendingToggleBtn.innerHTML = '✓ সম্পন্ন করুন';
        pendingToggleBtn.className = 'btn btn-primary';
        pendingToggleBtn.style.background = '#10B981';
        pendingToggleBtn.style.borderColor = '#10B981';
        pendingToggleBtn.style.color = '#000';
      } else {
        pendingToggleBtn.innerHTML = '⏳ পেন্ডিং মার্ক';
        pendingToggleBtn.className = 'btn btn-secondary';
        pendingToggleBtn.style.background = 'rgba(245, 158, 11, 0.15)';
        pendingToggleBtn.style.borderColor = '#F59E0B';
        pendingToggleBtn.style.color = '#F59E0B';
      }
      pendingToggleBtn.onclick = () => {
        toggleRecordPending(sheet, id);
      };
    }
  }

  if (editBtn) {
    editBtn.onclick = () => {
      closeRecordDetailModal();
      openEditModal(sheet, id);
    };
  }

  if (deleteBtn) {
    deleteBtn.onclick = () => {
      closeRecordDetailModal();
      deleteRecordDirect(sheet, id);
    };
  }

  if (overlay) overlay.classList.add('active');
  if (modal) modal.classList.add('active');
}

export function closeRecordDetailModal() {
  const modal = document.getElementById('recordDetailModal');
  const overlay = document.getElementById('detailModalOverlay');
  if (overlay) overlay.classList.remove('active');
  if (modal) modal.classList.remove('active');
}

/**
 * Toggle Record Pending State with instant UI update & persistent cloud sync
 */
export async function toggleRecordPending(sheet, id) {
  if (!sheet || !id) return;
  const list = appData[sheet];
  if (!Array.isArray(list)) return;
  const record = list.find(r => String(r.ID) === String(id));
  if (!record) return;

  const currentPending = Boolean(record.IsPending || record.Status === 'Pending');
  const newPending = !currentPending;

  record.IsPending = newPending;
  if (sheet !== 'fund') {
    record.Status = newPending ? 'Pending' : 'Completed';
  }
  record.UpdatedAt = new Date().toISOString();

  // Save to persistent local registry so sync never overwrites it
  setRecordPendingStatus(id, newPending);
  saveLocalData(appData);

  // Sync mutation to Google Sheets backend
  sendMutation('update', sheet, record);

  // Broadcast cross-tab and cross-window sync
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const syncChannel = new BroadcastChannel('smart_hisab_sync_channel');
      syncChannel.postMessage({ type: 'STATUS_UPDATED', sheet, id, isPending: newPending });
    }
  } catch (e) {}

  showToast(newPending ? '⏳ ট্রানজেকশনটি পেন্ডিং হিসেবে মার্ক করা হয়েছে' : '✓ ট্রানজেকশনটি সম্পন্ন হিসেবে মার্ক করা হয়েছে', 'success');

  // Re-render UI and refresh active modal
  renderApp();
  openRecordDetailModal(sheet, id);
}

/**
 * Robust Image Fallback Handler
 * 1. Checks Local Base64 cache
 * 2. Attempts authenticated Google Drive API direct blob fetch
 * 3. Fallback placeholder
 */
export async function handleImageError(imgEl, fileId, recordId) {
  if (!imgEl) return;
  imgEl.onerror = null;

  // 1. Try local Base64 cache
  const cache = getImageCache();
  if (recordId && cache[String(recordId)] && cache[String(recordId)].startsWith('data:image')) {
    imgEl.src = cache[String(recordId)];
    return;
  }
  if (fileId && cache[String(fileId)] && cache[String(fileId)].startsWith('data:image')) {
    imgEl.src = cache[String(fileId)];
    return;
  }

  // 2. Try alternative Google Drive CDN endpoints before giving up
  const cleanId = fileId || extractDriveFileId(imgEl.getAttribute('data-original-src') || imgEl.src);
  if (cleanId) {
    const currentSrc = imgEl.src || '';

    // If thumbnail failed, try direct lh3 CDN endpoint
    if (!currentSrc.includes('googleusercontent.com') && !imgEl.getAttribute('data-tried-lh3')) {
      imgEl.setAttribute('data-tried-lh3', 'true');
      imgEl.onerror = () => handleImageError(imgEl, cleanId, recordId);
      imgEl.src = `https://lh3.googleusercontent.com/d/${cleanId}`;
      return;
    }

    // If lh3 failed, try drive uc endpoint
    if (!currentSrc.includes('uc?export=view') && !imgEl.getAttribute('data-tried-uc')) {
      imgEl.setAttribute('data-tried-uc', 'true');
      imgEl.onerror = () => handleImageError(imgEl, cleanId, recordId);
      imgEl.src = `https://drive.google.com/uc?export=view&id=${cleanId}`;
      return;
    }

    // 3. Try Google Drive authenticated fetch via Drive API v3 (if token exists)
    try {
      const token = getCachedAccessToken();
      if (token) {
        const blob = await fetchDriveImageBlob(cleanId, token);
        if (blob) {
          const objUrl = URL.createObjectURL(blob);
          imgEl.src = objUrl;

          // Also convert to dataURL and cache locally
          const reader = new FileReader();
          reader.onloadend = () => {
            if (reader.result) {
              if (recordId) saveImageToCache(recordId, reader.result);
              saveImageToCache(cleanId, reader.result);
            }
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
    } catch (e) {
      console.warn('Authenticated Drive image fallback failed:', e);
    }
  }

  // 4. Fallback SVG placeholder
  imgEl.src = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%238E9BAE%22 stroke-width=%222%22><rect width=%2218%22 height=%2218%22 x=%223%22 y=%223%22 rx=%222%22/><circle cx=%229%22 cy=%229%22 r=%222%22/><path d=%22m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21%22/></svg>';
}

function generateId(sheet) {
  const prefix = {
    income: 'TRX-1',
    expense: 'TRX-2',
    production: 'TRX-3',
    loan: 'TRX-4',
    fund: 'TRX-5',
    fund_transaction: 'TRX-6'
  }[sheet] || 'TRX-';

  return `${prefix}${Math.floor(100 + Math.random() * 900)}`;
}

/**
 * 8. FULL-SCREEN IMAGE PREVIEW LIGHTBOX
 */
export function openImagePreview(url, caption = '', driveUrl = '') {
  if (!url) return;
  const modal = document.getElementById('imagePreviewModal');
  const img = document.getElementById('previewModalImg');
  const cap = document.getElementById('previewModalCaption');
  const driveBtn = document.getElementById('previewModalDriveBtn');

  const fileId = extractDriveFileId(url) || extractDriveFileId(driveUrl);
  const effectiveDriveUrl = getDriveViewUrl(driveUrl || fileId || url);

  if (img) {
    img.onerror = () => {
      handleImageError(img, fileId);
    };
    img.src = url;
  }
  if (cap) cap.textContent = caption || 'প্রোডাকশন স্যাম্পল ইমেজ';

  if (driveBtn) {
    if (effectiveDriveUrl) {
      driveBtn.href = effectiveDriveUrl;
      driveBtn.style.display = 'inline-flex';
    } else {
      driveBtn.style.display = 'none';
    }
  }

  if (modal) modal.classList.add('show');
}

export function closeImagePreview(e) {
  const modal = document.getElementById('imagePreviewModal');
  if (modal) modal.classList.remove('show');
}

/**
 * Quick FAB Menu Toggle
 */
export function toggleQuickMenu() {
  const menu = document.getElementById('quickMenu');
  if (menu) menu.classList.toggle('show');
}

/**
 * CSV Export Tool
 */
export function exportCsv(sheetType) {
  let rows = [];
  let filename = `SmartHisab_${sheetType}_${new Date().toISOString().split('T')[0]}.csv`;

  if (sheetType === 'history') {
    rows.push(['ID', 'Date', 'Type', 'Category', 'Amount', 'Note']);
    (appData.income || []).forEach(i => rows.push([i.ID, i.Date, 'Income', i.Category, i.Amount, `"${i.Note || ''}"`]));
    (appData.expense || []).forEach(e => rows.push([e.ID, e.Date, 'Expense', e.Category, e.Amount, `"${e.Note || ''}"`]));
  } else if (sheetType === 'production') {
    rows.push(['ID', 'Date', 'Type', 'Work Name', 'Size', 'Color', 'Pcs', 'Dozen', 'Rate', 'Earned', 'Received', 'Image_URL', 'Note']);
    (appData.production || []).forEach(p => rows.push([
      p.ID, p.Date, p.Type, `"${p['Work Name'] || ''}"`, p.Size, p.Color, p.Pcs, p.Dozen, p.Rate, p.Earned, p.Received, p.Image_URL || '', `"${p.Note || ''}"`
    ]));
  }

  const csvContent = '\uFEFF' + rows.map(e => e.join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('CSV ফাইল সফলভাবে ডাউনলোড হয়েছে', 'success');
}

// Global exposure for HTML onclick bindings
window.SmartHisab = {
  // Google Identity & Drive
  handleGoogleLogin,
  handleGoogleLogout,
  openGoogleDriveFolder,
  saveAllowedEmailsFromSettings,
  connectGoogleDriveFromForm,
  connectGoogleDriveFromSettings,

  // Passcode
  enterKey,
  deleteKey,
  clearKey,
  focusPhysicalPinInput,
  lockApplication,
  showPasscodeGate,
  emergencyResetAndUnlock,

  // Navigation & Filtering
  switchTab,
  toggleTheme,
  filterFromCard,
  setDateRange,
  applyCustomDates,
  setHistoryFilter,
  setHistorySearch,
  setProductionTypeFilter,
  setProductionTagFilter,
  setProductionDateRange,
  setProductionMonth,
  setProductionCustomDates,
  onProductionDateChange,
  onProductionSearchInput,
  clearProductionSearch,
  clearProductionFilters,

  // Modals & CRUD
  openAddModal,
  openEditModal,
  closeSheetModal,
  submitSheetForm,
  submitSheetDelete,
  deleteRecordDirect,
  toggleProductionFields,
  selectProductionTag,
  onWorkNameInput,
  setEndDatePreset,
  setProductionCurrentTime,
  calcProductionDuration,
  handleImageSelected,
  removeAttachedImage,
  togglePhotoUrlInput,
  handleLoadImageFromUrl,

  // Detail Modal
  openRecordDetailModal,
  closeRecordDetailModal,
  toggleRecordPending,

  // Multi-Fund
  openQuickFundTx,
  confirmDeleteFundCascade,

  // Image Preview & Fallback
  openImagePreview,
  closeImagePreview,
  handleImageError,

  // Categories Management
  toggleCustomCategoryInput,
  handleCategorySelectChange,
  saveAndSelectCustomCategory,
  handleAddCategoryFromSettings,
  handleRemoveCategoryFromSettings,
  handleResetCategoriesToDefault,
  getExpenseCategories,
  addExpenseCategory,
  removeExpenseCategory,

  // ✨ AI Natural Language & Voice Smart Assistant
  openAiModal,
  closeAiModal,
  setAiPromptExample,
  toggleAiVoiceRecording,
  processAiPrompt,
  editAiResultInModal,
  confirmAndSaveAiEntry,

  // Sync & Settings
  triggerManualSync,
  saveApiUrl,
  testApiConnection,
  updatePasscode,
  exportJsonBackup,
  importJsonBackup,
  resetToDemoData,
  exportCsv,
  toggleQuickMenu
};

// ==========================================================================
// ✨ AI Natural Language & Voice Smart Assistant
// ==========================================================================
let currentAiParsedResult = null;
let speechRecognitionInstance = null;
let isAiVoiceRecording = false;

export function openAiModal(initialPrompt = '') {
  const modal = document.getElementById('aiEntryModal');
  const overlay = document.getElementById('aiModalOverlay');
  const input = document.getElementById('aiPromptInput');
  const resultCard = document.getElementById('aiResultCard');
  const loadingBox = document.getElementById('aiLoadingBox');
  const voiceStatus = document.getElementById('aiVoiceStatus');
  const voiceBtn = document.getElementById('aiVoiceBtn');
  const confirmBtn = document.getElementById('aiConfirmSaveBtn');

  if (!modal || !overlay) return;

  currentAiParsedResult = null;
  if (resultCard) resultCard.style.display = 'none';
  if (loadingBox) loadingBox.style.display = 'none';
  if (voiceStatus) voiceStatus.style.display = 'none';
  if (voiceBtn) voiceBtn.classList.remove('recording');
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = '✓ Google Sheets ও অ্যাপে সেভ করুন';
  }

  if (input) {
    input.value = initialPrompt || '';
    setTimeout(() => input.focus(), 120);
  }

  overlay.classList.add('active');
  modal.classList.add('active');
}

export function closeAiModal() {
  if (isAiVoiceRecording && speechRecognitionInstance) {
    try { speechRecognitionInstance.stop(); } catch (e) {}
    isAiVoiceRecording = false;
  }
  const modal = document.getElementById('aiEntryModal');
  const overlay = document.getElementById('aiModalOverlay');
  if (overlay) overlay.classList.remove('active');
  if (modal) modal.classList.remove('active');
}

export function setAiPromptExample(text) {
  const input = document.getElementById('aiPromptInput');
  if (input) {
    input.value = text;
    processAiPrompt();
  }
}

export function toggleAiVoiceRecording() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    showToast('আপনার ব্রাউজারে স্পিচ রিকগনিশন সাপোর্ট করে না, অনুগ্রহ করে লিখে দিন।', 'warning');
    return;
  }

  const voiceBtn = document.getElementById('aiVoiceBtn');
  const voiceStatus = document.getElementById('aiVoiceStatus');
  const promptInput = document.getElementById('aiPromptInput');

  if (isAiVoiceRecording && speechRecognitionInstance) {
    try {
      speechRecognitionInstance.stop();
    } catch (e) {}
    isAiVoiceRecording = false;
    if (voiceBtn) voiceBtn.classList.remove('recording');
    if (voiceStatus) voiceStatus.style.display = 'none';
    return;
  }

  try {
    const recognition = new SpeechRec();
    recognition.lang = 'bn-BD'; // Bengali (Bangladesh)
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      isAiVoiceRecording = true;
      if (voiceBtn) voiceBtn.classList.add('recording');
      if (voiceStatus) {
        voiceStatus.style.display = 'flex';
        voiceStatus.innerHTML = '<span class="pulsing-mic-dot"></span> শুনছি... বাংলায় বলুন (কথা শেষ হলে আবার মাইকে ক্লিক করুন)';
      }
    };

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        transcript += event.results[i][0].transcript;
      }
      if (promptInput && transcript) {
        promptInput.value = transcript;
      }
    };

    recognition.onerror = (event) => {
      console.warn('Speech recognition notice:', event.error);
      isAiVoiceRecording = false;
      if (voiceBtn) voiceBtn.classList.remove('recording');
      if (voiceStatus) voiceStatus.style.display = 'none';
      if (event.error !== 'no-speech') {
        showToast('ভয়েস রিকগনিশন ত্রুটি: ' + event.error, 'warning');
      }
    };

    recognition.onend = () => {
      isAiVoiceRecording = false;
      if (voiceBtn) voiceBtn.classList.remove('recording');
      if (voiceStatus) voiceStatus.style.display = 'none';
      if (promptInput?.value?.trim()) {
        showToast('ভয়েস কমান্ড গ্রহণ করা হয়েছে!', 'info');
      }
    };

    speechRecognitionInstance = recognition;
    recognition.start();
  } catch (err) {
    console.error('Failed to start speech recognition:', err);
    showToast('মাইক্রোফোন চালু করতে সমস্যা হয়েছে: ' + err.message, 'error');
  }
}

export async function processAiPrompt() {
  const input = document.getElementById('aiPromptInput');
  const promptText = input?.value?.trim();
  if (!promptText) {
    showToast('অনুগ্রহ করে হিসাবের বিবরণ লিখুন বা মাইকে বলুন', 'warning');
    return;
  }

  const loadingBox = document.getElementById('aiLoadingBox');
  const resultCard = document.getElementById('aiResultCard');
  const processBtn = document.getElementById('aiProcessBtn');

  if (loadingBox) loadingBox.style.display = 'block';
  if (resultCard) resultCard.style.display = 'none';
  if (processBtn) processBtn.disabled = true;

  try {
    const res = await fetch('/api/gemini/parse-entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
      body: JSON.stringify({ prompt: promptText })
    });

    const parsed = await res.json();

    if (!parsed || !parsed.success || !parsed.sheet || !parsed.data) {
      throw new Error(parsed?.error || 'AI হিসাব শনাক্ত করতে পারেনি। অনুগ্রহ করে বিস্তারিত লিখুন।');
    }

    currentAiParsedResult = parsed;

    // Render Result Preview
    const badge = document.getElementById('aiResultBadge');
    const summary = document.getElementById('aiResultSummary');
    const grid = document.getElementById('aiResultDetailsGrid');

    if (badge) {
      badge.textContent = parsed.sheetBangla || parsed.sheet;
      badge.className = `badge-term badge-${parsed.sheet === 'income' ? 'income' : (parsed.sheet === 'expense' ? 'expense' : 'work')}`;
    }

    if (summary) {
      summary.textContent = parsed.summaryBangla || 'শনাক্তকৃত লেনদেন';
    }

    if (grid) {
      const d = parsed.data;
      let itemsHtml = `
        <div class="detail-item">
          <div class="detail-item-label">তারিখ (DATE)</div>
          <div class="detail-item-value">${d.Date || 'আজ'}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">খাত / বিবরণ</div>
          <div class="detail-item-value">${d['Work Name'] || d.Category || d.Description || d['Category/Note'] || '-'}</div>
        </div>
      `;

      if (parsed.sheet === 'production') {
        const isWork = d.Type === 'Work';
        if (isWork) {
          itemsHtml += `
            <div class="detail-item">
              <div class="detail-item-label">পরিমাণ ও রেট</div>
              <div class="detail-item-value font-mono">${d.Pcs || 0} পিস (${d.Dozen || 0} ডজন) @ ৳${d.Rate || 0}</div>
            </div>
            <div class="detail-item">
              <div class="detail-item-label">মোট অর্জিত মজুরি</div>
              <div class="detail-item-value font-mono" style="color: var(--cyan-cyber); font-weight: 700;">${formatTaka(d.Earned || 0)}</div>
            </div>
          `;
        } else {
          itemsHtml += `
            <div class="detail-item">
              <div class="detail-item-label">উত্তোলনকৃত অর্থ</div>
              <div class="detail-item-value font-mono" style="color: var(--gold-neon); font-weight: 700;">${formatTaka(d.Received || 0)}</div>
            </div>
          `;
        }
      } else {
        const amt = d.Amount || d['Loan Taken'] || d['Loan Paid'] || 0;
        itemsHtml += `
          <div class="detail-item">
            <div class="detail-item-label">টাকার পরিমাণ</div>
            <div class="detail-item-value font-mono" style="color: ${parsed.sheet === 'income' ? 'var(--green-electric)' : 'var(--red-coral)'}; font-weight: 700;">${formatTaka(amt)}</div>
          </div>
        `;
      }

      if (d.Note) {
        itemsHtml += `
          <div class="detail-item full-width">
            <div class="detail-item-label">মন্তব্য / নোট</div>
            <div class="detail-item-value" style="font-size: 0.85rem;">${d.Note}</div>
          </div>
        `;
      }

      grid.innerHTML = itemsHtml;
    }

    if (loadingBox) loadingBox.style.display = 'none';
    if (resultCard) {
      resultCard.style.display = 'block';
      const modalBody = document.querySelector('.ai-modal-body');
      if (modalBody) {
        setTimeout(() => {
          modalBody.scrollTo({ top: modalBody.scrollHeight, behavior: 'smooth' });
        }, 50);
      } else {
        resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    showToast('✓ AI হিসাব সফলভাবে সাজিয়ে তৈরি করেছে!', 'success');
  } catch (err) {
    console.error('AI parse failure:', err);
    if (loadingBox) loadingBox.style.display = 'none';
    showToast(err.message || 'AI হিসাব শনাক্ত করতে পারেনি', 'error');
  } finally {
    if (processBtn) processBtn.disabled = false;
  }
}

export function editAiResultInModal() {
  if (!currentAiParsedResult) return;
  const { sheet, data } = currentAiParsedResult;
  closeAiModal();

  // Prefill standard modal
  editingRecord = null;
  currentCompressedImageBase64 = null;
  const modal = document.getElementById('bottomSheetModal');
  const overlay = document.getElementById('modalOverlay');
  const title = document.getElementById('sheetModalTitle');
  const body = document.getElementById('sheetModalBody');
  const delBtn = document.getElementById('sheetDeleteBtn');

  if (!modal || !overlay || !body) return;
  if (delBtn) delBtn.style.display = 'none';

  title.innerHTML = `✨ AI এন্ট্রি সম্পাদন (${sheet.toUpperCase()})`;
  body.innerHTML = getFormFieldsHtml(sheet, data, data.Type);

  overlay.classList.add('active');
  modal.classList.add('active');

  if (sheet === 'production') {
    initProductionCalculationListeners();
  }
}

export async function confirmAndSaveAiEntry() {
  if (!currentAiParsedResult) return;
  const { sheet, data } = currentAiParsedResult;

  const btn = document.getElementById('aiConfirmSaveBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ সেভ হচ্ছে...';
  }

  const recordId = generateId(sheet);
  const newRow = {
    ...data,
    ID: recordId,
    UpdatedAt: new Date().toISOString()
  };

  // Ensure default numbers
  if (sheet === 'income' || sheet === 'expense') {
    newRow.Amount = Number(newRow.Amount) || 0;
  } else if (sheet === 'production') {
    newRow.Pcs = Number(newRow.Pcs) || 0;
    newRow.Dozen = Number(newRow.Dozen) || 0;
    newRow.Rate = Number(newRow.Rate) || 0;
    newRow.Earned = Number(newRow.Earned) || 0;
    newRow.Received = Number(newRow.Received) || 0;
  } else if (sheet === 'loan') {
    newRow['Loan Taken'] = Number(newRow['Loan Taken']) || 0;
    newRow['Loan Paid'] = Number(newRow['Loan Paid']) || 0;
  } else if (sheet === 'fund_transaction') {
    newRow.Amount = Number(newRow.Amount) || 0;
  }

  // Update in appData optimistically
  if (!appData[sheet]) appData[sheet] = [];
  appData[sheet].unshift(newRow);
  saveLocalData(appData);

  closeAiModal();
  renderApp();

  showToast(`✓ ${newRow.ID} সফলভাবে Google Sheets ও অ্যাপে সেভ হয়েছে!`, 'success');

  // Push mutation to Google Apps Script Web App in real-time
  sendMutation('create', sheet, newRow).then(res => {
    if (res.success) {
      showToast('☁️ Google Sheets-এ ডেটা লাইভ সিঙ্ক সম্পন্ন হয়েছে', 'success');
      triggerBackgroundSync();
    } else {
      console.warn('Google Sheets mutation notice:', res.error);
    }
  }).catch(e => {
    console.error('Mutation error:', e);
  });
}
