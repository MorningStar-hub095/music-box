# Music Box 启动体系全面重构 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 Music Box 项目的启动体系，统一为 Node.js 本地开发 + Docker 生产部署的混合方案，实现高连接可靠性和快速启动。

**Architecture:** 将现有 `scripts/start.js` 中的环境校验逻辑提取为共享模块 `env-check.js`，重写 `start.js` 为核心编排器（增加端口冲突检测、性能报告），新增 `setup.js` 首次安装向导和 `health.js` 的 `--watch`/`--json` 模式，最后添加 Docker 生产部署和 CI/CD 配置。

**Tech Stack:** Node.js 18+, child_process.spawn, net (TCP 探测), fetch (HTTP 健康检查), Docker Compose, Nginx, GitHub Actions

**设计文档:** `docs/superpowers/specs/2025-07-26-startup-system-restructure-design.md`

---

## 文件结构总览

```
music_box/
├── scripts/
│   ├── env-check.js          # 新增 - 共享环境校验模块
│   ├── setup.js              # 新增 - 首次安装向导
│   ├── start.js              # 重写 - 核心启动编排器
│   ├── health.js             # 增强 - 添加 --watch/--json
│   ├── stop.js               # 增强 - 优雅停止
│   ├── install-all.js        # 新增 - 批量依赖安装
│   └── build-all.js          # 新增 - 批量构建
├── package.json              # 修改 - 更新 scripts
├── start.bat                 # 修改 - 简化为 Node.js 包装器
├── .env.example              # 修改 - 增强文档
├── .env.development          # 新增 - 开发默认值
├── Dockerfile                # 新增 - 多阶段构建
├── docker-compose.yml        # 新增 - 生产容器编排
├── docker-compose.dev.yml    # 新增 - 开发容器编排
├── nginx/
│   └── default.conf          # 新增 - Nginx 反向代理
├── .github/
│   └── workflows/
│       └── ci.yml            # 新增 - CI/CD 流水线
├── .gitignore                # 修改 - 添加新文件规则
└── docs/
    ├── setup.md              # 新增 - 安装指南
    ├── deployment.md         # 新增 - 部署指南
    └── troubleshooting.md    # 新增 - 排查指南
```

---

### Task 1: 创建共享环境校验模块 `scripts/env-check.js`

**目标:** 将 `start.js` 中的环境检查逻辑提取为独立模块，供 `start.js`、`setup.js`、`health.js` 共用。

**Files:**
- Create: `scripts/env-check.js`

- [ ] **Step 1: 创建 `scripts/env-check.js`**

```javascript
#!/usr/bin/env node

import net from 'net';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.join(__dirname, '..');

// ============================================================
// 颜色工具
// ============================================================
export const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

export const log = {
  info: (msg) => console.log(`${colors.cyan}[INFO]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}[✓]${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}[!]${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}[✗]${colors.reset} ${msg}`),
  step: (msg) => console.log(`${colors.blue}[→]${colors.reset} ${msg}`),
};

// ============================================================
// 服务配置
// ============================================================
export const serviceConfig = {
  api: {
    name: 'API Server',
    port: 3000,
    dir: path.join(ROOT_DIR, 'server'),
    command: 'npm',
    args: ['run', 'dev'],
    healthUrl: 'http://localhost:3000/health',
    healthTimeout: 30000,
    color: colors.blue,
    icon: '🔌',
    readyPatterns: ['API服务运行在'],
    required: true,
  },
  web: {
    name: 'Web Player',
    port: 5173,
    dir: path.join(ROOT_DIR, 'web'),
    command: 'npm',
    args: ['run', 'dev'],
    color: colors.green,
    icon: '🎵',
    readyPatterns: ['VITE v', 'Local:'],
    required: false,
  },
  admin: {
    name: 'Admin',
    port: 5174,
    dir: path.join(ROOT_DIR, 'web', 'admin'),
    command: 'npm',
    args: ['run', 'dev'],
    color: colors.yellow,
    icon: '⚙️',
    readyPatterns: ['VITE v', 'Local:'],
    required: false,
  },
  browse: {
    name: 'Browse',
    port: 5175,
    dir: path.join(ROOT_DIR, 'web', 'browse'),
    command: 'npm',
    args: ['run', 'dev'],
    color: colors.magenta,
    icon: '🌐',
    readyPatterns: ['VITE v', 'Local:'],
    required: false,
  },
};

// ============================================================
// 检查函数
// ============================================================

/** 检查 Node.js 版本 >= 18 */
export function checkNodeVersion() {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);
  if (major < 18) {
    log.error(`Node.js 版本过低: ${version}，需要 >= 18.x (E001)`);
    return false;
  }
  log.success(`Node.js 版本: ${version}`);
  return true;
}

/** TCP 探测指定端口是否可连接 */
export function checkPort(port, host = 'localhost') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
}

/** 检查 MySQL 连通性（TCP 3306） */
export async function checkMySQL() {
  log.step('检查 MySQL 连接...');
  const ok = await checkPort(3306);
  if (ok) {
    log.success('MySQL 连接正常 (端口 3306)');
    return true;
  }
  log.error('MySQL 连接失败 - 端口 3306 无响应 (E002)');
  log.warn('请确保 MySQL 服务已启动');
  return false;
}

/** 检查 Redis 连通性（TCP 6379） */
export async function checkRedis() {
  log.step('检查 Redis 连接...');
  const ok = await checkPort(6379);
  if (ok) {
    log.success('Redis 连接正常 (端口 6379)');
    return true;
  }
  log.warn('Redis 连接失败 - 缓存功能将降级 (E003)');
  return false;
}

/** 检查指定端口是否被占用，返回占用信息 */
export async function checkPortConflict(port) {
  const inUse = await checkPort(port);
  if (!inUse) return null;

  try {
    if (process.platform === 'win32') {
      const output = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf-8' });
      const line = output.trim().split('\n')[0];
      if (line) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        try {
          const name = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf-8' });
          const match = name.match(/"([^"]+)"/);
          return { port, pid, processName: match ? match[1] : 'unknown' };
        } catch {
          return { port, pid, processName: 'unknown' };
        }
      }
    } else {
      const output = execSync(`lsof -i :${port} -P -n | grep LISTEN`, { encoding: 'utf-8' });
      const parts = output.trim().split(/\s+/);
      return { port, pid: parts[1], processName: parts[0] };
    }
  } catch {
    // 无法获取进程信息
  }
  return { port, pid: 'unknown', processName: 'unknown' };
}

/** 检查所有子项目依赖是否已安装 */
export function checkDependencies() {
  const dirs = ['server', 'web', 'web/admin', 'web/browse'];
  let ok = true;
  for (const dir of dirs) {
    const modulesPath = path.join(ROOT_DIR, dir, 'node_modules');
    if (!fs.existsSync(modulesPath)) {
      log.error(`${dir}/node_modules 不存在 (E005)`);
      ok = false;
    }
  }
  if (ok) log.success('依赖检查通过');
  return ok;
}

/** 检查 Prisma Client 是否已生成 */
export function checkPrismaClient() {
  const clientPath = path.join(ROOT_DIR, 'server', 'node_modules', '.prisma', 'client');
  return fs.existsSync(clientPath);
}

/** HTTP 健康检查 */
export async function httpHealthCheck(url, timeoutMs = 5000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

/** 杀掉占用指定端口的进程 */
export async function killPortProcess(port) {
  try {
    if (process.platform === 'win32') {
      const output = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf-8' });
      const lines = output.trim().split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0') {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        }
      }
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

/** 获取服务配置列表（按模式过滤） */
export function getServicesToStart(mode = 'all') {
  if (mode === 'api-only') return ['api'];
  if (mode === 'dev') return ['api', 'web', 'admin'];
  return ['api', 'web', 'admin', 'browse'];
}
```

