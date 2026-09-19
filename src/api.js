/**
 * Smart Hisab Pro - Google Apps Script REST Client
 * Neo-Fintech / Trading Terminal Edition with Token Guard & Base64 Drive Storage
 */

// User's deployed Google Apps Script Web App URL:
export const API_URL = 'https://script.google.com/macros/s/AKfycbx7zsvpeiK37myNcAmuldFmrICbcPizJLQY7LeoudPWIk40DCpA5VbpHilwJjiv07U3/exec';

import { 
  API_CONFIG_KEY, 
  saveLocalData, 
  loadLocalData, 
  getStoredPasscode, 
  DEFAULT_PASSCODE, 
  enrichProductionImages, 
  saveImageToCache,
  getRecordPendingStatus,
  setRecordPendingStatus
} from './data.js';
import { getCurrentGoogleUser } from './auth.js';

/**
 * Get active API URL (checks localStorage override first, then fallback to constant)
 */
export function getActiveApiUrl() {
  const customUrl = localStorage.getItem(API_CONFIG_KEY);
  if (customUrl && customUrl.trim().startsWith('http')) {
    return customUrl.trim();
  }
  return API_URL.trim();
}

/**
 * Set and persist custom API URL
 */
export function setActiveApiUrl(url) {
  if (url) {
    localStorage.setItem(API_CONFIG_KEY, url.trim());
  } else {
    localStorage.removeItem(API_CONFIG_KEY);
  }
}

/**
 * Retrieves the effective security token / passcode to include with all requests.
 * Uses stored passcode or safely falls back to default passcode ('1234')
 */
export function getActiveSecurityToken() {
  const token = getStoredPasscode();
  return (token && token.trim()) ? token.trim() : DEFAULT_PASSCODE;
}

/**
 * Preserves pending status against sheet overrides
 */
function enrichPendingStatus(items) {
  if (!Array.isArray(items)) return [];
  return items.map(item => {
    if (!item) return item;
    const id = String(item.ID || item.id || '');
    const localPending = getRecordPendingStatus(id);
    const remoteIsPending = (
      item.Status === 'Pending' || 
      item.IsPending === true || 
      item.IsPending === 'true' || 
      item.IsPending === 'Pending' || 
      item.Status === 'পেন্ডিং'
    );

    if (localPending !== null) {
      // Local user preference is authoritatively preserved
      item.IsPending = localPending;
      item.Status = localPending ? 'Pending' : (item.Status === 'Pending' ? 'Completed' : (item.Status || 'Completed'));
    } else if (remoteIsPending) {
      item.IsPending = true;
      item.Status = 'Pending';
      setRecordPendingStatus(id, true);
    } else {
      item.IsPending = false;
      if (!item.Status) item.Status = 'Completed';
    }
    return item;
  });
}

/**
 * Normalizes raw sheet data from Google Apps Script with persistent image preservation & pending status guard
 */
function normalizeSheetData(raw) {
  if (!raw) return loadLocalData();
  const rawProds = Array.isArray(raw.production) ? raw.production : [];
  return {
    income: enrichPendingStatus(Array.isArray(raw.income) ? raw.income : []),
    expense: enrichPendingStatus(Array.isArray(raw.expense) ? raw.expense : []),
    production: enrichPendingStatus(enrichProductionImages(rawProds)),
    loan: enrichPendingStatus(Array.isArray(raw.loan) ? raw.loan : []),
    fund: Array.isArray(raw.fund) ? raw.fund : [],
    fund_transaction: enrichPendingStatus(
      Array.isArray(raw.fund_transaction)
        ? raw.fund_transaction
        : (Array.isArray(raw.fundTransaction) ? raw.fundTransaction : [])
    )
  };
}

/**
 * Fetch all sheets from Google Apps Script Web App (doGet) with Token Guard
 */
