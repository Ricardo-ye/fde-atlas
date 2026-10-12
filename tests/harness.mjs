/**
 * 极简测试运行器（零依赖）。
 *
 * 为什么不用 node:test：
 *   node:test 在 Node 18+ 可用，但它输出 TAP 且会把文件当独立进程跑，
 *   对本项目这种"一个命令验证全部"的小型校验型项目过重。
 *   这里手写 30 行，输出可读，且天然支持异步用例。
 */

const suites = [];
let current = null;

export const describe = (name, fn) => {
  current = { name, cases: [] };
  suites.push(current);
  fn();
  current = null;
};

export const it = (name, fn) => {
  if (!current) throw new Error('it() 必须在 describe() 内调用');
  current.cases.push({ name, fn });
};

export const assert = {
  ok(value, message = '期望为真值') {
    if (!value) throw new Error(`${message}（实际：${JSON.stringify(value)}）`);
  },
  equal(actual, expected, message = '值不相等') {
    if (!Object.is(actual, expected)) {
      throw new Error(`${message}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`);
    }
  },
  deepEqual(actual, expected, message = '结构不相等') {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${message}\n    期望：${b}\n    实际：${a}`);
  },
  match(text, pattern, message = '不匹配预期模式') {
    if (!pattern.test(String(text))) {
      throw new Error(`${message}（模式 ${pattern}，实际 ${String(text).slice(0, 80)}）`);
    }
  },
  throws(fn, message = '期望抛出异常但未抛出') {
    try {
      fn();
    } catch {
      return;
    }
    throw new Error(message);
  },
};

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

export const run = async () => {
  let passed = 0;
  const failures = [];

  for (const suite of suites) {
    console.log(`\n${suite.name}`);
    for (const testCase of suite.cases) {
      try {
        await testCase.fn();
        passed += 1;
        console.log(`  ${GREEN}✓${RESET} ${DIM}${testCase.name}${RESET}`);
      } catch (error) {
        failures.push({ suite: suite.name, test: testCase.name, error });
        console.log(`  ${RED}✗${RESET} ${testCase.name}`);
      }
    }
  }

  const total = passed + failures.length;
  if (failures.length) {
    console.log(`\n${RED}${failures.length} / ${total} 用例失败${RESET}`);
    for (const failure of failures) {
      console.log(`\n  ${failure.suite} › ${failure.test}`);
      console.log(`  ${failure.error.message.replace(/\n/g, '\n  ')}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`\n${GREEN}${passed} / ${total} 用例通过${RESET}`);
};