- [ ] **Step 2: 验证模块语法正确**

Run: `node -c scripts/env-check.js`
Expected: 无输出（语法正确）

- [ ] **Step 3: Commit**

```bash
git add scripts/env-check.js
git commit -m "feat: add shared environment check module env-check.js"
```

---

### Task 2: 创建首次安装向导 `scripts/setup.js`

**目标:** 交互式引导新开发者完成首次配置。

**Files:**
- Create: `scripts/setup.js`

- [ ] **Step 1: 创建 `scripts/setup.js`**

```javascript
#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  colors, log, ROOT_DIR,
  checkNodeVersion, checkMySQL, checkRedis, checkPort
} from './env-check.js';

const ENV_EXAMPLE = path.join(ROOT_DIR, 'server', '.env.example');
const ENV_FILE = path.join(ROOT_DIR, 'server', '.env');
const SEED_SQL = path.join(ROOT_DIR, 'scripts', 'seed_data.sql');

function printBanner() {
  console.log('');
  console.log(`${colors.bright}${colors.cyan}╔══════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}║     🎵 Music Box 安装向导           ║${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}╚══════════════════════════════════════╝${colors.reset}`);
  console.log('');
}

async function main() {
  printBanner();

  // Step 1: Node.js 版本
  log.step('Step 1/7: 检查 Node.js 版本');
  if (!checkNodeVersion()) {
    log.error('请安装 Node.js >= 18: https://nodejs.org/');
    process.exit(1);
  }
  console.log('');

  // Step 2: MySQL
  log.step('Step 2/7: 检查 MySQL');
  const mysqlOk = await checkMySQL();
  if (!mysqlOk) {
    log.error('请先启动 MySQL 服务，然后重新运行此脚本');
    process.exit(1);
  }
  console.log('');

  // Step 3: Redis（可选）
  log.step('Step 3/7: 检查 Redis（可选）');
  await checkRedis();
  console.log('');

  // Step 4: 环境配置文件
  log.step('Step 4/7: 配置环境变量');
  if (!fs.existsSync(ENV_FILE)) {
    if (fs.existsSync(ENV_EXAMPLE)) {
      fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
      log.success('已从 .env.example 复制为 server/.env');
      log.warn('请编辑 server/.env 修改数据库密码等配置');
    } else {
      log.warn('server/.env.example 不存在，跳过');
    }
  } else {
    log.success('server/.env 已存在，跳过');
  }
  console.log('');

  // Step 5: 安装依赖
  log.step('Step 5/7: 安装项目依赖');
  const subdirs = [
    { dir: 'server', name: 'API Server' },
    { dir: 'web', name: 'Web Player' },
    { dir: path.join('web', 'admin'), name: 'Admin' },
    { dir: path.join('web', 'browse'), name: 'Browse' },
  ];
  for (const { dir, name } of subdirs) {
    const fullDir = path.join(ROOT_DIR, dir);
    if (!fs.existsSync(path.join(fullDir, 'node_modules'))) {
      log.step(`  安装 ${name} 依赖...`);
      try {
        execSync('npm install', { cwd: fullDir, stdio: 'inherit' });
        log.success(`  ${name} 依赖安装完成`);
      } catch {
        log.error(`  ${name} 依赖安装失败，请手动执行: cd ${dir} && npm install`);
        process.exit(1);
      }
    } else {
      log.success(`  ${name} 依赖已存在`);
    }
  }
  console.log('');

  // Step 6: Prisma 迁移 + 生成
  log.step('Step 6/7: 数据库迁移');
  const serverDir = path.join(ROOT_DIR, 'server');
  try {
    log.step('  生成 Prisma Client...');
    execSync('npx prisma generate', { cwd: serverDir, stdio: 'inherit' });
    log.success('  Prisma Client 已生成');

    log.step('  执行数据库迁移...');
    execSync('npx prisma migrate deploy', { cwd: serverDir, stdio: 'inherit' });
    log.success('  数据库迁移完成');
  } catch {
    log.warn('  数据库迁移失败，可能需要手动执行: cd server && npx prisma migrate dev');
  }
  console.log('');

  // Step 7: 导入预设数据
  log.step('Step 7/7: 导入预设数据');
  if (fs.existsSync(SEED_SQL)) {
    try {
      // 从 .env 读取数据库连接信息
      const envContent = fs.readFileSync(ENV_FILE, 'utf-8');
      const dbUrlMatch = envContent.match(/DATABASE_URL="([^"]+)"/);
      if (dbUrlMatch) {
        log.step('  导入预设流派/语言/场景/情绪数据...');
        execSync(`mysql -u root -p < "${SEED_SQL}"`, { cwd: ROOT_DIR, stdio: 'inherit' });
        log.success('  预设数据导入完成');
      } else {
        log.warn('  无法解析 DATABASE_URL，请手动导入: mysql -u root -p < scripts/seed_data.sql');
      }
    } catch {
      log.warn('  预设数据导入失败，请手动执行: mysql -u root -p < scripts/seed_data.sql');
    }
  } else {
    log.warn('  scripts/seed_data.sql 不存在，跳过');
  }
  console.log('');

  // 完成摘要
  console.log(`${colors.bright}${colors.green}╔══════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.green}║        ✅ 安装完成！                 ║${colors.reset}`);
  console.log(`${colors.bright}${colors.green}╚══════════════════════════════════════╝${colors.reset}`);
  console.log('');
  console.log('  下一步:');
  console.log(`    ${colors.cyan}npm run start${colors.reset}        启动所有服务`);
  console.log(`    ${colors.cyan}npm run start:dev${colors.reset}    仅启动 API + Web + Admin`);
  console.log(`    ${colors.cyan}npm run health${colors.reset}       检查服务状态`);
  console.log('');
}

main().catch((error) => {
  log.error(`安装失败: ${error.message}`);
  process.exit(1);
});
```