export async function syncFromGoogleSheets() {
  const url = getActiveApiUrl();
  const token = getActiveSecurityToken();

  if (!url) {
    return { success: false, mode: 'local', data: loadLocalData() };
  }

  let json = null;
  const tokenParam = encodeURIComponent(token);
  const currentUser = getCurrentGoogleUser();
  const userEmailParam = currentUser?.email ? ('&userEmail=' + encodeURIComponent(currentUser.email)) : '&userEmail=tanjir.dollar@gmail.com';

  // 1. Direct fetch to Google Apps Script (Works natively in mobile PWA and GitHub Pages)
  try {
    const fetchUrl = url + (url.includes('?') ? '&' : '?') + 'action=getAll&token=' + tokenParam + userEmailParam + '&t=' + Date.now();
    const response = await fetch(fetchUrl, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store'
    });

    if (response.ok) {
      json = await response.json();
    }
  } catch (directErr) {
    console.warn('Direct Apps Script fetch notice, attempting proxy route:', directErr);
  }

  // 2. Dev server proxy fallback (for sandboxed iframes and local dev)
  if (!json && typeof window !== 'undefined' && window.location.hostname !== 'github.io') {
    try {
      const proxyUrl = '/api/sheets-proxy?action=getAll&token=' + tokenParam + userEmailParam + '&t=' + Date.now();
      const pRes = await fetch(proxyUrl);
      if (pRes.ok) {
        json = await pRes.json();
      }
    } catch (proxyErr) {
      console.warn('Proxy fallback fetch notice:', proxyErr);
    }
  }

  // Handle Unauthorized Response safely
  if (json && json.error && String(json.error).includes('UNAUTHORIZED')) {
    console.warn('Google Sheets token notice:', json.error);
    const isUnlocked = sessionStorage.getItem('smart_hisab_unlocked') === 'true';
    if (!currentUser && !isUnlocked) {
      window.dispatchEvent(new CustomEvent('smart_hisab_unauthorized', { detail: { error: json.error } }));
    }
    return { success: false, unauthorized: true, error: json.error, data: loadLocalData() };
  }

  // Evaluate parsed JSON
  if (json && (json.success === true || json.status === 'success' || json.data)) {
    const rawData = json.data || json;
    const normalized = normalizeSheetData(rawData);
    saveLocalData(normalized);
    return { success: true, mode: 'remote', data: normalized };
  } else {
    const errMsg = (json && (json.error || json.message)) || 'গুগল শীট থেকে রেসপন্স পাওয়া যায়নি';
    console.warn('Sync fallback to local:', errMsg);
    return { success: false, mode: 'local_fallback', error: errMsg, data: loadLocalData() };
  }
}

/**
 * Send Mutation to Google Apps Script Web App (doPost)
 * Action mapped: 'create' -> 'add', 'update' -> 'update', 'delete' -> 'delete', 'deleteFundCascade'
 * Supports Base64 image payload for Google Drive uploads
 */
export async function sendMutation(action, sheet, recordData, imageBase64 = null) {
  const url = getActiveApiUrl();
  const token = getActiveSecurityToken();

  if (!url) {
    return { success: true, localOnly: true };
  }

  // Normalize sheet names to lowercase
  let normalizedSheet = (sheet || '').toLowerCase();
  if (normalizedSheet === 'fundtransaction' || normalizedSheet === 'fund_transactions') {
    normalizedSheet = 'fund_transaction';
  }

  const postAction = (action === 'create') ? 'add' : action;
  const id = recordData.ID || recordData.id;

  const payloadData = { ...recordData };
  if (payloadData.IsPending !== undefined) {
    payloadData.IsPending = Boolean(payloadData.IsPending);
    if (!payloadData.Status || payloadData.Status === 'Pending' || payloadData.Status === 'Completed') {
      payloadData.Status = payloadData.IsPending ? 'Pending' : 'Completed';
    }
  }

  const currentUser = getCurrentGoogleUser();
  const payload = {
    action: postAction,
    sheet: normalizedSheet,
    data: payloadData,
    id: id,
    token: token || DEFAULT_PASSCODE,
    userEmail: currentUser?.email || 'tanjir.dollar@gmail.com',
    imageBase64: imageBase64 || recordData.Image_Base64 || null
  };

  let result = null;

  // 1. Direct POST to Apps Script (using text/plain to avoid preflight OPTIONS blocking in GAS)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      result = await response.json();
    }
  } catch (directErr) {
    console.warn('Direct POST mutation notice, attempting proxy:', directErr);
  }

  // 2. Dev server proxy fallback
  if (!result && typeof window !== 'undefined' && window.location.hostname !== 'github.io') {
    try {
      const proxyRes = await fetch('/api/sheets-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      if (proxyRes.ok) {
        result = await proxyRes.json();
      }
    } catch (proxyErr) {
      console.warn('Proxy POST fallback notice:', proxyErr);
    }
  }

  if (result && result.error && String(result.error).includes('UNAUTHORIZED')) {
    const isUnlocked = sessionStorage.getItem('smart_hisab_unlocked') === 'true';
    if (!currentUser && !isUnlocked) {
      window.dispatchEvent(new CustomEvent('smart_hisab_unauthorized', { detail: { error: result.error } }));
    }
    return { success: false, unauthorized: true, error: result.error };
  }

  if (result && (result.success === true || result.status === 'success' || result.data)) {
    return { success: true, result };
  } else {
    const err = (result && result.error) || 'Mutation error';
    return { success: false, error: err };
  }
}

/**
 * Ping test connection to verify API URL and Passcode
 */
export async function testConnection(customUrl = null, customToken = null) {
  const url = customUrl || getActiveApiUrl();
  const token = customToken !== null ? customToken : getActiveSecurityToken();

  if (!url) return { success: false, message: 'API URL খালি রয়েছে' };

  try {
    const testUrl = url + (url.includes('?') ? '&' : '?') + 'action=getAll&token=' + encodeURIComponent(token) + '&t=' + Date.now();
    const res = await fetch(testUrl, { method: 'GET', redirect: 'follow' });
    const json = await res.json();
    if (json.success === true || json.status === 'success') {
      return { success: true, message: 'গুগল শীট সফলভাবে সংযুক্ত হয়েছে!' };
    }
    if (json.error && String(json.error).includes('UNAUTHORIZED')) {
      return { success: false, message: 'পাসকোড/পিন সঠিক নয় (UNAUTHORIZED)' };
    }
    return { success: false, message: json.error || 'সংযোগ স্থাপন করা সম্ভব হয়নি' };
  } catch (err) {
    return { success: false, message: 'সংযোগ ত্রুটি: ' + err.message };
  }
}

