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
  DEFAULT_PASSCODE
} from './data.js';

import {
  getActiveApiUrl,
  setActiveApiUrl,
  syncFromGoogleSheets,
  sendMutation,
  testConnection,
  updateBackendSecurityToken,
  verifyPinWithBackend
} from './api.js';

import {
  initGoogleAuth,
  signInWithGoogle,
  signOutFromGoogle,
  getCurrentGoogleUser,
  getCachedAccessToken,
  ensureAccessToken,
  isEmailAuthorized,
  getAuthorizedEmails,
  saveAuthorizedEmails,
  DEFAULT_ADMIN_EMAIL
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

// Production Tab Filtering State
let productionTypeFilter = 'all'; // 'all' | 'work' | 'withdrawal' | 'pending'
let productionSearchQuery = '';
let productionDateRange = 'all'; // 'all' | 'thisMonth' | 'lastMonth' | 'today' | 'custom' | 'month'
let productionMonthFilter = ''; // e.g. '2026-09'
let productionStartDate = '';
let productionEndDate = '';

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
  const user = getCurrentGoogleUser();
  if (quickPin) {
    quickPin.style.display = user ? 'block' : 'none';
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
    Image_URL: ''
  }));

  // 4. Loan Records
  (appData.loan || []).forEach(l => list.push({
    ...l,
    _sheet: 'loan',
    _type: 'loan',
    _badge: 'badge-loan',
    _label: 'লোন',
    Wage: 0,
    Withdrawn: Number(l['Loan Taken']) || 0,
    WorkName: l.Description || 'লোন লেনদেন',
    Category: l.Description,
    Image_URL: ''
  }));

  // 5. Fund Transactions
  (appData.fund_transaction || []).forEach(ft => list.push({
    ...ft,
    _sheet: 'fund_transaction',
    _type: 'fund',
    _badge: 'badge-fund',
    _label: ft.Type === 'In' ? 'ফান্ড জমা' : 'ফান্ড ব্যয়',
    Wage: ft.Type === 'In' ? (Number(ft.Amount) || 0) : 0,
    Withdrawn: ft.Type === 'Out' ? (Number(ft.Amount) || 0) : 0,
    WorkName: ft['Category/Note'] || ft.Note || 'ফান্ড',
    Category: ft['Category/Note'] || ft.Note,
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
      String(item.Size || '').toLowerCase().includes(q)
    );
  }

  // Sort Descending by Date
  list.sort((a, b) => new Date(b.Date || 0) - new Date(a.Date || 0));

  return { list, pendingCount };
}