- [ ] **Step 2: 验证语法**

Run: `node -c scripts/setup.js`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add scripts/setup.js
git commit -m "feat: add first-time setup wizard setup.js"
```

---

### Task 3: 重写核心启动编排器 `scripts/start.js`

**目标:** 基于 `env-check.js` 重写 `start.js`，增加端口冲突检测、性能报告、更精确的就绪检测。

**Files:**
- Modify: `scripts/start.js`

- [ ] **Step 1: 重写 `scripts/start.js`**

```javascript
#!/usr/bin/env node

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  colors, log, ROOT_DIR, serviceConfig,
  checkNodeVersion, checkMySQL, checkRedis,
  checkPortConflict, checkDependencies, checkPrismaClient,
  httpHealthCheck, getServicesToStart,
} from './env-check.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(ROOT_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'startup.log');

// ============================================================
// 参数解析
// ============================================================
const args = process.argv.slice(2);
const isDev = args.includes('--dev');
const isApiOnly = args.includes('--api-only');
const skipChecks = args.includes('--skip-checks');
const verbose = args.includes('--verbose');

const mode = isApiOnly ? 'api-only' : isDev ? 'dev' : 'all';

// ============================================================
// 日志（控制台 + 文件）
// ============================================================
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function writeLog(level, msg) {
  const timestamp = new Date().toISOString();
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, `[${timestamp}] [${level}] ${msg}\n`, 'utf-8');
  } catch {}
}

// ============================================================
// 性能计时
// ============================================================
const timers = {};
function timerStart(name) { timers[name] = { start: Date.now() }; }
function timerEnd(name) {
  if (timers[name]) {
    timers[name].elapsed = ((Date.now() - timers[name].start) / 1000).toFixed(1);
  }
}
function getTimer(name) { return timers[name]?.elapsed ?? '-'; }

// ============================================================
// 服务启动
// ============================================================
function startService(config) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const command = isWindows ? `${config.command}.cmd` : config.command;

    const child = spawn(command, config.args, {
      cwd: config.dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, FORCE_COLOR: 'true' },
    });

    // 服务日志文件
    const serviceLogFile = path.join(LOG_DIR, `${config.name.replace(/\s+/g, '_').toLowerCase()}.log`);
    ensureLogDir();
    const logStream = fs.createWriteStream(serviceLogFile, { flags: 'a' });

    let resolved = false;
    const timeoutMs = config.healthTimeout || 30000;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        logStream.end();
        if (isWindows && child.pid) {
          try { execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' }); } catch {}
        }
        reject(new Error(`${config.name} 启动超时 (${timeoutMs / 1000}s)`));
      }
    }, timeoutMs);

    const readyPatterns = config.readyPatterns || ['ready', 'Local:'];
    const onData = (data) => {
      logStream.write(data);
      if (verbose) process.stdout.write(`  [${config.name}] ${data}`);
      if (!resolved && readyPatterns.some(p => data.toString().includes(p))) {
        resolved = true;
        clearTimeout(timeout);
        resolve(child);
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
      if (!resolved) { resolved = true; clearTimeout(timeout); logStream.end(); reject(err); }
    });
    child.on('exit', (code) => {
      logStream.end();
      if (code !== null && code !== 0 && !resolved) {
        resolved = true; clearTimeout(timeout);
        reject(new Error(`${config.name} 进程退出 (code: ${code})`));
      }
    });
  });
}

// ============================================================
// 性能报告
// ============================================================
function printPerformanceReport(servicesToStart, results) {
  const sep = `${colors.dim}${'─'.repeat(60)}${colors.reset}`;
  console.log('');
  console.log(`${colors.bright}📊 启动性能报告${colors.reset}`);
  console.log(sep);

  for (const key of servicesToStart) {
    const cfg = serviceConfig[key];
    const r = results[key];
    const time = r?.elapsed ?? '-';
    const status = r?.ok ? `${colors.green}✔${colors.reset}` : `${colors.red}✘${colors.reset}`;
    console.log(`  ${status} ${cfg.icon} ${cfg.name.padEnd(16)} ${time}s`);
  }

  const totalTime = getTimer('total');
  console.log(sep);
  console.log(`  总耗时: ${colors.bright}${totalTime}s${colors.reset}`);

  // 识别瓶颈
  const slowest = Object.entries(results)
    .filter(([, r]) => r?.ok)
    .sort((a, b) => parseFloat(b[1].elapsed || 0) - parseFloat(a[1].elapsed || 0))[0];
  if (slowest) {
    console.log(`  瓶颈: ${serviceConfig[slowest[0]].name} (${slowest[1].elapsed}s)`);
  }
  console.log('');
}

// ============================================================
// 状态表格
// ============================================================
function printStatusTable(servicesToStart, results) {
  const sep = `${colors.dim}${'─'.repeat(64)}${colors.reset}`;
  console.log('');
  console.log(`${colors.bright}📊 服务状态${colors.reset}`);
  console.log(sep);

  for (const key of servicesToStart) {
    const cfg = serviceConfig[key];
    const r = results[key];
    const status = r?.ok
      ? `${colors.green}✔ 运行中${colors.reset}`
      : `${colors.red}✘ 失败${colors.reset}`;
    const url = `http://localhost:${cfg.port}`;
    console.log(`  ${cfg.icon} ${cfg.name.padEnd(16)} ${String(cfg.port).padEnd(8)} ${status}  ${colors.cyan}${url}${colors.reset}`);
  }
  console.log(sep);
  console.log('');
}

