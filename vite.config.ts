import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'apps-script-proxy-plugin',
        configureServer(server) {
          server.middlewares.use('/api/sheets-proxy', async (req, res) => {
            try {
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
              res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

              if (req.method === 'OPTIONS') {
                res.statusCode = 204;
                res.end();
                return;
              }

              const targetUrl = 'https://script.google.com/macros/s/AKfycbx7zsvpeiK37myNcAmuldFmrICbcPizJLQY7LeoudPWIk40DCpA5VbpHilwJjiv07U3/exec';

              if (req.method === 'GET') {
                const urlObj = new URL(req.url || '', 'http://localhost:3000');
                const fullUrl = targetUrl + (urlObj.search || '');
                const remoteRes = await fetch(fullUrl, { method: 'GET', redirect: 'follow' });
                const text = await remoteRes.text();
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.statusCode = remoteRes.status;
                res.end(text);
              } else if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', async () => {
                  try {
                    const remoteRes = await fetch(targetUrl, {
                      method: 'POST',
                      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                      body: body
                    });
                    const text = await remoteRes.text();
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.statusCode = remoteRes.status;
                    res.end(text);
                  } catch (pErr: any) {
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ success: false, error: pErr.message }));
                  }
                });
              }
            } catch (err: any) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
        }
      }
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
