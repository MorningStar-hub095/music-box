#!/usr/bin/env node
/**
 * =============================================================================
 *  音乐盒子 - 独立后端服务器启动脚本 (start-server.cjs)
 * =============================================================================
 *  功能说明：
 *    1. 自动检查服务器运行环境依赖 (Node.js / MySQL / Redis / node_modules / Prisma Client)
 *    2. 配置必要的环境变量 (从 server/.env 加载，并设置合理默认值)
 *    3. 启动后端服务器进程 (优先使用编译后的 dist/index.js，否则回退到 ts-node)
 *    4. 提供明确的启动状态反馈 (彩色控制台输出 + 日志文件 + 健康检查)
 *
 *  使用方法：
 *    node scripts/start-server.cjs [选项]
 *
 *  常用选项：
 *    --skip-checks       跳过环境检查（仅在已确认环境就绪时使用）
 *    --dev               以开发模式启动（使用 ts-node 运行 src/index.ts）
 *    --foreground        前台运行（Ctrl+C 退出时一并停止子进程）
 *    --port <端口>       覆盖 .env 中的 PORT
 *    --verbose           输出详细子进程日志
 *    --help              显示帮助信息
 *
 *  详细文档：见 docs/start-server.md
 * =============================================================================
 */

'use strict';

const { spawn, execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

// ============================================================
// 常量与路径
// ============================================================
const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT_DIR, 'server');
const DIST_ENTRY = path.join(SERVER_DIR, 'dist', 'index.js');
const SRC_ENTRY = path.join(SERVER_DIR, 'src', 'index.ts');
const ENV_FILE = path.join(SERVER_DIR, '.env');
const ENV_EXAMPLE = path.join(SERVER_DIR, '.env.example');
const LOG_DIR = path.join(ROOT_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'start-server.log');

