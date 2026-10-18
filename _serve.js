// 干净的静态文件服务 - 只绑 IPv4 127.0.0.1
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = 8000;
const ROOT = __dirname;
const MIME = { '.html':'text/html;charset=utf-8', '.js':'application/javascript;charset=utf-8', '.css':'text/css;charset=utf-8', '.json':'application/json;charset=utf-8', '.jpg':'image/jpeg', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.webmanifest':'application/manifest+json' };
http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';
  const filePath = path.join(ROOT, url);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, {'Content-Type':'text/plain;charset=utf-8'}); return res.end('404'); }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control':'no-store' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`静态服务 http://127.0.0.1:${PORT}/  PID=${process.pid}`));