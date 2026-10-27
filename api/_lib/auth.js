import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

function deny(res, status, msg) {
  res.status(status).json({ success: false, status: 'error', error: 'UNAUTHORIZED: ' + msg });
  return null;
}

/** Firebase/Google লগইন টোকেন যাচাই করে এবং শুধু অনুমোদিত ইমেইলকে ঢুকতে দেয়। */
export async function requireUser(req, res) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return deny(res, 401, 'Google লগইন প্রয়োজন');
  const projectId = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0653199198';
  try {
    const { payload } = await jwtVerify(m[1], JWKS, {
      issuer: 'https://securetoken.google.com/' + projectId,
      audience: projectId
    });
    const email = String(payload.email || '').toLowerCase();
    const allowed = (process.env.ALLOWED_EMAILS || 'tanjir.dollar@gmail.com')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!email || payload.email_verified !== true || !allowed.includes(email)) {
      return deny(res, 403, 'এই Google অ্যাকাউন্টের প্রবেশাধিকার নেই');
    }
    return { email, uid: payload.sub };
  } catch (e) {
    return deny(res, 401, 'সেশন মেয়াদোত্তীর্ণ, আবার লগইন করুন');
  }
}
