import { requireUser } from './_lib/auth.js';
import { callGas, readBody } from './_lib/gas.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const user = await requireUser(req, res);
  if (!user) return;
  const b = readBody(req);
  if (!b.imageBase64 || typeof b.imageBase64 !== 'string') return res.status(400).json({ success: false, error: 'কোনো ইমেজ ডাটা পাওয়া যায়নি' });
  const out = await callGas({ action: 'uploadImage', imageBase64: b.imageBase64, fileName: b.fileName || ('img_' + (b.recordId || Date.now())) });
  return res.status(out.status).json(out.json);
}
