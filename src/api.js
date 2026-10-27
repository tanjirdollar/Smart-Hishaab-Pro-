/**
 * Smart Hisab Pro - Google Apps Script REST Client
 * Neo-Fintech / Trading Terminal Edition with Token Guard & Base64 Drive Storage
 */

// User's deployed Google Apps Script Web App URL:
export const API_URL = '/api/sheets';

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
import { getCurrentGoogleUser, firebaseAuth } from './auth.js';

/**
 * Get active API URL (checks localStorage override first, then fallback to constant)
 */
export function getActiveApiUrl() {
  // আর কাস্টম URL গ্রহণ করা হয় না — সব অনুরোধ নিরাপদ /api/sheets দিয়ে যায়
  return API_URL;
}

export function setActiveApiUrl() {
  try { localStorage.removeItem(API_CONFIG_KEY); } catch (e) {}
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
 * Normalizes and synchronizes pending status from remote Google Sheets
 * Ensures cross-browser consistency: any update made in one browser is authoritatively synced to all browsers
 */
function enrichPendingStatus(items) {
  if (!Array.isArray(items)) return [];
  return items.map(item => {
    if (!item) return item;
    const id = String(item.ID || item.id || '');
    
    // Check remote status value from Google Sheets
    const rawStatus = (item.Status !== undefined && item.Status !== null) ? String(item.Status).trim() : '';
    const remoteIsPending = (
      rawStatus.toLowerCase() === 'pending' || 
      rawStatus === 'পেন্ডিং' || 
      item.IsPending === true || 
      item.IsPending === 'true' || 
      item.IsPending === 'Pending'
    );

    const remoteIsCompleted = (
      rawStatus.toLowerCase() === 'completed' || 
      rawStatus === 'সম্পন্ন' || 
      item.IsPending === false || 
      item.IsPending === 'false'
    );

    if (remoteIsPending) {
      // Remote marked pending: sync across all browsers
      item.IsPending = true;
      item.Status = 'Pending';
      setRecordPendingStatus(id, true);
    } else if (remoteIsCompleted || rawStatus !== '') {
      // Remote marked completed: sync across all browsers and clear stale local pending
      item.IsPending = false;
      item.Status = 'Completed';
      setRecordPendingStatus(id, false);
    } else {
      // If remote status column was completely blank in sheet, check local registry fallback
      const localPending = getRecordPendingStatus(id);
      if (localPending !== null) {
        item.IsPending = localPending;
        item.Status = localPending ? 'Pending' : 'Completed';
      } else {
        item.IsPending = false;
        item.Status = 'Completed';
      }
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
export async function getAuthHeaders() {
  try {
    if (firebaseAuth.authStateReady) await firebaseAuth.authStateReady();
    const u = firebaseAuth.currentUser;
    if (u) return { Authorization: 'Bearer ' + (await u.getIdToken()) };
  } catch (e) {}
  return {};
}

async function callApi(method, payload) {
  const auth = await getAuthHeaders();
  if (!auth.Authorization) return { success: false, error: 'UNAUTHORIZED: Google লগইন প্রয়োজন' };
  try {
    const res = await fetch(API_URL, {
      method,
      headers: { 'Content-Type': 'application/json', ...auth },
      cache: 'no-store',
      body: method === 'GET' ? undefined : JSON.stringify(payload)
    });
    const json = await res.json().catch(() => null);
    return json || { success: false, error: 'সার্ভার থেকে অবৈধ উত্তর এসেছে' };
  } catch (err) {
    return { success: false, error: 'নেটওয়ার্ক ত্রুটি: ' + err.message };
  }
}

function notifyUnauthorized(error, currentUser) {
  if (!currentUser) {
    window.dispatchEvent(new CustomEvent('smart_hisab_unauthorized', { detail: { error } }));
  }
}

/**
 * Google Sheets থেকে সব ডেটা আনে (লগইন করা অনুমোদিত অ্যাকাউন্টের টোকেন দিয়ে)।
 */
export async function syncFromGoogleSheets() {
  const currentUser = getCurrentGoogleUser();
  const json = await callApi('GET');

  if (json && json.error && String(json.error).includes('UNAUTHORIZED')) {
    notifyUnauthorized(json.error, currentUser);
    return { success: false, unauthorized: true, error: json.error, data: loadLocalData() };
  }
  if (json && (json.success === true || json.status === 'success') && json.data) {
    const normalized = normalizeSheetData(json.data);
    saveLocalData(normalized);
    return { success: true, mode: 'remote', data: normalized };
  }
  const errMsg = (json && (json.error || json.message)) || 'গুগল শীট থেকে রেসপন্স পাওয়া যায়নি';
  return { success: false, mode: 'local_fallback', error: errMsg, data: loadLocalData() };
}

/**
 * Create/update/delete পাঠায়। ID ক্লায়েন্টেই তৈরি থাকে, তাই নেটওয়ার্ক-রিট্রাইয়ে ডুপ্লিকেট সারি হয় না।
 */
export async function sendMutation(action, sheet, recordData, imageBase64 = null) {
  let normalizedSheet = (sheet || '').toLowerCase();
  if (normalizedSheet === 'fundtransaction' || normalizedSheet === 'fund_transactions') normalizedSheet = 'fund_transaction';

  const postAction = action === 'create' ? 'add' : action;
  const id = recordData.ID || recordData.id;
  const payloadData = { ...recordData };
  if (payloadData.IsPending !== undefined) {
    payloadData.IsPending = Boolean(payloadData.IsPending);
    if (!payloadData.Status || payloadData.Status === 'Pending' || payloadData.Status === 'Completed') {
      payloadData.Status = payloadData.IsPending ? 'Pending' : 'Completed';
    }
  }
  delete payloadData.Image_Base64;

  const currentUser = getCurrentGoogleUser();
  const result = await callApi('POST', {
    action: postAction,
    sheet: normalizedSheet,
    data: payloadData,
    id,
    fundId: postAction === 'deleteFundCascade' ? id : undefined,
    imageBase64: imageBase64 || recordData.Image_Base64 || null
  });

  if (result && result.error && String(result.error).includes('UNAUTHORIZED')) {
    notifyUnauthorized(result.error, currentUser);
    return { success: false, unauthorized: true, error: result.error };
  }
  if (result && (result.success === true || result.status === 'success')) return { success: true, result };
  return { success: false, error: (result && result.error) || 'Mutation error' };
}

export async function testConnection() {
  const json = await callApi('GET');
  if (json && (json.success === true || json.status === 'success')) return { success: true, message: 'গুগল শীট সফলভাবে সংযুক্ত হয়েছে!' };
  if (json && json.error && String(json.error).includes('UNAUTHORIZED')) return { success: false, message: 'Google লগইন বা অনুমতি সঠিক নয় (UNAUTHORIZED)' };
  return { success: false, message: (json && json.error) || 'সংযোগ স্থাপন করা সম্ভব হয়নি' };
}

/**
 * অ্যাপ-লক পিন: এটি শুধু এই ডিভাইসের স্ক্রিন-লক। ডেটার আসল নিরাপত্তা Google লগইন + সার্ভার যাচাই।
 * নিজের পিন সেট করা থাকলে শুধু সেটিই চলবে; না থাকলে ডিফল্ট।
 */
export async function verifyPinWithBackend(pin) {
  const clean = String(pin).trim();
  const localPin = getStoredPasscode();
  const expected = (localPin && localPin.trim()) ? localPin.trim() : DEFAULT_PASSCODE;
  return clean === expected ? { success: true, localVerified: true } : { success: false, error: 'ভুল পিন! আবার চেষ্টা করুন' };
}

export async function updateBackendSecurityToken() {
  return { success: true, localOnly: true };
}