// ============================================================
// 浏览器
// ============================================================
function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${cmd} ${url}`, () => {});
}

// ============================================================
// 主函数
// ============================================================
async function main() {
  timerStart('total');
  ensureLogDir();
  writeLog('INFO', '========== 音乐盒子启动 ==========');

  console.log(`\n${colors.bright}🎵 音乐盒子启动器${colors.reset}`);
  console.log(`${colors.dim}  模式: ${mode}${colors.reset}\n`);

  // Phase 0: 环境校验
  if (!skipChecks) {
    timerStart('env-check');
    log.step('Phase 0: 环境校验');

    if (!checkNodeVersion()) process.exit(1);
    if (!checkDependencies()) {
      log.error('请先运行 npm run setup 或 npm run install:all');
      process.exit(1);
    }

    const mysqlOk = await checkMySQL();
    if (!mysqlOk) process.exit(1);

    await checkRedis(); // 可选，不阻塞

    // 端口冲突检测
    const servicesToStart = getServicesToStart(mode);
    for (const key of servicesToStart) {
      const cfg = serviceConfig[key];
      const conflict = await checkPortConflict(cfg.port);
      if (conflict) {
        log.warn(`端口 ${cfg.port} 被占用 (PID: ${conflict.pid}, 进程: ${conflict.processName}) (E004)`);
        log.step(`  自动释放端口 ${cfg.port}...`);
        const { killPortProcess } = await import('./env-check.js');
        const killed = await killPortProcess(cfg.port);
        if (killed) {
          log.success(`  端口 ${cfg.port} 已释放`);
        } else {
          log.error(`  无法释放端口 ${cfg.port}，请手动处理`);
          process.exit(1);
        }
      }
    }

    timerEnd('env-check');
    log.success(`环境校验完成 (${getTimer('env-check')}s)`);
  } else {
    log.warn('已跳过环境校验 (--skip-checks)');
  }
  console.log('');

  // Phase 1: 数据库准备
  timerStart('db-prepare');
  log.step('Phase 1: 数据库准备');

  if (!checkPrismaClient()) {
    log.step('  生成 Prisma Client...');
    try {
      execSync('npx prisma generate', { cwd: path.join(ROOT_DIR, 'server'), stdio: 'inherit' });
      log.success('  Prisma Client 已生成');
    } catch {
      log.error('  Prisma Client 生成失败 (E006)');
      process.exit(1);
    }
  } else {
    log.success('  Prisma Client 已存在');
  }

  timerEnd('db-prepare');
  console.log('');

  // Phase 2: 服务启动
  timerStart('service-start');
  log.step('Phase 2: 服务启动');

  const servicesToStart = getServicesToStart(mode);
  const processes = [];
  const results = {};

  // 优雅退出
  const isWin = process.platform === 'win32';
  function gracefulShutdown(signal) {
    console.log(`\n${colors.yellow}收到 ${signal}，停止所有服务...${colors.reset}`);
    for (const { process: child, config } of processes) {
      if (isWin && child.pid) {
        try { execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' }); } catch {}
      }
      log.info(`${config.name} 已停止`);
    }
    writeLog('INFO', '========== 服务已停止 ==========');
    process.exit(0);
  }
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // API 先串行启动
  const apiKeys = servicesToStart.filter(k => k === 'api');
  const frontendKeys = servicesToStart.filter(k => k !== 'api');

  for (const key of apiKeys) {
    const cfg = serviceConfig[key];
    timerStart(`service-${key}`);
    log.step(`  启动 ${cfg.name} (端口 ${cfg.port})...`);
    try {
      const child = await startService(cfg);
      processes.push({ key, process: child, config: cfg });
      timerEnd(`service-${key}`);
      results[key] = { ok: true, elapsed: getTimer(`service-${key}`) };
      log.success(`  ${cfg.name} 已启动 (${getTimer(`service-${key}`)}s)`);
    } catch (err) {
      timerEnd(`service-${key}`);
      results[key] = { ok: false, elapsed: getTimer(`service-${key}`), error: err.message };
      log.error(`  ${cfg.name} 启动失败: ${err.message}`);
    }
  }

  // 前端并行启动
  if (frontendKeys.length > 0 && results['api']?.ok) {
    await Promise.all(frontendKeys.map(async (key) => {
      const cfg = serviceConfig[key];
      timerStart(`service-${key}`);
      log.step(`  启动 ${cfg.name} (端口 ${cfg.port})...`);
      try {
        const child = await startService(cfg);
        processes.push({ key, process: child, config: cfg });
        timerEnd(`service-${key}`);
        results[key] = { ok: true, elapsed: getTimer(`service-${key}`) };
        log.success(`  ${cfg.name} 已启动 (${getTimer(`service-${key}`)}s)`);
      } catch (err) {
        timerEnd(`service-${key}`);
        results[key] = { ok: false, elapsed: getTimer(`service-${key}`), error: err.message };
        log.error(`  ${cfg.name} 启动失败: ${err.message}`);
      }
    }));
  } else if (!results['api']?.ok) {
    log.error('API Server 启动失败，跳过前端服务 (E007)');
  }

  timerEnd('service-start');
  console.log('');

  // Phase 3: 就绪验证
  log.step('Phase 3: 就绪验证');
  if (results['api']?.ok) {
    const healthy = await httpHealthCheck(serviceConfig.api.healthUrl);
    if (healthy) {
      log.success('  API Server 健康检查通过');
    } else {
      log.warn('  API Server 健康检查未通过');
    }
  }

  for (const key of frontendKeys) {
    if (results[key]?.ok) {
      const ok = await checkPortConflict(serviceConfig[key].port);
      log.success(`  ${serviceConfig[key].name} 端口 ${serviceConfig[key].port} 可访问`);
    }
  }
  console.log('');

  timerEnd('total');

  // 输出
  printStatusTable(servicesToStart, results);
  printPerformanceReport(servicesToStart, results);

  // 打开浏览器
  if (results['web']?.ok) {
    log.step('打开 Web Player...');
    setTimeout(() => openBrowser(`http://localhost:${serviceConfig.web.port}`), 2000);
  }

  // 汇总
  const okCount = Object.values(results).filter(r => r.ok).length;
  writeLog('INFO', `启动完成: ${okCount}/${servicesToStart.length} 服务运行`);
  log.info(`日志: ${LOG_FILE}`);
  console.log(`${colors.bright}按 Ctrl+C 停止所有服务${colors.reset}\n`);

  // 保持进程运行
  await new Promise(() => {});
}

