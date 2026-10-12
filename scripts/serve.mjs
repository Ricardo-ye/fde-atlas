import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4191);
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.md':'text/plain; charset=utf-8' };
const server = http.createServer((req,res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url,'http://localhost').pathname); }
  catch { res.writeHead(400).end('Bad URL'); return; }
  const target = path.resolve(root, '.' + (rel === '/' ? '/index.html' : rel));
  if (!target.startsWith(root + path.sep) || rel.split(/[\\/]/).some(x=>x.startsWith('.')) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    res.writeHead(404).end('Not found'); return;
  }
  res.writeHead(200, {'Content-Type':mime[path.extname(target)] || 'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  fs.createReadStream(target).pipe(res);
});
server.on('error',error=>{console.error(`Cannot start 127.0.0.1:${port}: ${error.message}`);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`FDE Atlas: http://127.0.0.1:${port}/`));