// ============================================================
// 颜色配置（Windows 下兼容）
// ============================================================
const colors = {
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

const isWindows = process.platform === 'win32';

// ============================================================
// 日志工具（控制台 + 文件）
// ============================================================
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function writeLog(level, msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${msg}\n`;
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
  } catch (_) {
    // 文件写入失败不影响主流程
  }
}

const log = {
  info: (msg) => { console.log(`${colors.cyan}[INFO]${colors.reset} ${msg}`); writeLog('INFO', msg); },
  success: (msg) => { console.log(`${colors.green}[✓]${colors.reset} ${msg}`); writeLog('OK', msg); },
  warn: (msg) => { console.log(`${colors.yellow}[!]${colors.reset} ${msg}`); writeLog('WARN', msg); },
  error: (msg) => { console.error(`${colors.red}[✗]${colors.reset} ${msg}`); writeLog('ERROR', msg); },
  step: (msg) => { console.log(`${colors.blue}[→]${colors.reset} ${msg}`); writeLog('STEP', msg); },
  plain: (msg) => { console.log(msg); writeLog('INFO', String(msg).replace(/\x1b\[[0-9;]*m/g, '')); },
};

// ============================================================
// 解析启动参数
// ============================================================
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    skipChecks: args.includes('--skip-checks'),
    dev: args.includes('--dev'),
    foreground: args.includes('--foreground'),
    verbose: args.includes('--verbose'),
    help: args.includes('--help') || args.includes('-h'),
    port: null,
  };
  const portIdx = args.indexOf('--port');
  if (portIdx !== -1 && args[portIdx + 1]) {
    const p = parseInt(args[portIdx + 1], 10);
    if (!isNaN(p) && p > 0 && p < 65536) opts.port = p;
  }
  return opts;
}

function showHelp() {
  console.log(`
${colors.bright}音乐盒子 - 后端服务器启动脚本${colors.reset}

${colors.cyan}用法:${colors.reset}
  node scripts/start-server.cjs [选项]

${colors.cyan}选项:${colors.reset}
  --skip-checks       跳过环境依赖检查（仅在已确认环境就绪时使用）
  --dev               以开发模式启动（使用 ts-node 运行 src/index.ts）
  --foreground        前台运行（默认后台运行；前台模式下 Ctrl+C 会同时停止子进程）
  --port <端口>       覆盖 .env 中的 PORT 设置
  --verbose           输出详细子进程日志（用于调试）
  -h, --help          显示本帮助信息

${colors.cyan}示例:${colors.reset}
  # 标准启动（推荐）
  node scripts/start-server.cjs

  # 开发模式 + 前台运行
  node scripts/start-server.cjs --dev --foreground

  # 跳过环境检查，使用自定义端口
  node scripts/start-server.cjs --skip-checks --port 5050

${colors.cyan}日志:${colors.reset}
  启动日志: ${path.relative(process.cwd(), LOG_FILE)}
  服务日志: logs/api-server.log

${colors.cyan}退出码:${colors.reset}
  0  启动成功
  1  环境检查失败
  2  Prisma Client 生成失败
  3  端口被占用且无法释放
  4  服务启动超时
  5  健康检查失败
  99 内部异常
`);
}

// ============================================================
// 加载 .env 文件（手动解析，避免依赖 dotenv）
// ============================================================
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const envVars = {};
  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      // 去除两侧引号
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      envVars[key] = val;
    }
  } catch (e) {
    log.warn(`解析 .env 文件失败: ${envPath} - ${e.message}`);
  }
  return envVars;
}

function configureEnvironment(opts) {
  log.step('配置环境变量...');

  // 如果没有 .env 文件，从 .env.example 复制一份
  if (!fs.existsSync(ENV_FILE)) {
    if (fs.existsSync(ENV_EXAMPLE)) {
      log.warn(`未找到 .env 文件，从 .env.example 复制默认配置`);
      try {
        fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
        log.success('已创建 server/.env（请按需修改数据库密码等配置）');
      } catch (e) {
        log.error(`复制 .env.example 失败: ${e.message}`);
        return false;
      }
    } else {
      log.warn('未找到 .env 与 .env.example，将使用内置默认值');
    }
  }

  const envVars = loadEnvFile(ENV_FILE);

  // 注入到 process.env（不覆盖已存在的环境变量）
  let injected = 0;
  for (const [k, v] of Object.entries(envVars)) {
    if (process.env[k] === undefined) {
      process.env[k] = v;
      injected++;
    }
  }

  // 设置合理默认值（仅在未配置时）
  const defaults = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: '49200',
    JWT_SECRET: process.env.JWT_SECRET || 'music-box-secret-key',
    REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
    DATABASE_URL: process.env.DATABASE_URL || 'mysql://root:password@localhost:3306/music_box',
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }

  // 命令行 --port 覆盖
  if (opts.port) {
    process.env.PORT = String(opts.port);
  }

  const port = process.env.PORT;
  const dbUrlMasked = (process.env.DATABASE_URL || '').replace(/\/\/.*@/, '//***@');
  log.success(`环境变量配置完成 (注入 ${injected} 项)`);
  log.plain(`  ${colors.dim}端口:${colors.reset} ${colors.cyan}${port}${colors.reset}`);
  log.plain(`  ${colors.dim}数据库:${colors.reset} ${colors.cyan}${dbUrlMasked}${colors.reset}`);
  log.plain(`  ${colors.dim}Redis:${colors.reset} ${colors.cyan}${process.env.REDIS_URL}${colors.reset}`);
  log.plain(`  ${colors.dim}环境:${colors.reset} ${colors.cyan}${process.env.NODE_ENV}${colors.reset}`);
  return true;
}

// ============================================================
// 环境依赖检查
// ============================================================
function checkNodeVersion() {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);
  if (major < 18) {
    log.error(`Node.js 版本过低: ${version}，需要 >= 18.x (E001)`);
    log.warn('请前往 https://nodejs.org/ 下载 LTS 版本');
    return false;
  }
  log.success(`Node.js 版本: ${version}`);
  return true;
}

function checkServerDependencies() {
  const modulesPath = path.join(SERVER_DIR, 'node_modules');
  if (!fs.existsSync(modulesPath)) {
    log.error(`server/node_modules 不存在 (E005)`);
    log.warn('请运行: cd server && npm install');
    return false;
  }
  // 检查关键依赖
  const required = ['express', '@prisma/client', 'bcryptjs', 'jsonwebtoken', 'ioredis', 'cors', 'helmet'];
  let missing = [];
  for (const pkg of required) {
    if (!fs.existsSync(path.join(modulesPath, pkg))) {
      missing.push(pkg);
    }
  }
  if (missing.length > 0) {
    log.error(`缺少关键依赖: ${missing.join(', ')} (E006)`);
    log.warn('请运行: cd server && npm install');
    return false;
  }
  log.success('server 依赖检查通过');
  return true;
}

function checkPort(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
}

async function checkMySQL() {
  log.step('检查 MySQL 连接 (端口 3306)...');
  // 从 DATABASE_URL 提取端口
  const dbUrl = process.env.DATABASE_URL || '';
  const portMatch = dbUrl.match(/:(\d+)\/?\w/);
  const port = portMatch ? parseInt(portMatch[1], 10) : 3306;
  const ok = await checkPort('localhost', port);
  if (ok) {
    log.success(`MySQL 连接正常 (端口 ${port})`);
    return true;
  }
  log.error(`MySQL 连接失败 (端口 ${port} 不可达) (E002)`);
  log.warn('请确保 MySQL 服务已启动，且 server/.env 中 DATABASE_URL 配置正确');
  return false;
}

async function checkRedis() {
  log.step('检查 Redis 连接 (端口 6379)...');
  try {
    const ok = await new Promise((resolve) => {
      const socket = net.createConnection({ host: 'localhost', port: 6379 });
      socket.setTimeout(3000);
      socket.once('connect', () => { socket.write('PING\r\n'); });
      socket.once('data', (data) => {
        socket.destroy();
        const s = data.toString();
        resolve(s.includes('PONG') || s.startsWith('+'));
      });
      socket.once('error', () => { socket.destroy(); resolve(false); });
      socket.once('timeout', () => { socket.destroy(); resolve(false); });
    });
    if (ok) {
      log.success('Redis 连接正常');
      return true;
    }
    log.warn('Redis 连接失败，缓存功能可能不可用 (E003)');
    log.warn('请运行 Redis 服务（如需）：redis-server 或启动 Redis Windows 服务');
    return false;
  } catch (_) {
    log.warn('Redis 连接检查异常 (E003)');
    return false;
  }
}

function extractPortFromAddr(addr) {
  const m = addr.match(/:(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

async function checkPortConflict(port) {
  try {
    if (isWindows) {
      const { stdout } = await new Promise((resolve, reject) => {
        exec(`netstat -ano | findstr ":${port}"`, { timeout: 5000 }, (err, out) => {
          if (err) return resolve({ stdout: '' });
          resolve({ stdout: out });
        });
      });
      const lines = stdout.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const localAddr = parts[1];
        const state = parts[3];
        const pid = parts[4];
        if (state !== 'LISTENING') continue;
        if (extractPortFromAddr(localAddr) !== port) continue;
        if (!pid || pid === '0') continue;
        let processName = '';
        try {
          processName = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { timeout: 5000 }).toString().trim();
          const m = processName.match(/^"([^"]+)"/);
          if (m) processName = m[1];
        } catch (_) {}
        return { port, pid, processName };
      }
    } else {
      const { stdout } = await new Promise((resolve) => {
        exec(`lsof -i:${port} -t`, { timeout: 5000 }, (err, out) => resolve({ stdout: out || '' }));
      });
      const pids = stdout.trim().split('\n').filter(Boolean);
      if (pids.length > 0) return { port, pid: pids[0], processName: '' };
    }
    return null;
  } catch (_) {
    return null;
  }
}

async function killPortProcess(port) {
  try {
    if (isWindows) {
      const cmd = `netstat -ano | findstr ":${port}"`;
      const stdout = execSync(cmd, { timeout: 5000 }).toString();
      const killedPids = new Set();
      for (const line of stdout.trim().split('\n').filter(Boolean)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const localAddr = parts[1];
        const state = parts[3];
        const pid = parts[4];
        if (state !== 'LISTENING') continue;
        if (extractPortFromAddr(localAddr) !== port) continue;
        if (pid && pid !== '0' && !killedPids.has(pid)) {
          killedPids.add(pid);
          try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch (_) {}
        }
      }
    } else {
      try { execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: 'ignore' }); } catch (_) {}
    }
    return true;
  } catch (_) {
    return false;
  }
}

async function waitForPortFree(port, maxWait = 10000, interval = 500) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const inUse = await checkPort('localhost', port);
    if (!inUse) return true;
    await new Promise(r => setTimeout(r, interval));
  }
  return false;
}

async function ensurePortFree(port) {
  const conflict = await checkPortConflict(port);
  if (!conflict) {
    log.success(`端口 ${port} 可用`);
    return true;
  }
  log.warn(`端口 ${port} 被占用 (PID: ${conflict.pid}${conflict.processName ? ', ' + conflict.processName : ''}) (E004)`);
  log.warn(`正在释放端口 ${port}...`);
  await killPortProcess(port);
  const freed = await waitForPortFree(port, 10000, 500);
  if (freed) {
    log.success(`端口 ${port} 已释放`);
    return true;
  }
  log.error(`端口 ${port} 释放超时，可能仍有进程占用 (E007)`);
  log.warn(`请手动终止占用进程: taskkill /F /T /PID <PID>`);
  return false;
}

// ============================================================
// Prisma Client 检查与生成
// ============================================================
function checkPrismaClient() {
  // 检查 Prisma Client 是否已生成
  const prismaClientPath = path.join(
    SERVER_DIR, 'node_modules', '.prisma', 'client', 'index.js'
  );
  return fs.existsSync(prismaClientPath);
}

function generatePrisma() {
  if (checkPrismaClient()) {
    log.success('Prisma Client 已存在，跳过生成');
    return true;
  }
  log.step('生成 Prisma Client...');
  try {
    execSync('npx prisma generate', {
      cwd: SERVER_DIR,
      stdio: 'pipe',
      timeout: 60000,
    });
    if (checkPrismaClient()) {
      log.success('Prisma Client 已生成');
      return true;
    }
    log.error('Prisma Client 生成后仍未找到 (E008)');
    return false;
  } catch (e) {
    log.error('Prisma Client 生成失败: ' + (e.message || e));
    return false;
  }
}

// ============================================================
// 启动服务进程
// ============================================================
function startServerProcess(opts) {
  const port = parseInt(process.env.PORT, 10);

  let cmd, args;
  const useDist = !opts.dev && fs.existsSync(DIST_ENTRY);
  if (useDist) {
    cmd = 'node';
    args = [DIST_ENTRY];
    log.info(`使用编译版本: ${path.relative(ROOT_DIR, DIST_ENTRY)}`);
  } else if (opts.dev || !fs.existsSync(DIST_ENTRY)) {
    if (!fs.existsSync(SRC_ENTRY)) {
      log.error(`未找到服务入口: ${DIST_ENTRY} 或 ${SRC_ENTRY} (E009)`);
      log.warn('请先运行: cd server && npm run build');
      return null;
    }
    cmd = 'npx';
    args = ['ts-node', SRC_ENTRY];
    log.info(`使用 ts-node: ${path.relative(ROOT_DIR, SRC_ENTRY)}`);
  } else {
    cmd = 'node';
    args = [DIST_ENTRY];
  }

  const serviceLogPath = path.join(LOG_DIR, 'api-server.log');
  ensureLogDir();

  log.info(`启动命令: ${cmd} ${args.join(' ')}`);

  // 修复: 原代码 shell: isWindows 对所有命令使用 shell，触发 Node.js DEP0190 警告
  // 新逻辑: 仅 npx 在 Windows 上需要 shell（npx 是 .cmd 文件），node 命令不需要
  const needsShell = isWindows && cmd === 'npx';

  // 修复: 后台模式下使用 pipe 会导致父进程退出时 pipe 关闭，子进程收到 EPIPE 退出
  // 新逻辑: 后台模式使用文件描述符重定向 stdout/stderr 到日志文件，子进程完全独立
  //        前台/详细模式仍使用 pipe 以便实时显示子进程输出
  /* [原代码保留 - 通过注释代替删除]
  const logStream = fs.createWriteStream(serviceLogPath, { flags: 'a' });
  const child = spawn(cmd, args, {
    cwd: SERVER_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    shell: needsShell,
    windowsHide: true,
  });
  // 服务输出写入日志文件
  child.stdout.on('data', (data) => {
    const raw = data.toString();
    logStream.write(data);
    if (opts.verbose) {
      process.stdout.write(`${colors.dim}[srv]${colors.reset} ${raw}`);
    }
  });
  child.stderr.on('data', (data) => {
    const raw = data.toString();
    logStream.write(data);
    if (opts.verbose) {
      process.stderr.write(`${colors.dim}[srv]${colors.reset} ${raw}`);
    }
  });
  return { child, logStream, port };
  */

  if (opts.foreground || opts.verbose) {
    // 前台/详细模式：使用 pipe 读取子进程输出（需实时显示）
    const logStream = fs.createWriteStream(serviceLogPath, { flags: 'a' });
    const child = spawn(cmd, args, {
      cwd: SERVER_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      shell: needsShell,
      windowsHide: true,
    });
    child.stdout.on('data', (data) => {
      logStream.write(data);
      if (opts.verbose) {
        process.stdout.write(`${colors.dim}[srv]${colors.reset} ${data.toString()}`);
      }
    });
    child.stderr.on('data', (data) => {
      logStream.write(data);
      if (opts.verbose) {
        process.stderr.write(`${colors.dim}[srv]${colors.reset} ${data.toString()}`);
      }
    });
    return { child, logStream, port, usePipe: true };
  } else {
    // 后台模式：直接将 stdout/stderr 重定向到日志文件（避免父进程退出时 EPIPE）
    const outFd = fs.openSync(serviceLogPath, 'a');
    const child = spawn(cmd, args, {
      cwd: SERVER_DIR,
      stdio: ['ignore', outFd, outFd],
      env: process.env,
      shell: needsShell,
      windowsHide: true,
      detached: true,  // 创建独立进程组，使子进程完全脱离父进程
    });
    child.unref();
    return { child, logStream: null, port, usePipe: false, outFd };
  }
}

// ============================================================
// 等待服务就绪（健康检查 + 输出模式匹配）
// ============================================================
async function waitForServerReady(child, port, timeoutMs = 30000, usePipe = true) {
  // 后台模式（无 pipe）：通过 HTTP 健康检查 + 进程退出检测来判断就绪
  if (!usePipe) {
    log.info('后台模式：通过 HTTP 健康检查检测就绪...');
    return waitForReadyByHttp(child, port, timeoutMs);
  }

  // 前台/详细模式（有 pipe）：通过 stdout 模式匹配快速检测就绪
  const readyPatterns = ['API服务运行在', 'listening', 'Local:', 'Server listening'];
  let resolved = false;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({ ok: false, reason: `服务启动超时（${timeoutMs / 1000}秒未检测到就绪信号）` });
      }
    }, timeoutMs);

    // 通过 stdout 模式匹配
    const onData = (data) => {
      if (resolved) return;
      const output = data.toString().replace(/\x1b\[[0-9;]*m/g, '');
      // 快速失败检测
      if (output.includes('EADDRINUSE')) {
        resolved = true;
        clearTimeout(timer);
        resolve({ ok: false, reason: `端口 ${port} 被占用 (EADDRINUSE)` });
        return;
      }
      if (output.includes('MODULE_NOT_FOUND') || output.includes('Cannot find module')) {
        resolved = true;
        clearTimeout(timer);
        resolve({ ok: false, reason: '缺少依赖模块，请运行 npm install' });
        return;
      }
      if (output.includes('SyntaxError') && output.includes('import')) {
        resolved = true;
        clearTimeout(timer);
        resolve({ ok: false, reason: '模块语法错误，可能是 ESM/CJS 配置问题' });
        return;
      }
      // 就绪模式匹配
      if (readyPatterns.some(p => output.includes(p))) {
        resolved = true;
        clearTimeout(timer);
        resolve({ ok: true });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    // 进程退出
    child.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({ ok: false, reason: `进程意外退出 (code=${code})` });
      }
    });
    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({ ok: false, reason: '进程启动错误: ' + err.message });
      }
    });
  });
}

// ============================================================
// 后台模式就绪检测：HTTP 健康检查 + 进程退出监听
// ============================================================
async function waitForReadyByHttp(child, port, timeoutMs = 30000) {
  const healthUrl = `http://localhost:${port}/health`;
  const start = Date.now();
  let exited = false;
  let exitCode = null;

  // 监听子进程退出
  const exitHandler = (code) => {
    exited = true;
    exitCode = code;
  };
  child.on('exit', exitHandler);
  child.on('error', exitHandler);

  // 轮询健康检查
  while (Date.now() - start < timeoutMs) {
    if (exited) {
      child.removeListener('exit', exitHandler);
      child.removeListener('error', exitHandler);
      return { ok: false, reason: `进程意外退出 (code=${exitCode})` };
    }
    if (await httpHealthCheck(healthUrl, 2000)) {
      child.removeListener('exit', exitHandler);
      child.removeListener('error', exitHandler);
      return { ok: true };
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  child.removeListener('exit', exitHandler);
  child.removeListener('error', exitHandler);
  if (exited) {
    return { ok: false, reason: `进程意外退出 (code=${exitCode})` };
  }
  return { ok: false, reason: `服务启动超时（${timeoutMs / 1000}秒未通过健康检查）` };
}

// ============================================================
// HTTP 健康检查
// ============================================================
async function httpHealthCheck(url, timeout = 5000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch (_) {
    return false;
  }
}

async function waitForHttpHealthy(url, maxWait = 20000, interval = 1000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (await httpHealthCheck(url, 3000)) return true;
    await new Promise(r => setTimeout(r, interval));
  }
  return false;
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  const opts = parseArgs();

  if (opts.help) {
    showHelp();
    process.exit(0);
  }

  ensureLogDir();
  writeLog('INFO', '========== 独立后端服务器启动 ==========');

  // ------- Header -------
  console.log(`\n${colors.bright}🎵 音乐盒子 - 后端服务器启动器${colors.reset}`);
  console.log(`${colors.dim}  模式: ${opts.dev ? '开发 (--dev)' : '生产'}${colors.reset}`);
  if (opts.skipChecks) console.log(`${colors.dim}  跳过环境检查 (--skip-checks)${colors.reset}`);
  if (opts.foreground) console.log(`${colors.dim}  前台运行 (--foreground)${colors.reset}`);
  if (opts.verbose) console.log(`${colors.dim}  详细输出 (--verbose)${colors.reset}`);
  console.log('');

  // ------- Phase 0: 环境检查 -------
  if (!opts.skipChecks) {
    log.step('Phase 0: 环境依赖检查...');
    if (!checkNodeVersion()) process.exit(1);
    if (!checkServerDependencies()) process.exit(1);
    const mysqlOk = await checkMySQL();
    if (!mysqlOk) process.exit(1);
    await checkRedis(); // Redis 可选
    log.success('环境检查完成');
    console.log('');
  } else {
    log.warn('已跳过环境检查');
  }

  // ------- Phase 1: 配置环境变量 -------
  if (!configureEnvironment(opts)) process.exit(1);
  console.log('');

  // ------- Phase 2: Prisma Client -------
  if (!opts.skipChecks) {
    log.step('Phase 2: 检查 Prisma Client...');
    if (!generatePrisma()) {
      log.error('Prisma Client 生成失败，无法继续');
      process.exit(2);
    }
    console.log('');
  }

  // ------- Phase 3: 端口检查 -------
  const port = parseInt(process.env.PORT, 10);
  if (!opts.skipChecks) {
    log.step(`Phase 3: 检查端口 ${port}...`);
    if (!await ensurePortFree(port)) process.exit(3);
    console.log('');
  }

  // ------- Phase 4: 启动服务 -------
  log.step('Phase 4: 启动后端服务器进程...');
  const result = startServerProcess(opts);
  if (!result) process.exit(99);
  const { child, logStream, port: childPort, usePipe } = result;

  log.info(`API 服务器进程 PID: ${child.pid || '(未知)'}`);

  // 前台模式：注册信号处理器
  if (opts.foreground) {
    const shutdown = (signal) => {
      console.log(`\n${colors.yellow}收到 ${signal} 信号，正在停止服务器...${colors.reset}`);
      if (child.pid) {
        try {
          if (isWindows) {
            execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' });
          } else {
            process.kill(-child.pid, 'SIGTERM');
          }
        } catch (_) {
          try { child.kill('SIGTERM'); } catch (_) {}
        }
      }
      // 修复: logStream 可能为 null（虽然前台模式不会，但防御性编程）
      if (logStream) logStream.end();
      process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  // 等待就绪
  log.step('等待服务就绪...');
  // 修复: 传递 usePipe 参数，后台模式使用 HTTP 健康检查而非 stdout 模式匹配
  const ready = await waitForServerReady(child, port, 30000, usePipe);
  if (!ready.ok) {
    log.error(`服务启动失败: ${ready.reason} (E010)`);
    if (logStream) logStream.end();
    if (child.pid) {
      try {
        if (isWindows) execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' });
        else process.kill(-child.pid, 'SIGTERM');
      } catch (_) {}
    }
    process.exit(4);
  }

  log.success('服务已就绪（检测到启动信号）');

  // ------- Phase 5: 健康检查 -------
  log.step('Phase 5: HTTP 健康检查...');
  const healthUrl = `http://localhost:${port}/health`;
  log.info(`健康检查 URL: ${healthUrl}`);
  const healthy = await waitForHttpHealthy(healthUrl, 15000, 1000);
  if (!healthy) {
    log.warn('健康检查未通过（服务可能仍在初始化，但不影响后台启动）');
    log.warn(`可稍后手动验证: curl ${healthUrl}`);
  } else {
    log.success('健康检查通过 ✓');
  }
  console.log('');

  // ------- 状态总结 -------
  const separator = `${colors.dim}${'─'.repeat(60)}${colors.reset}`;
  log.plain(separator);
  log.plain(`${colors.bright}📊 启动状态总结${colors.reset}`);
  log.plain(separator);
  log.plain(`  ${colors.dim}服务:${colors.reset}      ${colors.green}API Server${colors.reset}`);
  log.plain(`  ${colors.dim}端口:${colors.reset}      ${colors.cyan}${port}${colors.reset}`);
  log.plain(`  ${colors.dim}PID:${colors.reset}       ${colors.cyan}${child.pid || '(未知)'}${colors.reset}`);
  log.plain(`  ${colors.dim}健康检查:${colors.reset}  ${healthy ? colors.green + '通过' : colors.yellow + '跳过/待验证'}${colors.reset}`);
  log.plain(`  ${colors.dim}访问地址:${colors.reset}  ${colors.cyan}${healthUrl}${colors.reset}`);
  log.plain(`  ${colors.dim}服务日志:${colors.reset}  ${colors.dim}${path.relative(ROOT_DIR, path.join(LOG_DIR, 'api-server.log'))}${colors.reset}`);
  log.plain(`  ${colors.dim}启动日志:${colors.reset}  ${colors.dim}${path.relative(ROOT_DIR, LOG_FILE)}${colors.reset}`);
  log.plain(separator);
  log.plain('');

  if (opts.foreground) {
    log.info('前台模式运行中，按 Ctrl+C 退出...');
    // 保持进程不退出
    return new Promise(() => {});
  } else {
    // 后台模式：分离子进程，让其在父进程退出后继续运行
    // 修复历史问题:
    //   1. libuv 断言失败 (Assertion failed: !(handle->flags & UV_HANDLE_CLOSING))
    //      原因: process.exit(0) 时 child 的 stdio pipe 和 logStream 处于半关闭状态
    //   2. 子进程随父进程退出而退出
    //      原因: pipe 在父进程退出时被关闭，子进程写入 stdout 收到 EPIPE
    // 最终方案: 后台模式使用文件描述符（非 pipe）+ detached: true + child.unref()
    //          子进程完全独立，父进程可直接退出
    /* [原代码保留 - 通过注释代替删除]
    child.unref();
    logStream.end();
    log.success(`✅ 后端服务器已成功启动（后台运行中）`);
    process.exit(0);
    */
    /* [中间修复保留 - 通过注释代替删除]
    // 清理所有 handle 后再退出，避免 libuv 断言失败
    try {
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      child.removeAllListeners();
    } catch (_) {}
    child.unref();
    let exited = false;
    const doExit = () => {
      if (exited) return;
      exited = true;
      try { log.success(`✅ 后端服务器已成功启动（后台运行中）`); } catch (_) {}
      setTimeout(() => process.exit(0), 100);
    };
    logStream.end(doExit);
    setTimeout(doExit, 500);
    */
    // 新逻辑: 后台模式无 pipe 无 logStream，child.unref() 已在 startServerProcess 中调用
    // 子进程通过文件描述符直接写入日志，detached: true 创建独立进程组
    // 父进程可直接退出，不影响子进程运行
    try { child.removeAllListeners(); } catch (_) {}
    log.success(`✅ 后端服务器已成功启动（后台运行中）`);
    // 短暂延迟确保日志输出完成，然后退出
    setTimeout(() => process.exit(0), 100);
  }
}

// 入口
main().catch(err => {
  log.error('启动脚本异常: ' + (err && err.stack ? err.stack : err));
  process.exit(99);
});