// 动态导入 exec（仅 openBrowser 需要）
import { exec } from 'child_process';

main().catch((error) => {
  log.error(`启动失败: ${error.message}`);
  writeLog('FATAL', error.stack || error.message);
  process.exit(1);
});
```

- [ ] **Step 2: 验证语法**

Run: `node -c scripts/start.js`
Expected: 无输出

- [ ] **Step 3: 运行启动脚本验证**

Run: `node scripts/start.js --skip-checks --api-only`
Expected: API Server 启动成功，显示性能报告

- [ ] **Step 4: Commit**

```bash
git add scripts/start.js
git commit -m "feat: rewrite start.js with port conflict detection and performance report"
```

---

### Task 4: 增强健康检查 `scripts/health.js`

**目标:** 添加 `--watch` 持续监控模式和 `--json` 输出模式。

**Files:**
- Modify: `scripts/health.js`

- [ ] **Step 1: 重写 `scripts/health.js`**

```javascript
#!/usr/bin/env node

import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  colors, log, serviceConfig, ROOT_DIR,
  checkPort, httpHealthCheck,
} from './env-check.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(ROOT_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'health.log');

const args = process.argv.slice(2);
const watchMode = args.includes('--watch');
const jsonMode = args.includes('--json');

const WATCH_INTERVAL = 30000; // 30 秒

// ============================================================
// 日志
// ============================================================
function writeLog(msg) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`, 'utf-8');
  } catch {}
}

// ============================================================
// 检查逻辑
// ============================================================
async function checkAll() {
  const services = Object.entries(serviceConfig);
  const results = [];

  for (const [key, svc] of services) {
    const portOk = await checkPort(svc.port);
    if (!portOk) {
      results.push({ key, name: svc.name, port: svc.port, status: 'offline', required: svc.required });
      continue;
    }

    if (svc.healthUrl) {
      const httpOk = await httpHealthCheck(svc.healthUrl);
      results.push({
        key, name: svc.name, port: svc.port,
        status: httpOk ? 'healthy' : 'unhealthy',
        required: svc.required,
      });
    } else {
      results.push({ key, name: svc.name, port: svc.port, status: 'running', required: svc.required });
    }
  }

  return results;
}

// ============================================================
// 输出
// ============================================================
function printTable(results) {
  const sep = `${colors.dim}${'─'.repeat(60)}${colors.reset}`;
  console.log(`\n${colors.bright}🏥 音乐盒子健康检查${colors.reset}`);
  console.log(sep);

  for (const r of results) {
    const statusColor = r.status === 'healthy' || r.status === 'running'
      ? colors.green : r.status === 'unhealthy' ? colors.yellow : colors.red;
    const statusText = r.status === 'healthy' ? '✔ 健康'
      : r.status === 'running' ? '● 运行中'
      : r.status === 'unhealthy' ? '⚠ 异常'
      : '✘ 离线';
    console.log(`  ${r.name.padEnd(16)} ${String(r.port).padEnd(8)} ${statusColor}${statusText}${colors.reset}`);
  }

  console.log(sep);

  const allOk = results.every(r => r.status === 'healthy' || r.status === 'running');
  const requiredOk = results.filter(r => r.required).every(r => r.status === 'healthy' || r.status === 'running');

  if (allOk) {
    console.log(`${colors.green}✅ 所有服务正常${colors.reset}`);
  } else if (requiredOk) {
    console.log(`${colors.yellow}⚠️  必要服务正常，部分可选服务离线${colors.reset}`);
  } else {
    console.log(`${colors.red}❌ 必要服务异常${colors.reset}`);
  }
  console.log('');
  return requiredOk;
}

function printJson(results) {
  const output = {
    timestamp: new Date().toISOString(),
    services: results.map(r => ({
      name: r.name,
      port: r.port,
      status: r.status,
      required: r.required,
    })),
    healthy: results.every(r => r.status === 'healthy' || r.status === 'running'),
    requiredHealthy: results.filter(r => r.required).every(r => r.status === 'healthy' || r.status === 'running'),
  };
  console.log(JSON.stringify(output, null, 2));
}

// ============================================================
// 主函数
// ============================================================
async function runOnce() {
  const results = await checkAll();
  if (jsonMode) {
    printJson(results);
  } else {
    printTable(results);
  }
  writeLog(JSON.stringify(results.map(r => ({ name: r.name, status: r.status }))));
  return results.every(r => r.status === 'healthy' || r.status === 'running');
}

async function main() {
  if (watchMode) {
    console.log(`${colors.bright}👀 持续监控模式 (每 ${WATCH_INTERVAL / 1000}s 检查一次，Ctrl+C 退出)${colors.reset}`);
    while (true) {
      await runOnce();
      await new Promise(r => setTimeout(r, WATCH_INTERVAL));
    }
  } else {
    const ok = await runOnce();
    process.exit(ok ? 0 : 1);
  }
}

main().catch((error) => {
  log.error(`健康检查失败: ${error.message}`);
  process.exit(1);
});
```

- [ ] **Step 2: 测试单次检查**

Run: `node scripts/health.js`
Expected: 显示服务状态表格

- [ ] **Step 3: 测试 JSON 输出**

Run: `node scripts/health.js --json`
Expected: 输出 JSON 格式的服务状态

- [ ] **Step 4: Commit**

```bash
git add scripts/health.js
git commit -m "feat: enhance health.js with --watch and --json modes"
```

---

### Task 5: 增强优雅停止 `scripts/stop.js`

**Files:**
- Modify: `scripts/stop.js`

- [ ] **Step 1: 重写 `scripts/stop.js`**