/**
 * Render individual history cards without blowing away search input
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

    // Summary line: Work Name, Size, Color, Pcs
    let summaryLine = '';
    if (item._sheet === 'production') {
      if (item._type === 'wage') {
        const parts = [];
        if (item.Size && item.Size !== '-') parts.push(`সাইজ: ${item.Size}`);
        if (item.Color && item.Color !== '-') parts.push(`কালার: ${item.Color}`);
        if (item.Pcs) parts.push(`${item.Pcs} pcs`);
        if (item.Dozen) parts.push(`(${item.Dozen} ডজন @ ৳${item.Rate})`);
        summaryLine = parts.join(' • ') || (item.Note || 'গার্মেন্টস কাজ');
      } else {
        summaryLine = item.Note ? `নোট: ${item.Note}` : 'কারিগর বিল উত্তোলন / ক্যাশ আউট';
      }
    } else {
      summaryLine = item.Note ? `${item.Category || ''} • ${item.Note}` : (item.Category || item.WorkName);
    }

    const isPending = Boolean(item.IsPending || item.Status === 'Pending');

    return `
      <div class="prod-card-spacious ${isPending ? 'is-pending' : ''}" onclick="window.SmartHisab.openRecordDetailModal('${item._sheet}', '${item.ID}')" title="বিস্তারিত দেখতে ট্যাপ করুন">
        <!-- Left: Large Prominent Photo / Icon -->
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
              <span class="prod-photo-icon">${item._type === 'wage' ? '🏭' : item._type === 'withdrawal' ? '💸' : item._type === 'income' ? '📈' : '📉'}</span>
            </div>
          `}
        </div>

        <!-- Right: 3 Clean, Well-Spaced Rows -->
        <div class="prod-content-side">
          <!-- Row 1: Date Chip, Type Badge, and Amount Aligned Right -->
          <div class="prod-line-1">
            <div class="prod-line-1-left">
              <span class="prod-date-chip" title="${dateObj.full}">${dateObj.dateNum}</span>
              <span class="badge-term ${item._badge} prod-badge">${item._label}</span>
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

          <!-- Row 2: Work Name / Title (Dedicated Full Row, High Contrast, No Truncation) -->
          <div class="prod-line-2">
            <span class="prod-work-title">${item.WorkName}</span>
          </div>

          <!-- Row 3: Specifications, Relative Time & Pending Badge -->
          <div class="prod-line-3">
            <div class="prod-specs-wrap">
              <span class="prod-specs-text">${summaryLine}</span>
            </div>
            <div class="prod-meta-wrap">
              ${relativeTime ? `<span class="prod-rel-time" title="সর্বশেষ">${relativeTime}</span>` : ''}
              ${isPending ? `<span class="prod-pending-chip">⏳ পেন্ডিং</span>` : ''}
            </div>
          </div>
        </div>
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

  // 3. Search Filter
  if (productionSearchQuery && productionSearchQuery.trim()) {
    const q = productionSearchQuery.trim().toLowerCase();
    prods = prods.filter(p =>
      String(p['Work Name'] || '').toLowerCase().includes(q) ||
      String(p.Size || '').toLowerCase().includes(q) ||
      String(p.Color || '').toLowerCase().includes(q) ||
      String(p.Note || '').toLowerCase().includes(q) ||
      String(p.ID || '').toLowerCase().includes(q) ||
      String(p.Pcs || '').toLowerCase().includes(q)
    );
  }

  // Sort descending by Date
  prods.sort((a, b) => new Date(b.Date || 0) - new Date(a.Date || 0));

  // Filtered sub-totals
  const filteredEarned = prods.filter(p => p.Type === 'Work').reduce((s, p) => s + (Number(p.Earned) || 0), 0);
  const filteredWithdrawn = prods.filter(p => p.Type === 'Withdrawal').reduce((s, p) => s + (Number(p.Received) || Number(p.Amount) || 0), 0);

  return { prods, prodPendingCount, filteredEarned, filteredWithdrawn };
}

/**
 * Render individual production cards without blowing away search input
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

    // Compact Subtitle
    let subtitleHtml = '';
    if (isWork) {
      const parts = [];
      if (p.Size && p.Size !== '-') parts.push(`সাইজ: <strong>${p.Size}</strong>`);
      if (p.Color && p.Color !== '-') parts.push(`কালার: <strong>${p.Color}</strong>`);
      parts.push(`${p.Pcs || 0} pcs`);
      if (p.Dozen) parts.push(`(${p.Dozen} ডজন @ ৳${p.Rate || 0})`);
      subtitleHtml = parts.join(' • ');
      if (p.Note) subtitleHtml += ` • <em>${p.Note}</em>`;
    } else {
      subtitleHtml = p.Note ? `<em>${p.Note}</em>` : 'কারিগর বিল ক্যাশ গ্রহণ / উত্তোলন';
    }

    const isPending = Boolean(p.IsPending || p.Status === 'Pending');

    return `
      <div class="prod-card-spacious ${isPending ? 'is-pending' : ''}" onclick="window.SmartHisab.openRecordDetailModal('production', '${p.ID}')" title="সম্পূর্ণ বিবরণ দেখতে ট্যাপ করুন">
        <!-- Left: Large Prominent Photo / Icon -->
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
              <span class="prod-photo-icon">${isWork ? '🏭' : '💸'}</span>
            </div>
          `}
        </div>

        <!-- Right: 3 Clean, Well-Spaced Rows -->
        <div class="prod-content-side">
          <!-- Row 1: Date Chip, Type Badge, and Amount Aligned Right -->
          <div class="prod-line-1">
            <div class="prod-line-1-left">
              <span class="prod-date-chip" title="${dateObj.full}">${dateObj.dateNum}</span>
              <span class="badge-term ${isWork ? 'badge-work' : 'badge-withdrawal'} prod-badge">
                ${isWork ? 'মজুরি' : 'উত্তোলন'}
              </span>
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

          <!-- Row 2: Work Name / Title (Dedicated Full Row, High Contrast, No Truncation) -->
          <div class="prod-line-2">
            <span class="prod-work-title">${p['Work Name'] || (isWork ? 'পোশাক কাজ' : 'বিল উত্তোলন')}</span>
          </div>

          <!-- Row 3: Specifications, Relative Time & Pending Badge -->
          <div class="prod-line-3">
            <div class="prod-specs-wrap">
              <span class="prod-specs-text">${subtitleHtml}</span>
            </div>
            <div class="prod-meta-wrap">
              ${relativeTime ? `<span class="prod-rel-time" title="আপডেট সময়">${relativeTime}</span>` : ''}
              ${isPending ? `<span class="prod-pending-chip">⏳ পেন্ডিং</span>` : ''}
            </div>
          </div>
        </div>
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
  const { prods, prodPendingCount, filteredEarned, filteredWithdrawn } = getFilteredProductionData();

  // Calculate totals from entire collection
  const allProds = appData.production || [];
  const totalEarned = allProds.filter(p => p.Type === 'Work').reduce((s, p) => s + (Number(p.Earned) || 0), 0);
  const totalWithdrawn = allProds.filter(p => p.Type === 'Withdrawal').reduce((s, p) => s + (Number(p.Received) || Number(p.Amount) || 0), 0);
  const netDue = totalEarned - totalWithdrawn;

  const hasActiveFilters = productionTypeFilter !== 'all' || productionDateRange !== 'all' || Boolean(productionMonthFilter) || Boolean(productionStartDate) || Boolean(productionEndDate) || Boolean(productionSearchQuery.trim());

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

    <!-- Production Filter Controls: Search Bar + Type Toggle + Date Range Picker -->
    <div class="terminal-card" style="padding: 14px 16px; margin-bottom: 16px;">
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <!-- Row 1: Search Bar -->
        <div style="position: relative; width: 100%;">
          <input type="text" id="productionSearchInput" class="terminal-input" placeholder="🔍 কাজের নাম, কালার, সাইজ, নোট..." value="${productionSearchQuery}" oninput="window.SmartHisab.onProductionSearchInput(this.value)" style="width: 100%; padding-right: 28px;" />
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

  container.innerHTML = `
    <div class="terminal-card filter-bar" style="margin-bottom: 16px;">
      <div>
        <h2 style="font-size: 1.15rem; font-weight: 700; color: var(--text-pure); display: flex; align-items: center; gap: 8px;">
          মাল্টি-ফান্ড ও সঞ্চয় ব্যবস্থাপনা
        </h2>
        <p style="font-size: 0.78rem; color: var(--text-muted);">টার্গেট বাজেট, রিয়েল-টাইম ব্যালেন্স ও ক্যাস্কেডিং ফান্ড ট্রানজেকশন</p>
      </div>

      <div style="display: flex; gap: 8px;">
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

          <div style="display: flex; justify-content: space-between; align-items: baseline; margin: 12px 0 6px;">
            <span style="font-size: 0.8rem; color: var(--text-muted);">বর্তমান জমা ব্যালেন্স:</span>
            <span class="font-mono" style="font-size: 1.35rem; font-weight: 700; color: var(--purple-neon);">${formatTaka(f.currentBalance)}</span>
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
          <button type="button" class="btn btn-secondary" onclick="window.SmartHisab.openGoogleDriveFolder()">
            📁 Google Drive ফোল্ডার ওপেন করুন
          </button>
          <button type="button" class="btn btn-secondary" style="border-color: rgba(255, 59, 105, 0.4); color: var(--red-coral);" onclick="window.SmartHisab.handleGoogleLogout()">
            🚪 Google অ্যাকাউন্ট সাইন আউট করুন
          </button>
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
      showToast('✓ নিরাপত্তা পাসকোড সফলভাবে ক্লাউডে আপডেট হয়েছে! সব ডিভাইসে নতুন পিন প্রযোজ্য।', 'success');
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
        <div class="form-group">
          <label class="form-label">কাজের নাম (Work Name):</label>
          <input type="text" id="f_WorkName" class="form-input" placeholder="যেমন: পোলো শার্ট, ড্রপ শোল্ডার" value="${record ? (record['Work Name'] || '') : ''}" />
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

        <!-- 📸 Image File Attachment Picker -->
        <div class="form-group">
          <label class="form-label">কাজের স্যাম্পল ছবি (Drive Storage):</label>
          <div class="image-upload-box" onclick="document.getElementById('f_prodImage').click()">
            <input type="file" id="f_prodImage" accept="image/*" capture="environment" style="display: none;" onchange="window.SmartHisab.handleImageSelected(event)" />
            <div id="imageUploadPlaceholder">
              <span style="font-size: 1.5rem;">📷</span>
              <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">ক্লিক করে ক্যামেরা দিয়ে ছবি তুলুন বা ফাইল সিলেক্ট করুন</p>
              <span style="font-size: 0.72rem; color: var(--cyan-cyber); font-family: var(--font-mono);">[অটোমেটিক কম্প্রেসড ও Drive এ আপলোড হবে]</span>
            </div>
            <div id="imagePreviewBox" style="display: ${record && record.Image_URL ? 'block' : 'none'};">
              <div class="image-preview-wrapper">
                <img id="attachedImgThumb" src="${record ? (record.Image_URL || '') : ''}" alt="প্রোডাকশন স্যাম্পল" />
                <button type="button" class="img-remove-btn" onclick="window.SmartHisab.removeAttachedImage(event)">✕</button>
              </div>
              <p id="imageCompressionBadge" style="font-size: 0.75rem; color: var(--green-electric); margin-top: 4px; font-family: var(--font-mono);">
                ✓ আপলোডের জন্য প্রস্তুত
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
 * Handle Production Image File Selection & Compression
 */
