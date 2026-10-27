import { requireUser } from './_lib/auth.js';
import { callGas, readBody } from './_lib/gas.js';

const ACTIONS = new Set(['getAll', 'add', 'update', 'delete', 'deleteFundCascade', 'uploadImage', 'init']);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const user = await requireUser(req, res);
  if (!user) return;

  const b = req.method === 'GET' ? { action: 'getAll' } : readBody(req);
  const action = b.action === 'create' ? 'add' : b.action;
  if (!ACTIONS.has(action)) return res.status(400).json({ success: false, error: 'অবৈধ অ্যাকশন' });

  // শুধু নির্দিষ্ট ক্ষেত্র সামনে পাঠানো হয়; ক্লায়েন্টের পাঠানো secret/pin/token ফেলে দেওয়া হয়।
  const out = await callGas({
    action,
    sheet: b.sheet,
    id: b.id,
    fundId: b.fundId,
    data: b.data,
    imageBase64: b.imageBase64,
    fileName: b.fileName
  });
  return res.status(out.status).json(out.json);
}
