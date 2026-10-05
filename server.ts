import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Ensure uploads directory exists
const uploadsDir = path.resolve(__dirname, 'public/uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve uploaded images statically
app.use('/uploads', express.static(uploadsDir));

// Body parsers
app.use(express.json({ limit: '50mb' }));
app.use(express.text({ type: 'text/plain', limit: '50mb' }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Image upload endpoint (stores image for instant cross-device and cross-browser access)
app.post('/api/upload-image', (req, res) => {
  try {
    const { imageBase64, fileName, recordId } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ success: false, error: 'কোনো ইমেজ ডাটা পাওয়া যায়নি' });
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    const safeName = (fileName || `img_${recordId || Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_') + '.jpg';
    
    fs.writeFileSync(path.join(uploadsDir, safeName), buffer);
    const url = `/uploads/${safeName}`;
    return res.json({ success: true, url, fileName: safeName });
  } catch (err: any) {
    console.error('Image upload failed:', err);
    res.status(500).json({ success: false, error: err.message || 'ছবি আপলোড ব্যর্থ হয়েছে' });
  }
});

// Google Apps Script Proxy
const GAS_TARGET_URL = 'https://script.google.com/macros/s/AKfycbx7zsvpeiK37myNcAmuldFmrICbcPizJLQY7LeoudPWIk40DCpA5VbpHilwJjiv07U3/exec';

app.get('/api/sheets-proxy', async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const fullUrl = GAS_TARGET_URL + (urlObj.search || '');
    const remoteRes = await fetch(fullUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'Accept': 'application/json, text/plain, */*'
      }
    });
    const text = await remoteRes.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(remoteRes.status).send(text);
  } catch (err: any) {
    console.error('Sheets GET proxy error:', err);
    res.status(500).json({ success: false, error: err.message || 'Sheets proxy failed' });
  }
});

app.post('/api/sheets-proxy', async (req, res) => {
  try {
    const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const remoteRes = await fetch(GAS_TARGET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: bodyStr,
      redirect: 'follow'
    });
    const text = await remoteRes.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(remoteRes.status).send(text);
  } catch (err: any) {
    console.error('Sheets POST proxy error:', err);
    res.status(500).json({ success: false, error: err.message || 'Sheets proxy failed' });
  }
});

// Gemini AI Financial Transaction Extraction Endpoint
app.post('/api/gemini/parse-entry', async (req, res) => {
  try {
    const prompt = req.body?.prompt;
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ success: false, error: 'অনুগ্রহ করে হিসাবের বিবরণ লিখুন বা বলুন' });
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });

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

    const modelsToTry = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];
    let geminiRes: any = null;
    let lastErr: any = null;

    for (const model of modelsToTry) {
      try {
        geminiRes = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            temperature: 0.2
          }
        });
        if (geminiRes && geminiRes.text) {
          break;
        }
      } catch (mErr: any) {
        lastErr = mErr;
        console.warn(`Model ${model} failed, trying next:`, mErr.message);
      }
    }

    if (!geminiRes || !geminiRes.text) {
      throw lastErr || new Error('সবগুলো AI মডেল ব্যস্ত। অনুগ্রহ করে কয়েক সেকেন্ড পর আবার চেষ্টা করুন।');
    }

    const parsed = JSON.parse(geminiRes.text || '{}');
    return res.json(parsed);
  } catch (err: any) {
    console.error('Gemini parse error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'AI হিসাব বিশ্লেষণ করতে ব্যর্থ হয়েছে'
    });
  }
});

// Setup Vite in Dev or Static files in Production
async function startServer() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT} (mode: ${isProd ? 'production' : 'development'})`);
  });
}

startServer();