export async function handleImageSelected(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    showToast('ইমেজ অপটিমাইজ ও কম্প্রেস করা হচ্ছে...', 'info');
    const base64Data = await compressImageFile(file, 800, 0.7);
    currentCompressedImageBase64 = base64Data;

    const previewBox = document.getElementById('imagePreviewBox');
    const placeholder = document.getElementById('imageUploadPlaceholder');
    const thumb = document.getElementById('attachedImgThumb');
    const badge = document.getElementById('imageCompressionBadge');

    if (thumb) thumb.src = base64Data;
    if (previewBox) previewBox.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';
    if (badge) badge.textContent = '✓ অপটিমাইজড (~70% Quality, Base64 Ready)';

    showToast('ছবি সফলভাবে যুক্ত হয়েছে', 'success');
  } catch (err) {
    showToast('ইমেজ প্রক্রিয়াকরণ ত্রুটি: ' + err.message, 'error');
  }
}

export function removeAttachedImage(e) {
  e.stopPropagation();
  currentCompressedImageBase64 = null;
  const fileInput = document.getElementById('f_prodImage');
  if (fileInput) fileInput.value = '';

  const previewBox = document.getElementById('imagePreviewBox');
  const placeholder = document.getElementById('imageUploadPlaceholder');
  const thumb = document.getElementById('attachedImgThumb');

  if (thumb) thumb.src = '';
  if (previewBox) previewBox.style.display = 'none';
  if (placeholder) placeholder.style.display = 'block';
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
      newRow['Work Name'] = document.getElementById('f_WorkName')?.value || '';
      newRow.Size = document.getElementById('f_Size')?.value || '';
      newRow.Color = document.getElementById('f_Color')?.value || '';
      newRow.Pcs = Number(document.getElementById('f_Pcs')?.value) || 0;
      newRow.Dozen = Number(document.getElementById('f_Dozen')?.value) || 0;
      newRow.Rate = Number(document.getElementById('f_Rate')?.value) || 0;
      newRow.Earned = Number(document.getElementById('f_Earned')?.value) || 0;
      newRow.Received = 0;
    } else {
      newRow['Work Name'] = 'বিল উত্তোলন';
      newRow.Size = '-';
      newRow.Color = '-';
      newRow.Pcs = 0;
      newRow.Dozen = 0;
      newRow.Rate = 0;
      newRow.Earned = 0;
      newRow.Received = Number(document.getElementById('f_Received')?.value) || 0;
    }

    // Image handling with Google Drive Cloud Upload & Local Cache
    if (currentCompressedImageBase64) {
      newRow.Image_URL = currentCompressedImageBase64; // local preview immediate fallback
      newRow.Image_Base64 = currentCompressedImageBase64;
      saveImageToCache(newRow.ID, currentCompressedImageBase64);

      try {
        const token = await ensureAccessToken();
        if (token) {
          showToast('☁️ Google Drive এ স্থায়ীভাবে ছবি আপলোড হচ্ছে...', 'info');
          const cleanName = (newRow['Work Name'] || 'Production').replace(/[^a-zA-Z0-9_\u0980-\u09FF]/g, '_');
          const fileName = `SmartHisab_${cleanName}_${recordId}.jpg`;
          const driveUpload = await uploadImageToDrive(currentCompressedImageBase64, fileName, token, {
            recordId,
            workName: newRow['Work Name'] || ''
          });

          if (driveUpload && driveUpload.directImageUrl) {
            newRow.Image_URL = driveUpload.directImageUrl;
            newRow.DriveFileId = driveUpload.fileId;
            newRow.DriveWebViewLink = driveUpload.webViewLink;
            // CRITICAL: Preserve Image_Base64 for zero-delay offline rendering in this browser
            newRow.Image_Base64 = currentCompressedImageBase64;
            saveImageToCache(newRow.ID, currentCompressedImageBase64);
            saveImageToCache(driveUpload.fileId, currentCompressedImageBase64);
            showToast('✓ Google Drive এ স্থায়ীভাবে ছবি সংরক্ষণ সম্পন্ন!', 'success');
          }
        }
      } catch (driveErr) {
        console.warn('Google Drive direct upload error:', driveErr);
        showToast('Google Drive আপলোড সতর্কতা: ' + (driveErr.message || 'লোকাল ব্যাকআপ নেওয়া হয়েছে'), 'warning');
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
  sendMutation(action, sheet, newRow, currentCompressedImageBase64).then(res => {
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
        <div class="detail-item full-width">
          <div class="detail-item-label">কাজের নাম (WORK NAME)</div>
          <div class="detail-item-value" style="color: var(--text-pure); font-size: 1.05rem;">${record['Work Name'] || '-'}</div>
        </div>
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
            <div class="detail-item-value font-mono">${record.Pcs || 0} পিস</div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">ডজন ও রেট (RATE)</div>
            <div class="detail-item-value font-mono">${record.Dozen || 0} ডজন @ ৳${record.Rate || 0}</div>
          </div>
          <div class="detail-item full-width" style="background: rgba(0, 242, 157, 0.06); border-color: var(--green-electric);">
            <div class="detail-item-label" style="color: var(--green-electric);">মোট অর্জিত মজুরি (TOTAL WAGE)</div>
            <div class="detail-item-value font-mono" style="color: var(--green-electric); font-size: 1.25rem;">${formatTaka(record.Earned || 0)}</div>
          </div>
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
    detailsHtml += `
      <div class="detail-grid">
        <div class="detail-item">
          <div class="detail-item-label">তারিখ (DATE)</div>
          <div class="detail-item-value">${dateObj.full}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">স্ট্যাটাস (STATUS)</div>
          <div class="detail-item-value">
            ${isPending ? `<span class="badge-term badge-pending">পেন্ডিং</span>` : `<span class="badge-term badge-income" style="font-size: 0.7rem;">সম্পন্ন</span>`}
          </div>
        </div>
        <div class="detail-item full-width">
          <div class="detail-item-label">খাত / বিবরণ (CATEGORY)</div>
          <div class="detail-item-value">${record.Category || record.Description || '-'}</div>
        </div>
        <div class="detail-item full-width" style="background: ${isIncome ? 'rgba(0, 242, 157, 0.06)' : 'rgba(255, 59, 105, 0.06)'}; border-color: ${isIncome ? 'var(--green-electric)' : 'var(--red-coral)'};">
          <div class="detail-item-label" style="color: ${isIncome ? 'var(--green-electric)' : 'var(--red-coral)'};">পরিমাণ (AMOUNT)</div>
          <div class="detail-item-value font-mono" style="color: ${isIncome ? 'var(--green-electric)' : 'var(--red-coral)'}; font-size: 1.25rem;">
            ${formatTaka(record.Amount || record['Loan Taken'] || 0)}
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

  // 2. Try Google Drive authenticated fetch via Drive API v3
  const cleanId = fileId || extractDriveFileId(imgEl.getAttribute('data-original-src') || imgEl.src);
  if (cleanId) {
    try {
      const token = getCachedAccessToken() || await ensureAccessToken();
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

  // 3. Fallback SVG placeholder
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
  handleImageSelected,
  removeAttachedImage,

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
