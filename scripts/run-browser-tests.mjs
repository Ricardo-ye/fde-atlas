#!/usr/bin/env node
/**
 * ������༯�ɲ�����������
 *
 * ΪʲôҪ�����ܣ�tests/suite.mjs ��֤�������߼�����ģ���ַ���ƴ�ӡ�
 * �¼��󶨡�CSS ������Ч��HTML ת������ʵ DOM ��������塣
 * ��Щǡǡ��"����ȫ�̵�ҳ�����"�ĵ�����Դ��
 *
 * ʵ�ַ�ʽ����һ�����ؾ�̬������ + ��ͷ�������ͨ�� CDP �򿪲���ҳ����ȡ
 * �������� --virtual-time-budget + --dump-dom��CDP �������ȴ��첽������ɡ�
 *
 * �÷���node scripts/run-browser-tests.mjs
 * ��Ҫ�������� Edge �� Chrome���Ҳ��������ʱʧ�ܣ���ֹ CI ��Ĭ������
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BROWSER_CANDIDATES = [
  process.env.BROWSER_PATH, process.env.CHROME_BIN,
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const findBrowser = () => BROWSER_CANDIDATES.find((candidate) => candidate && fs.existsSync(candidate));

const startServer = () => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    // �淶�� URL ·����������� ".." �� "."������ /tests/browser/../src/...
    // ��������ᱻƴ�ɺ� ".." ������·�������� 404 �����������λ�á�
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const relative = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
    const filePath = path.join(root, relative || 'index.html');

    // ��Ŀ¼��Խ���淶������У��������� root ֮��
    if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    // �ؼ���ͬ��������д��Ӧ��
    // �� createReadStream ʱ����������������ֽڵ���ǰ���ж���ʽ��"��"��
    // ���� link.sheet ���ڵ� cssRules Ϊ 0 ���� һ�������Ų�ļ���
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': 'no-store',
    });
    res.end(content);
  });
  server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
});

/**
 * ���� WebSocket �ͻ��ˣ�ֻ���� CDP ָ�����������������
 * ÿ����ֵ��һ�������� ���� ҳ����ת�����پ����ӣ����ûᾲĬ����
 */
const cdpEvaluate = async (port, expression) => {
  if (typeof globalThis.WebSocket !== 'function') {
    throw new Error('��ǰ Node �汾ȱ�� WebSocket ֧�֣��� Node 22+��');
  }

  // ÿ�����·��� target����ת��ɵ� webSocketDebuggerUrl ��ʧЧ
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
  if (!page) throw new Error('�Ҳ������õ�ҳ�� target');

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      try { socket.close(); } catch { /* �ѹر� */ }
      reject(new Error('CDP ��ֵ��ʱ'));
    }, 20000);

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    });

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timer);
      try { socket.close(); } catch { /* �ѹر� */ }
      if (message.result?.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.exception?.description || 'ҳ�����쳣'));
        return;
      }
      resolve(message.result?.result?.value);
    });

    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('WebSocket ����ʧ��'));
    });
  });
};

const main = async () => {
  const browser = findBrowser();
  if (!browser) {
    console.error('δ�ҵ� Edge/Chrome������ BROWSER_PATH �����ԣ�����δͨ����');
    process.exitCode = 1;
    console.log('  ��װ��һ����������У�node scripts/run-browser-tests.mjs');
    return;
  }

  const { server, port } = await startServer();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fde-atlas-cdp-'));
  const port_ = 9400 + Math.floor(Math.random() * 400);

  const child = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []),
    '--no-first-run',
    '--no-default-browser-check',
    // Edge �״������ᵯͬ��ȷ��ҳ���ٳֺ���������������ʽ�ر�
    '--disable-sync',
    '--disable-features=msSyncEdgePersonalization,msEdgeFirstRunExperience,sync',
    '--disable-background-networking',
    '--disable-component-update',
    `--remote-debugging-port=${port_}`,
    `--user-data-dir=${profileDir}`,
    `http://127.0.0.1:${port}/tests/browser/index.html`,
  ], { stdio: 'ignore', windowsHide: true });

  const cleanup = async () => {
    try { child.kill(); } catch { /* ���˳� */ }
    server.close();
    await new Promise(r => setTimeout(r, 500));
    const resolvedProfile = path.resolve(profileDir);
    if (path.dirname(resolvedProfile) !== path.resolve(os.tmpdir()) || !path.basename(resolvedProfile).startsWith('fde-atlas-cdp-')) throw new Error('Unexpected profile path');
    try { fs.rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
    catch (error) { console.warn('Temporary browser profile still locked:', error.code); }
  };

  try {
    // �ȴ����Զ˿ھ���
    let ready = false;
    for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        const res = await fetch(`http://127.0.0.1:${port_}/json/list`);
        const targets = await res.json();
        ready = targets.some((t) => t.type === 'page');
      } catch { /* �˿���δ���� */ }
    }
    if (!ready) throw new Error('�޷����ӵ���������Զ˿�');

    // ����������ֱ��ָ�����ҳ������ֻ�����׵�����������չҳ�ٳ����ض��������
    try {
      await cdpEvaluate(port_, 'location.href');
    } catch { /* ���� */ }
    await cdpEvaluate(port_, `location.href = 'http://127.0.0.1:${port}/tests/browser/index.html'; 'navigating'`).catch(() => {});

    // ��ѯ�ȴ�������ɣ�ҳ��ѽ��д�� title��
    let title = '';
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        title = await cdpEvaluate(port_, 'document.title');
      } catch {
        continue; // �������������ӿ���˲�ϣ����Լ���
      }
      if (title === 'ALL_PASS' || title === 'HAS_FAILURE') break;
    }

    const report = await cdpEvaluate(port_, 'document.getElementById("results")?.textContent || ""');

    if (title !== 'ALL_PASS' && title !== 'HAS_FAILURE') {
      // �ɼ�ҳ���������"����ʧ��"��"�ű�����û������"
      const diagnostics = await cdpEvaluate(port_, `JSON.stringify({
        url: location.href,
        ready: document.readyState,
        resultsExists: Boolean(document.getElementById('results')),
        resultsLength: (document.getElementById('results')?.textContent || '').length,
        dataLoaded: Boolean(window.FDE_ATLAS),
        gridCards: document.querySelectorAll('.card').length,
      })`);
      throw new Error(
        `����ҳδ��Ԥ��ʱ������ɣ�title=${title}��\nҳ��״̬��${diagnostics}\n���ռ������\n${report}`,
      );
    }

    console.log(report);
    if (title === 'HAS_FAILURE') {
      process.exitCode = 1;
    } else {
      console.log('\n������༯�ɲ���ͨ����');
    }
  } finally {
    await cleanup();
  }
};

await main();