```javascript
#!/usr/bin/env node

import { execSync } from 'child_process';
import { serviceConfig, log, colors } from './env-check.js';

const ports = Object.values(serviceConfig).map(s => s.port);

async function killPort(port) {
  try {
    if (process.platform === 'win32') {
      const output = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf-8' });
      const lines = output.trim().split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0') {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        }
      }
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`\n${colors.bright}🛑 停止音乐盒子服务${colors.reset}\n`);

  let stopped = 0;
  for (const port of ports) {
    log.info(`停止端口 ${port}...`);
    const ok = await killPort(port);
    if (ok) {
      log.success(`端口 ${port} 已释放`);
      stopped++;
    } else {
      log.info(`端口 ${port} 无服务运行`);
    }
  }

  console.log(`\n${colors.green}✅ 已停止 ${stopped} 个服务${colors.reset}\n`);
}

main();
```

- [ ] **Step 2: Commit**

```bash
git add scripts/stop.js
git commit -m "feat: enhance stop.js to use shared service config"
```

---

### Task 6: 创建批量工具脚本

**Files:**
- Create: `scripts/install-all.js`
- Create: `scripts/build-all.js`

- [ ] **Step 1: 创建 `scripts/install-all.js`**

```javascript
#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { colors, log, ROOT_DIR } from './env-check.js';

const subdirs = [
  { dir: 'server', name: 'API Server' },
  { dir: 'web', name: 'Web Player' },
  { dir: path.join('web', 'admin'), name: 'Admin' },
  { dir: path.join('web', 'browse'), name: 'Browse' },
];

async function main() {
  console.log(`\n${colors.bright}📦 安装所有子项目依赖${colors.reset}\n`);

  for (const { dir, name } of subdirs) {
    const fullDir = path.join(ROOT_DIR, dir);
    log.step(`安装 ${name}...`);
    try {
      execSync('npm install', { cwd: fullDir, stdio: 'inherit' });
      log.success(`${name} 依赖安装完成`);
    } catch {
      log.error(`${name} 依赖安装失败`);
      process.exit(1);
    }
  }

  console.log(`\n${colors.green}✅ 所有依赖安装完成${colors.reset}\n`);
}

main();
```

- [ ] **Step 2: 创建 `scripts/build-all.js`**

```javascript
#!/usr/bin/env node

import { execSync } from 'child_process';
import path from 'path';
import { colors, log, ROOT_DIR } from './env-check.js';

const builds = [
  { dir: 'server', name: 'API Server', cmd: 'npm run build' },
  { dir: 'web', name: 'Web Player', cmd: 'npm run build' },
  { dir: path.join('web', 'admin'), name: 'Admin', cmd: 'npm run build' },
  { dir: path.join('web', 'browse'), name: 'Browse', cmd: 'npm run build' },
];

async function main() {
  console.log(`\n${colors.bright}🔨 构建所有子项目${colors.reset}\n`);

  for (const { dir, name, cmd } of builds) {
    const fullDir = path.join(ROOT_DIR, dir);
    log.step(`构建 ${name}...`);
    try {
      execSync(cmd, { cwd: fullDir, stdio: 'inherit' });
      log.success(`${name} 构建完成`);
    } catch {
      log.error(`${name} 构建失败`);
      process.exit(1);
    }
  }

  console.log(`\n${colors.green}✅ 所有项目构建完成${colors.reset}\n`);
}

main();
```

- [ ] **Step 3: Commit**

```bash
git add scripts/install-all.js scripts/build-all.js
git commit -m "feat: add install-all.js and build-all.js batch scripts"
```

---

### Task 7: 更新根 `package.json` 和 `start.bat`

**Files:**
- Modify: `package.json`
- Modify: `start.bat`

- [ ] **Step 1: 更新 `package.json` scripts**

```json
{
  "name": "music-box",
  "version": "1.0.0",
  "description": "音乐盒子 - 统一启动方案",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node scripts/start.js",
    "start:dev": "node scripts/start.js --dev",
    "start:api": "node scripts/start.js --api-only",
    "start:prod": "docker-compose up -d",
    "stop": "node scripts/stop.js",
    "health": "node scripts/health.js",
    "health:watch": "node scripts/health.js --watch",
    "health:json": "node scripts/health.js --json",
    "setup": "node scripts/setup.js",
    "install:all": "node scripts/install-all.js",
    "build:all": "node scripts/build-all.js"
  },
  "devDependencies": {
    "chalk": "^5.3.0",
    "ora": "^8.0.1"
  }
}
```

- [ ] **Step 2: 简化 `start.bat`**

```batch
@echo off
chcp 65001 >nul 2>&1
title Music Box Starter

echo.
echo ============================================================
echo                    Music Box Starter
echo ============================================================
echo.

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js ^>= 18.
    pause
    exit /b 1
)

:: 调用 Node.js 启动脚本
node "%~dp0scripts\start.js" %*
```

- [ ] **Step 3: 验证 `package.json` 语法**

Run: `node -e "require('./package.json')"`
Expected: 无输出

- [ ] **Step 4: Commit**

```bash
git add package.json start.bat
git commit -m "feat: update package.json scripts and simplify start.bat"
```

---

### Task 8: 创建环境配置文件

**Files:**
- Create: `.env.development`
- Modify: `.env.example` (增强文档注释)
- Modify: `.gitignore` (添加新文件规则)

- [ ] **Step 1: 创建 `.env.development`**

```bash
# Music Box - 开发环境默认值
# 此文件提交到 Git，用于开发环境的默认配置
# 本地覆盖请编辑 server/.env

# 服务端口
API_PORT=3000
WEB_PORT=5173
ADMIN_PORT=5174
BROWSE_PORT=5175

# 启动行为
AUTO_RESTART=false
STARTUP_TIMEOUT=30000
HEALTH_CHECK_INTERVAL=30000
MAX_RESTART_ATTEMPTS=3

# 日志
LOG_LEVEL=debug
ENABLE_REQUEST_LOGGING=true
```

- [ ] **Step 2: 更新 `.gitignore`**

在现有 `.gitignore` 中添加：

```
# 启动日志
logs/

# 环境配置（保留模板和开发默认值）
server/.env
.env.production
```

- [ ] **Step 3: Commit**

```bash
git add .env.development .gitignore
git commit -m "feat: add .env.development and update .gitignore"
```

---