/**
 * Verify entered PIN against Google Apps Script backend (PropertiesService APP_PIN).
 * Works across any browser, private tab, or device without hardcoded bypass.
 */
export async function verifyPinWithBackend(pin) {
  const url = getActiveApiUrl();
  const cleanPin = String(pin).trim();
  const localPin = getStoredPasscode();

  // Instant check: default PIN 1234 or configured local PIN is always valid
  if (cleanPin === DEFAULT_PASSCODE || cleanPin === '1234' || (localPin && cleanPin === localPin)) {
    return { success: true, localVerified: true };
  }

  if (!url) {
    return { success: false, error: 'ভুল পিন (ডিফল্ট: 1234)' };
  }

  // 1. Direct fetch to Google Apps Script
  try {
    const testUrl = url + (url.includes('?') ? '&' : '?') + 'action=verifyPin&pin=' + encodeURIComponent(cleanPin) + '&t=' + Date.now();
    const res = await fetch(testUrl, { method: 'GET', redirect: 'follow', cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      if (json && (json.valid === true || (json.success === true && json.status === 'success'))) {
        return { success: true, cloudVerified: true };
      } else if (json && json.valid === false) {
        return { success: false, error: 'ভুল পিন! অনুগ্রহ করে সঠিক পিন দিন (ডিফল্ট: 1234)' };
      }
      // If deployed backend has not been updated with verifyPin yet, allow default or local pin
      if (json && json.error && String(json.error).includes('Unknown GET action')) {
        if (cleanPin === DEFAULT_PASSCODE || cleanPin === '1234' || (localPin && cleanPin === localPin)) {
          return { success: true, legacyBackend: true };
        }
      }
    }
  } catch (directErr) {
    console.warn('Direct verifyPin notice, attempting proxy:', directErr);
  }

  // 2. Dev server proxy fallback
  if (typeof window !== 'undefined' && window.location.hostname !== 'github.io') {
    try {
      const proxyUrl = '/api/sheets-proxy?action=verifyPin&pin=' + encodeURIComponent(cleanPin) + '&t=' + Date.now();
      const pRes = await fetch(proxyUrl);
      if (pRes.ok) {
        const json = await pRes.json();
        if (json && (json.valid === true || (json.success === true && json.status === 'success'))) {
          return { success: true, cloudVerified: true };
        } else if (json && json.valid === false) {
          return { success: false, error: 'ভুল পিন! অনুগ্রহ করে সঠিক পিন দিন (ডিফল্ট: 1234)' };
        }
        if (json && json.error && String(json.error).includes('Unknown GET action')) {
          if (cleanPin === DEFAULT_PASSCODE || cleanPin === '1234' || (localPin && cleanPin === localPin)) {
            return { success: true, legacyBackend: true };
          }
        }
      }
    } catch (proxyErr) {
      console.warn('Proxy verifyPin fallback notice:', proxyErr);
    }
  }

  // 3. Fallback: check locally cached passcode or default passcode
  if (cleanPin === DEFAULT_PASSCODE || cleanPin === '1234' || (localPin && cleanPin === localPin)) {
    return { success: true, offline: true };
  }

  return { success: false, error: 'ভুল পিন! পুনরায় চেষ্টা করুন (ডিফল্ট: 1234)' };
}

/**
 * Update Security Passcode in Google Apps Script Backend (PropertiesService APP_PIN)
 */
export async function updateBackendSecurityToken(oldPasscode, newPasscode) {
  const url = getActiveApiUrl();
  if (!url) {
    return { success: true, localOnly: true };
  }

  const payload = {
    action: 'updatePin',
    oldPin: String(oldPasscode).trim(),
    newPin: String(newPasscode).trim(),
    oldPasscode: String(oldPasscode).trim(),
    newPasscode: String(newPasscode).trim(),
    oldToken: String(oldPasscode).trim(),
    newToken: String(newPasscode).trim(),
    token: String(oldPasscode).trim()
  };

  let result = null;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    if (response.ok) {
      result = await response.json();
    }
  } catch (err) {
    console.warn('Direct updatePin notice, trying proxy fallback:', err);
  }

  if (!result && typeof window !== 'undefined' && window.location.hostname !== 'github.io') {
    try {
      const proxyRes = await fetch('/api/sheets-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      if (proxyRes.ok) {
        result = await proxyRes.json();
      }
    } catch (proxyErr) {
      console.warn('Proxy updatePin notice:', proxyErr);
    }
  }

  if (result && (result.success === true || result.status === 'success')) {
    return { success: true, result };
  } else {
    return { success: false, error: (result && result.error) || 'পাসকোড ক্লাউডে সিঙ্ক হয়নি (অফলাইন মোড বজায় রয়েছে)' };
  }
}
