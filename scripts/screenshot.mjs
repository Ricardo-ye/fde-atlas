#!/usr/bin/env node
/**
 * ��ͼ�ű������� README �õ���ҳ�����鵯����ͼ��
 * �÷���node scripts/screenshot.mjs [���Ŀ¼]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] || path.join(root, 'docs');
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const browser = BROWSERS.find((p) => fs.existsSync(p));
if (!browser) {
  console.log('δ�ҵ��������������ͼ��');
  process.exit(0);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const relative = path.normalize(urlPath).replace(/^[/\\]+/, '');
  const filePath = path.join(root, relative || 'index.html');
  if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
    'Content-Length': body.length,
  });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
fs.mkdirSync(outDir, { recursive: true });

/** ��ҳ�桢ִ�нű�����ͼ�� */
const shoot = (url, outFile, { width = 1440, height = 2000, script = '' } = {}) => new Promise((resolve) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-'));
  const dbg = 9500 + Math.floor(Math.random() * 400);
  const child = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--disable-sync', '--disable-features=msSyncEdgePersonalization,sync',
    `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    `--screenshot=${path.join(outDir, outFile)}`,
    url,
  ], { stdio: 'ignore' });

  const finish = () => {
    try { child.kill(); } catch { /* ���˳� */ }
    fs.rmSync(profile, { recursive: true, force: true });
    resolve();
  };
  // ����ʱ����ҳ�������Ⱦ��ű�ִ��
  setTimeout(finish, 9000);
});

const base = `http://127.0.0.1:${port}`;

await shoot(`${base}/index.html`, 'home-zh.png', { height: 2100 });
console.log('������ docs/home-zh.png');

// ���鵯����ͨ�� URL hash �޷�ֱ�Ӵ򿪣�����ע��ű��ķ�ʽ�ϸ��ӣ�
// ��������ҳ��ͼ + ˵���������README ��չʾ��ҳ���ɡ�
server.close();
process.exit(0);