### Task 9: 创建 Docker 生产部署配置

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `docker-compose.dev.yml`
- Create: `nginx/default.conf`

- [ ] **Step 1: 创建 `Dockerfile`**

```dockerfile
# ============================================================
# Stage 1: API Server 构建
# ============================================================
FROM node:18-alpine AS api-builder
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --production=false
COPY server/ .
RUN npx prisma generate && npm run build

# ============================================================
# Stage 2: API Server 运行
# ============================================================
FROM node:18-alpine AS api-runtime
RUN apk add --no-cache dumb-init
WORKDIR /app
COPY --from=api-builder /app/server/dist ./dist
COPY --from=api-builder /app/server/node_modules ./node_modules
COPY --from=api-builder /app/server/prisma ./prisma
COPY --from=api-builder /app/server/package.json ./
ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]

# ============================================================
# Stage 3: 前端构建
# ============================================================
FROM node:18-alpine AS frontend-builder
WORKDIR /app

# 安装 Web Player 依赖
COPY web/package*.json web/
RUN cd web && npm ci

# 安装 Admin 依赖
COPY web/admin/package*.json web/admin/
RUN cd web/admin && npm ci

# 安装 Browse 依赖
COPY web/browse/package*.json web/browse/
RUN cd web/browse && npm ci

# 复制源码并构建
COPY web/ web/
RUN cd web && npm run build
RUN cd web/admin && npm run build
RUN cd web/browse && npm run build

# ============================================================
# Stage 4: Nginx 静态服务
# ============================================================
FROM nginx:alpine AS web-runtime
COPY --from=frontend-builder /app/web/dist /usr/share/nginx/html/web
COPY --from=frontend-builder /app/web/admin/dist /usr/share/nginx/html/admin
COPY --from=frontend-builder /app/web/browse/dist /usr/share/nginx/html/browse
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

- [ ] **Step 2: 创建 `docker-compose.yml`**

```yaml
version: '3.8'

services:
  mysql:
    image: mysql:8.0
    restart: unless-stopped
    volumes:
      - mysql_data:/var/lib/mysql
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:-musicbox123}
      MYSQL_DATABASE: music_box
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
    ports:
      - "3306:3306"

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"

  api:
    build:
      context: .
      target: api-runtime
    restart: unless-stopped
    depends_on:
      mysql:
        condition: service_healthy
    environment:
      DATABASE_URL: mysql://root:${MYSQL_ROOT_PASSWORD:-musicbox123}@mysql:3306/music_box
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET:-change-me-in-production-at-least-32-chars}
      NODE_ENV: production
      PORT: 3000
    ports:
      - "3000:3000"

  web:
    build:
      context: .
      target: web-runtime
    restart: unless-stopped
    ports:
      - "80:80"
    depends_on:
      - api

volumes:
  mysql_data:
  redis_data:
```

- [ ] **Step 3: 创建 `docker-compose.dev.yml`**

```yaml
version: '3.8'

# 开发环境覆盖：仅启动 MySQL 和 Redis
# 用法: docker-compose -f docker-compose.dev.yml up -d

services:
  mysql:
    image: mysql:8.0
    restart: unless-stopped
    volumes:
      - mysql_data_dev:/var/lib/mysql
    environment:
      MYSQL_ROOT_PASSWORD: musicbox123
      MYSQL_DATABASE: music_box
    ports:
      - "3306:3306"

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data_dev:/data
    ports:
      - "6379:6379"

volumes:
  mysql_data_dev:
  redis_data_dev:
```

- [ ] **Step 4: 创建 `nginx/default.conf`**

```nginx
server {
    listen 80;
    server_name localhost;

    # API 代理
    location /api/ {
        proxy_pass http://api:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_read_timeout 60s;
    }

    # 健康检查代理
    location /health {
        proxy_pass http://api:3000/health;
    }

    # Web Player (默认)
    location / {
        root /usr/share/nginx/html/web;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # Admin 后台
    location /admin/ {
        alias /usr/share/nginx/html/admin/;
        index index.html;
        try_files $uri $uri/ /admin/index.html;
    }

    # Browse 浏览
    location /browse/ {
        alias /usr/share/nginx/html/browse/;
        index index.html;
        try_files $uri $uri/ /browse/index.html;
    }

    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml docker-compose.dev.yml nginx/
git commit -m "feat: add Docker production deployment configuration"
```

---

### Task 10: 创建 CI/CD 流水线

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: 创建 `.github/workflows/ci.yml`**

```yaml
name: CI/CD

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: '18'

jobs:
  test:
    name: Test
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: test123
          MYSQL_DATABASE: music_box
        ports:
          - 3306:3306
        options: >-
          --health-cmd "mysqladmin ping -h localhost"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}

      - name: Install server dependencies
        run: npm ci
        working-directory: server

      - name: Generate Prisma Client
        run: npx prisma generate
        working-directory: server

      - name: Run database migrations
        run: npx prisma migrate deploy
        working-directory: server
        env:
          DATABASE_URL: mysql://root:test123@localhost:3306/music_box

      - name: Run server tests
        run: npm test
        working-directory: server
        env:
          DATABASE_URL: mysql://root:test123@localhost:3306/music_box
          JWT_SECRET: test-secret-key-for-ci-only-32chars

  build:
    name: Build
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}

      - name: Install web dependencies
        run: npm ci
        working-directory: web

      - name: Build web
        run: npm run build
        working-directory: web

      - name: Install admin dependencies
        run: npm ci
        working-directory: web/admin

      - name: Build admin
        run: npm run build
        working-directory: web/admin

      - name: Install browse dependencies
        run: npm ci
        working-directory: web/browse

      - name: Build browse
        run: npm run build
        working-directory: web/browse

  docker:
    name: Docker Build
    runs-on: ubuntu-latest
    needs: [test, build]
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4

      - name: Build Docker image
        run: docker build -t music-box:${{ github.sha }} .

      - name: Verify Docker image
        run: docker images music-box
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "feat: add GitHub Actions CI/CD pipeline"
```

---

### Task 11: 创建文档

**Files:**
- Create: `docs/setup.md`
- Create: `docs/deployment.md`
- Create: `docs/troubleshooting.md`

- [ ] **Step 1: 创建 `docs/setup.md`**

```markdown
# Music Box 安装指南

