/** সার্ভার-থেকে-সার্ভার কল: গোপন SH_SECRET ব্রাউজারে কখনো যায় না। */
export async function callGas(body) {
  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.SH_SECRET;
  if (!url || !secret) {
    return { status: 500, json: { success: false, error: 'সার্ভার এখনো কনফিগার করা হয়নি (APPS_SCRIPT_URL / SH_SECRET)' } };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 28000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, secret }),
      redirect: 'follow',
      signal: ctrl.signal
    });
    const text = await r.text();
    try {
      const parsed = JSON.parse(text);
      // Compatibility Fallback: যদি গুগল শিটের পুরোনো ডিপ্লয়মেন্ট এখনো এক্টিভ থাকে এবং POST getAll সাপোর্ট না করে
      if (parsed && parsed.error && parsed.error.includes('Unknown POST action: getAll') && body.action === 'getAll') {
        const getUrl = url + (url.includes('?') ? '&' : '?') + 'action=getAll&token=1234';
        const getRes = await fetch(getUrl, { method: 'GET', redirect: 'follow' });
        const getText = await getRes.text();
        return { status: 200, json: JSON.parse(getText) };
      }
      return { status: 200, json: parsed };
    } catch (e) {
      return { status: 502, json: { success: false, error: 'Google Sheets থেকে অবৈধ উত্তর এসেছে' } };
    }
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? 'Google Sheets সাড়া দিতে দেরি করছে' : 'Google Sheets-এর সঙ্গে সংযোগ ব্যর্থ';
    return { status: 504, json: { success: false, error: msg } };
  } finally {
    clearTimeout(timer);
  }
}

export function readBody(req) {
  const b = req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string') { try { return JSON.parse(b); } catch (e) { return {}; } }
  return {};
}
