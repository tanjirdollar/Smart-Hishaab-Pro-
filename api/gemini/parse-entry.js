import { GoogleGenAI } from '@google/genai';
import { requireUser } from '../_lib/auth.js';
import { readBody } from '../_lib/gas.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const user = await requireUser(req, res);
  if (!user) return;

  const prompt = readBody(req).prompt;
  if (!prompt || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) {
    return res.status(400).json({ success: false, error: 'অনুগ্রহ করে হিসাবের বিবরণ লিখুন বা বলুন' });
  }
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ success: false, error: 'AI কী কনফিগার করা হয়নি (GEMINI_API_KEY)' });

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const today = new Date().toISOString().split('T')[0];
  const systemInstruction = `You are a financial transaction extraction AI for 'Smart Hisab Pro'.
The user provides a statement or voice command in Bengali, English, or Banglish about a financial transaction.
Identify the correct accounting sheet and extract accurate structured data.
Today's date is: ${today}.

Supported sheets:
1. "income": For earnings, product sales, customer collections, service fees.
   Properties:
   - Date: string (YYYY-MM-DD, default "${today}")
   - Category: string (Must be one of: "পণ্য বিক্রি", "সার্ভিস চার্জ", "বকেয়া আদায়", "কমিশন", "অন্যান্য")
   - Amount: number (positive number)
   - Note: string (concise description in Bengali)
   - IsPending: boolean (true if mentions pending/বকেয়া/অনিষ্পন্ন, else false)

2. "expense": For daily costs, family expenses, travel, food, bills, factory expenses.
   Properties:
   - Date: string (YYYY-MM-DD, default "${today}")
   - Category: string ("পরিবার", "যাতায়াত", "খাবার", "মোবাইল বিল", "ইন্টারনেট বিল", or suitable Bengali category)
   - Amount: number (positive number)
   - Note: string (concise description in Bengali)
   - IsPending: boolean (true if mentions pending/বকেয়া, else false)

3. "production": For tailoring/garment manufacturing work or artisan wage withdrawal.
   Properties:
   - Date: string (YYYY-MM-DD, default "${today}")
   - Type: "Work" (if making items/job) or "Withdrawal" (if withdrawing money/বিল উত্তোলন)
   - "Work Name": string (e.g. "পোলো শার্ট", "ড্রপ শোল্ডার টি-শার্ট", etc.)
   - Size: string (e.g. "M", "L", "XL", "18, 20", or "-" if not specified)
   - Color: string (e.g. "কালো", "নেভি ব্লু", or "-" if not specified)
   - Pcs: number (pieces quantity)
   - Dozen: number (Pcs / 12, rounded to 2 decimals)
   - Rate: number (rate per dozen in Taka)
   - Earned: number (Dozen * Rate in Taka)
   - Received: number (if Type is "Withdrawal", the withdrawn cash amount in Taka; 0 for Work)
   - "Start Time": string (24-hour time HH:mm format, e.g. "09:00", "14:30" if mentioned, else "")
   - "End Time": string (24-hour time HH:mm format, e.g. "13:00", "18:00" if mentioned, else "")
   - Duration: string (calculated or mentioned duration, e.g. "৪ ঘণ্টা", "২ ঘণ্টা ৩০ মিনিট", else "")
   - Note: string (any note or remarks)
   - IsPending: boolean (default false)

4. "loan": For loans taken from someone/bank or loan repayments made.
   Properties:
   - Date: string (YYYY-MM-DD, default "${today}")
   - Description: string (who or where the loan is with, e.g. "করিম ভাই", "সোনালী ব্যাংক")
   - "Loan Taken": number (if new loan borrowed, else 0)
   - "Loan Paid": number (if loan installment/repayment paid, else 0)
   - Note: string
   - IsPending: boolean

5. "fund_transaction": For deposits into factory reserve/emergency fund or withdrawals from fund.
   Properties:
   - Date: string (YYYY-MM-DD, default "${today}")
   - Type: "In" (deposit) or "Out" (spending from fund)
   - "Category/Note": string
   - Amount: number
   - Note: string

Return response ONLY as valid JSON in this exact structure:
{
  "success": true,
  "sheet": "income" | "expense" | "production" | "loan" | "fund_transaction",
  "sheetBangla": "আয়" | "ব্যয়" | "প্রোডাকশন" | "লোন" | "ফান্ড",
  "summaryBangla": "সংক্ষিপ্ত বাংলা সারসংক্ষেপ (যেমন: ড্রপ শোল্ডার ৬০ পিসের হিসাব)",
  "data": { ...extracted properties... }
}`;

  const models = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];
  let result = null, lastErr = null;
  for (const model of models) {
    try {
      result = await ai.models.generateContent({ model, contents: prompt, config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.2 } });
      if (result && result.text) break;
    } catch (e) { lastErr = e; }
  }
  if (!result || !result.text) {
    return res.status(502).json({ success: false, error: (lastErr && lastErr.message) || 'AI এখন ব্যস্ত। কয়েক সেকেন্ড পর আবার চেষ্টা করুন।' });
  }
  try { return res.json(JSON.parse(result.text)); }
  catch (e) { return res.status(502).json({ success: false, error: 'AI-র উত্তর বোঝা যায়নি, আবার চেষ্টা করুন' }); }
}