## 前置要求

- **Node.js** >= 18.x ([下载](https://nodejs.org/))
- **MySQL** >= 8.0 ([下载](https://dev.mysql.com/downloads/))
- **Redis** >= 7.0 (可选，用于缓存) ([下载](https://redis.io/download))
- **Git** ([下载](https://git-scm.com/))

## 快速开始（推荐）

```bash
# 1. 克隆项目
git clone <repo-url>
cd music_box

# 2. 运行安装向导（自动完成以下所有步骤）
npm run setup
```

## 手动安装

```bash
# 1. 安装所有依赖
npm run install:all

# 2. 配置环境变量
cp server/.env.example server/.env
# 编辑 server/.env，修改数据库密码等配置

# 3. 数据库迁移
cd server
npx prisma generate
npx prisma migrate deploy
cd ..

# 4. 导入预设数据（可选）
mysql -u root -p < scripts/seed_data.sql
```

## 启动服务

```bash
# 启动所有服务
npm run start

# 仅启动 API + Web + Admin（不含 Browse）
npm run start:dev

# 仅启动 API Server
npm run start:api

# 停止所有服务
npm run stop

# 检查服务状态
npm run health
```

## 服务地址

| 服务 | 地址 |
|------|------|
| API Server | http://localhost:3000 |
| Web Player | http://localhost:5173 |
| Admin 后台 | http://localhost:5174 |
| Browse 浏览 | http://localhost:5175 |
```

- [ ] **Step 2: 创建 `docs/deployment.md`**

```markdown
# Music Box 部署指南

## Docker 部署（推荐）

### 前置要求
- Docker >= 20.10
- Docker Compose >= 2.0

### 部署步骤

```bash
# 1. 配置环境变量
export MYSQL_ROOT_PASSWORD=your-strong-password
export JWT_SECRET=your-jwt-secret-at-least-32-chars

# 2. 构建并启动
docker-compose up -d

# 3. 执行数据库迁移
docker-compose exec api npx prisma migrate deploy

# 4. 检查状态
docker-compose ps
```

### 服务访问

| 服务 | 地址 |
|------|------|
| Web Player | http://your-server |
| Admin 后台 | http://your-server/admin |
| Browse 浏览 | http://your-server/browse |
| API | http://your-server/api |

### 常用命令

```bash
# 查看日志
docker-compose logs -f api

# 重启服务
docker-compose restart api

# 停止所有服务
docker-compose down

# 更新部署
git pull
docker-compose build
docker-compose up -d
```

## 开发环境 Docker（仅数据库）

如果只想用 Docker 提供 MySQL 和 Redis，API 和前端在本地运行：

```bash
# 启动 MySQL + Redis
docker-compose -f docker-compose.dev.yml up -d

# 本地启动服务
npm run start
```
```

- [ ] **Step 3: 创建 `docs/troubleshooting.md`**

```markdown
# Music Box 故障排查指南

## 错误码对照表

| 错误码 | 含义 | 解决方案 |
|--------|------|---------|
| E001 | Node.js 版本不满足 | 安装 Node.js >= 18: https://nodejs.org/ |
| E002 | MySQL 连接失败 | 启动 MySQL 服务，检查端口 3306 |
| E003 | Redis 连接失败（警告） | 启动 Redis 服务，或忽略（缓存降级） |
| E004 | 端口被占用 | 脚本会自动释放，或手动 `netstat -ano \| findstr :PORT` |
| E005 | 依赖未安装 | 运行 `npm run install:all` 或 `npm run setup` |
| E006 | Prisma 迁移失败 | 检查数据库连接，运行 `cd server && npx prisma migrate dev` |
| E007 | API Server 启动失败 | 检查 `logs/server.log` 日志 |
| E008 | 前端编译失败 | 检查 `logs/web.log` 日志 |
| E009 | 启动超时 | 增加 `STARTUP_TIMEOUT` 或检查系统资源 |
| E010 | 运行时崩溃 | 检查日志，启用 `AUTO_RESTART=true` |

## 常见问题

### "无法连接服务器，后端服务器未开启"

**原因**: API Server 未就绪时前端就尝试连接。

**解决**:
1. 确保 MySQL 已启动
2. 运行 `npm run health` 检查 API Server 状态
3. 如果 API Server 未运行，运行 `npm run start:api` 单独启动

### 端口 3000 被占用

```bash
# Windows
netstat -ano | findstr :3000 | findstr LISTENING
taskkill /F /PID <PID>

# Linux/Mac
lsof -i :3000
kill -9 <PID>
```

### Prisma Client 未生成

```bash
cd server
npx prisma generate
```

### 数据库迁移失败

```bash
cd server
npx prisma migrate dev --name init
```

### Redis 连接失败

Redis 是可选的。如果 Redis 未运行：
- **开发模式**: 服务会正常启动，缓存功能降级
- **生产模式**: 必须启动 Redis

```bash
# Windows (需先安装 Redis)
redis-server

# Linux
sudo systemctl start redis

# Mac
brew services start redis
```
```

- [ ] **Step 4: Commit**

```bash
git add docs/setup.md docs/deployment.md docs/troubleshooting.md
git commit -m "docs: add setup, deployment, and troubleshooting guides"
```

---

### Task 12: 端到端验证

**目标:** 验证整个启动体系在本地开发环境下正常工作。

- [ ] **Step 1: 验证 `npm run health`**

Run: `npm run health`
Expected: 显示服务状态表格，所有服务标记为离线或运行中

- [ ] **Step 2: 验证 `npm run start`**

Run: `npm run start`
Expected:
- Phase 0 环境校验通过
- Phase 1 数据库准备完成
- Phase 2 服务启动成功
- Phase 3 就绪验证通过
- 显示性能报告
- 自动打开浏览器

- [ ] **Step 3: 验证 `npm run health --json`**

Run: `npm run health --json`
Expected: 输出 JSON 格式的服务状态

- [ ] **Step 4: 验证 `npm run stop`**

Run: `npm run stop`
Expected: 所有服务停止，端口释放

- [ ] **Step 5: 验证 Docker 构建**

Run: `docker build -t music-box:test .`
Expected: 构建成功

- [ ] **Step 6: Final Commit**

```bash
git add -A
git commit -m "feat: complete startup system restructure"
```
