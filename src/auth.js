/**
 * 🔐 Google Account Authentication & OAuth Token Manager
 * Powered by Firebase Auth & Google Identity
 */
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut
} from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase App & Auth
export const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);

// Required OAuth Scopes for Google Account & Google Drive
export const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/drive.file'
];

const provider = new GoogleAuthProvider();
SCOPES.forEach(scope => provider.addScope(scope));
// Force prompt if needed to ensure drive.file scope consent
provider.setCustomParameters({
  prompt: 'select_account'
});

// Primary Owner / Admin Email
export const DEFAULT_ADMIN_EMAIL = 'tanjir.dollar@gmail.com';

// In-memory token cache (MANDATORY: Never store access token in localStorage per security guidelines)
let cachedAccessToken = null;
let currentGoogleUser = null;
let isSigningIn = false;

/**
 * Get list of authorized emails from localStorage or default
 */
export function getAuthorizedEmails() {
  try {
    const saved = localStorage.getItem('smart_hisab_allowed_emails');
    if (saved) {
      const list = JSON.parse(saved);
      if (Array.isArray(list) && list.length > 0) return list;
    }
  } catch (e) {
    console.warn('Failed to parse allowed emails', e);
  }
  return [DEFAULT_ADMIN_EMAIL];
}

/**
 * Save authorized email list
 */
export function saveAuthorizedEmails(emails) {
  try {
    localStorage.setItem('smart_hisab_allowed_emails', JSON.stringify(emails));
  } catch (e) {
    console.error('Failed to save allowed emails', e);
  }
}

/**
 * Check if given email is authorized
 */
export function isEmailAuthorized(email) {
  if (!email) return false;
  const clean = String(email).trim().toLowerCase();
  const allowed = getAuthorizedEmails().map(e => String(e).trim().toLowerCase());
  return allowed.includes(clean) || clean === DEFAULT_ADMIN_EMAIL.toLowerCase();
}

/**
 * Get in-memory OAuth Access Token
 */
export function getCachedAccessToken() {
  return cachedAccessToken;
}

export function setCachedAccessToken(token) {
  cachedAccessToken = token;
}

/**
 * Get current authenticated user
 */
export function getCurrentGoogleUser() {
  return currentGoogleUser || firebaseAuth.currentUser;
}

/**
 * Initialize Google Auth State Listener
 */
export function initGoogleAuth(onUserAuthenticated, onUserUnauthenticated) {
  return onAuthStateChanged(firebaseAuth, async (user) => {
    if (user) {
      currentGoogleUser = user;
      const email = user.email || '';
      
      // Check authorization
      if (isEmailAuthorized(email)) {
        if (onUserAuthenticated) {
          onUserAuthenticated(user, cachedAccessToken);
        }
      } else {
        console.warn('Unauthorized Google account attempted access:', email);
        await signOut(firebaseAuth);
        cachedAccessToken = null;
        currentGoogleUser = null;
        if (onUserUnauthenticated) {
          onUserUnauthenticated('unauthorized_email', email);
        }
      }
    } else {
      currentGoogleUser = null;
      cachedAccessToken = null;
      if (onUserUnauthenticated) {
        onUserUnauthenticated('signed_out');
      }
    }
  });
}

/**
 * Perform interactive Google Sign-In popup
 */
export async function signInWithGoogle() {
  if (isSigningIn) return null;
  isSigningIn = true;

  try {
    const result = await signInWithPopup(firebaseAuth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const token = credential?.accessToken || null;
    const user = result.user;

    if (!isEmailAuthorized(user.email)) {
      await signOut(firebaseAuth);
      cachedAccessToken = null;
      currentGoogleUser = null;
      const err = new Error(`অননুমোদিত অ্যাকাউন্ট: ${user.email}। শুধুমাত্র অনুমোদিত অ্যাডমিন অ্যাকাউন্ট দিয়ে সাইন ইন করুন।`);
      err.code = 'UNAUTHORIZED_ACCOUNT';
      throw err;
    }

    if (token) {
      cachedAccessToken = token;
    }
    currentGoogleUser = user;

    return { user, accessToken: cachedAccessToken };
  } catch (error) {
    console.error('Google Sign-In Error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
}

/**
 * Ensure an active OAuth Access Token exists for Drive operations
 */
export async function ensureAccessToken() {
  if (cachedAccessToken) return cachedAccessToken;
  const res = await signInWithGoogle();
  return res?.accessToken || null;
}

/**
 * Sign Out from Google Account
 */
export async function signOutFromGoogle() {
  try {
    await signOut(firebaseAuth);
    cachedAccessToken = null;
    currentGoogleUser = null;
    sessionStorage.removeItem('smart_hisab_unlocked');
  } catch (err) {
    console.error('Google Sign-Out Error:', err);
    throw err;
  }
}
