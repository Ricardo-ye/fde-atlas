#!/usr/bin/env node
/**
 * 浏览器侧集成测试运行器。
 *
 * 为什么要单独跑：tests/suite.mjs 验证纯函数逻辑，但模板字符串拼接、
 * 事件绑定、CSS 变量生效、HTML 转义在真实 DOM 里才有意义。
 * 这些恰恰是"单测全绿但页面白屏"的典型来源。
 *
 * 实现方式：起一个本地静态服务器 + 无头浏览器，通过 CDP 打开测试页并读取
 * 结果。相比 --virtual-time-budget + --dump-dom，CDP 能真正等待异步断言完成。
 *
 * 用法：node scripts/run-browser-tests.mjs
 * 需要本机存在 Edge 或 Chrome；找不到浏览器时失败，防止 CI 静默跳过。
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
    // 规范化 URL 路径：必须解析 ".." 和 "."，否则 /tests/browser/../src/...
    // 这类请求会被拼成含 ".." 的字面路径，导致 404 或解析到错误位置。
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const relative = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
    const filePath = path.join(root, relative || 'index.html');

    // 防目录穿越：规范化后再校验必须仍在 root 之内
    if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    // 关键：同步读完再写响应。
    // 用 createReadStream 时，浏览器可能在首字节到达前就判定样式表"空"，
    // 导致 link.sheet 存在但 cssRules 为 0 —— 一个极难排查的假象。
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
 * 极简 WebSocket 客户端（只够发 CDP 指令，无需引入依赖）。
 * 每次求值开一条新连接 —— 页面跳转会销毁旧连接，复用会静默挂起。
 */
const cdpEvaluate = async (port, expression) => {
  if (typeof globalThis.WebSocket !== 'function') {
    throw new Error('当前 Node 版本缺少 WebSocket 支持（需 Node 22+）');
  }

  // 每次重新发现 target，跳转后旧的 webSocketDebuggerUrl 会失效
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
  if (!page) throw new Error('找不到可用的页面 target');

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      try { socket.close(); } catch { /* 已关闭 */ }
      reject(new Error('CDP 求值超时'));
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
      try { socket.close(); } catch { /* 已关闭 */ }
      if (message.result?.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.exception?.description || '页面内异常'));
        return;
      }
      resolve(message.result?.result?.value);
    });

    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('WebSocket 连接失败'));
    });
  });
};

const main = async () => {
  const browser = findBrowser();
  if (!browser) {
    console.error('未找到 Edge/Chrome：设置 BROWSER_PATH 后重试，测试未通过。');
    process.exitCode = 1;
    console.log('  安装任一浏览器后运行：node scripts/run-browser-tests.mjs');
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
    // Edge 首次启动会弹同步确认页并劫持后续导航，必须显式关闭
    '--disable-sync',
    '--disable-features=msSyncEdgePersonalization,msEdgeFirstRunExperience,sync',
    '--disable-background-networking',
    '--disable-component-update',
    `--remote-debugging-port=${port_}`,
    `--user-data-dir=${profileDir}`,
    `http://127.0.0.1:${port}/tests/browser/index.html`,
  ], { stdio: 'ignore', windowsHide: true });

  const cleanup = async () => {
    try { child.kill(); } catch { /* 已退出 */ }
    server.close();
    await new Promise(r => setTimeout(r, 500));
    const resolvedProfile = path.resolve(profileDir);
    if (path.dirname(resolvedProfile) !== path.resolve(os.tmpdir()) || !path.basename(resolvedProfile).startsWith('fde-atlas-cdp-')) throw new Error('Unexpected profile path');
    try { fs.rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
    catch (error) { console.warn('Temporary browser profile still locked:', error.code); }
  };

  try {
    // 等待调试端口就绪
    let ready = false;
    for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        const res = await fetch(`http://127.0.0.1:${port_}/json/list`);
        const targets = await res.json();
        ready = targets.some((t) => t.type === 'page');
      } catch { /* 端口尚未就绪 */ }
    }
    if (!ready) throw new Error('无法连接到浏览器调试端口');

    // 启动参数已直接指向测试页；这里只做兜底导航（若被扩展页劫持则重定向回来）
    try {
      await cdpEvaluate(port_, 'location.href');
    } catch { /* 忽略 */ }
    await cdpEvaluate(port_, `location.href = 'http://127.0.0.1:${port}/tests/browser/index.html'; 'navigating'`).catch(() => {});

    // 轮询等待测试完成（页面把结果写进 title）
    let title = '';
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        title = await cdpEvaluate(port_, 'document.title');
      } catch {
        continue; // 导航过程中连接可能瞬断，重试即可
      }
      if (title === 'ALL_PASS' || title === 'HAS_FAILURE') break;
    }

    const report = await cdpEvaluate(port_, 'document.getElementById("results")?.textContent || ""');

    if (title !== 'ALL_PASS' && title !== 'HAS_FAILURE') {
      // 采集页面错误，区分"断言失败"和"脚本根本没跑起来"
      const diagnostics = await cdpEvaluate(port_, `JSON.stringify({
        url: location.href,
        ready: document.readyState,
        resultsExists: Boolean(document.getElementById('results')),
        resultsLength: (document.getElementById('results')?.textContent || '').length,
        dataLoaded: Boolean(window.FDE_ATLAS),
        gridCards: document.querySelectorAll('.card').length,
      })`);
      throw new Error(
        `测试页未在预期时间内完成（title=${title}）\n页面状态：${diagnostics}\n已收集结果：\n${report}`,
      );
    }

    console.log(report);
    if (title === 'HAS_FAILURE') {
      process.exitCode = 1;
    } else {
      console.log('\n浏览器侧集成测试通过。');
    }
  } finally {
    await cleanup();
  }
};

await main();