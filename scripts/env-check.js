/**
 * 共享环境校验模块
 * 提供颜色、日志、服务配置、端口探测、依赖检查等功能
 * 供 start.js / setup.js / health.js 等脚本共用
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import net from 'net';
import fs from 'fs';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.join(__dirname, '..');

const LOG_DIR = path.join(ROOT_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'startup.log');

// ============================================================
// 颜色配置
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
    // 文件写入失败不影响控制台输出
  }
}

export const log = {
  info: (msg) => {
    console.log(`${colors.cyan}[INFO]${colors.reset} ${msg}`);
    writeLog('INFO', msg);
  },
  success: (msg) => {
    console.log(`${colors.green}[✓]${colors.reset} ${msg}`);
    writeLog('OK', msg);
  },
  warn: (msg) => {
    console.log(`${colors.yellow}[!]${colors.reset} ${msg}`);
    writeLog('WARN', msg);
  },
  error: (msg) => {
    console.log(`${colors.red}[✗]${colors.reset} ${msg}`);
    writeLog('ERROR', msg);
  },
  step: (msg) => {
    console.log(`${colors.blue}[→]${colors.reset} ${msg}`);
    writeLog('STEP', msg);
  },
  plain: (msg) => {
    console.log(msg);
    writeLog('INFO', msg.replace(/\x1b\[[0-9;]*m/g, ''));
  },
};

// ============================================================
// 服务配置
// ============================================================
export const serviceConfig = {
  api: {
    name: 'API Server',
    port: parseInt(process.env.API_PORT || process.env.PORT || '49200', 10),
    dir: path.join(ROOT_DIR, 'server'),
    command: 'npm',
    args: ['run', 'dev'],
    healthUrl: `http://localhost:${process.env.API_PORT || process.env.PORT || '49200'}/health`,
    healthTimeout: 120000,
    color: colors.blue,
    icon: '🔌',
    readyPatterns: ['API服务运行在'],
    required: true,
  },
  web: {
    name: 'Web Player',
    port: parseInt(process.env.WEB_PORT || '49201', 10),
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
    port: parseInt(process.env.ADMIN_PORT || '49202', 10),
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
    port: parseInt(process.env.BROWSE_PORT || '49203', 10),
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
// Node.js 版本检查（要求 >= 18）
// ============================================================
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

// ============================================================
// TCP 端口探测
// ============================================================
export function checkPort(port, host = 'localhost') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

// ============================================================
// 等待端口释放（主动轮询替代盲等）
// ============================================================
export async function waitForPortFree(port, maxWait = 10000, interval = 500) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const inUse = await checkPort(port);
    if (!inUse) return true;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  return false;
}

// ============================================================
// MySQL 连接检查（端口 3306）
// ============================================================
export async function checkMySQL() {
  log.step('检查 MySQL 连接...');
  const available = await checkPort(3306);
  if (available) {
    log.success('MySQL 连接正常 (端口 3306)');
    return true;
  }
  log.error('MySQL 连接失败 (端口 3306 不可达) (E002)');
  log.warn('请确保 MySQL 服务已启动');
  return false;
}

// ============================================================
// Redis 连接检查（端口 6379）
// ============================================================
export async function checkRedis() {
  log.step('检查 Redis 连接...');
  try {
    const available = await new Promise((resolve) => {
      const socket = net.createConnection({ host: 'localhost', port: 6379 });
      socket.setTimeout(3000);
      socket.once('connect', () => {
        socket.write('PING\r\n');
      });
      socket.once('data', (data) => {
        socket.destroy();
        resolve(data.toString().includes('PONG') || data.toString().includes('+'));
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    });

    if (available) {
      log.success('Redis 连接正常');
      return true;
    }
    log.warn('Redis 连接失败，缓存功能可能不可用 (E003)');
    return false;
  } catch (_) {
    log.warn('Redis 连接失败，缓存功能可能不可用 (E003)');
    return false;
  }
}

// ============================================================
// 从 netstat 地址中精确提取端口号（避免 :3000 误匹配 :30000）
// ============================================================
function extractPortFromAddr(addr) {
  const m = addr.match(/:(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

// ============================================================
// 端口冲突检测（返回占用进程 PID 信息）
// 仅匹配 LISTENING 状态 + 精确端口号
// ============================================================
export async function checkPortConflict(port) {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(`netstat -ano | findstr ":${port}"`, { timeout: 5000 });
      const lines = stdout.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const localAddr = parts[1];
        const state = parts[3];
        const pid = parts[4];
        // 仅匹配 LISTENING 状态 + 精确端口号
        if (state !== 'LISTENING') continue;
        if (extractPortFromAddr(localAddr) !== port) continue;
        if (!pid || pid === '0') continue;
        let processName = '';
        try {
          const { stdout: taskOut } = await execAsync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { timeout: 5000 });
          const match = taskOut.trim().match(/^"([^"]+)"/);
          if (match) processName = match[1];
        } catch (_) {}
        log.warn(`端口 ${port} 被进程占用 (PID: ${pid}) (E004)`);
        return { port, pid, processName };
      }
    } else {
      const { stdout } = await execAsync(`lsof -i:${port} -t`, { timeout: 5000 });
      const pids = stdout.trim().split('\n').filter(Boolean);
      if (pids.length > 0) {
        const pid = pids[0];
        let processName = '';
        try {
          const { stdout: cmdOut } = await execAsync(`ps -p ${pid} -o comm=`, { timeout: 5000 });
          processName = cmdOut.trim();
        } catch (_) {}
        log.warn(`端口 ${port} 被进程占用 (PID: ${pid}) (E004)`);
        return { port, pid, processName };
      }
    }
    return null;
  } catch (_) {
    return null;
  }
}

// ============================================================
// 依赖检查（node_modules 是否存在）
// ============================================================
export function checkDependencies() {
  const dirs = ['server', 'web', 'web/admin', 'web/browse'];
  let ok = true;

  for (const dir of dirs) {
    const modulesPath = path.join(ROOT_DIR, dir, 'node_modules');
    if (!fs.existsSync(modulesPath)) {
      log.error(`${dir}/node_modules 不存在，请先运行 npm run install:all (E005)`);
      ok = false;
    }
  }
  if (ok) {
    log.success('依赖检查通过');
  }
  return ok;
}

// ============================================================
// Prisma Client 是否已生成
// ============================================================
export function checkPrismaClient() {
  const prismaClientPath = path.join(
    ROOT_DIR,
    'server',
    'node_modules',
    '.prisma',
    'client',
    'query_engine-windows.dll.node'
  );
  if (fs.existsSync(prismaClientPath)) {
    log.success('Prisma Client 已存在');
    return true;
  }
  log.warn('Prisma Client 未生成');
  return false;
}

// ============================================================
// HTTP 健康检查
// ============================================================
export async function httpHealthCheck(url, timeout = 5000) {
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

// ============================================================
// 终止端口上的进程（精确端口匹配 + 进程树终止）
// ============================================================
export async function killPortProcess(port) {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(`netstat -ano | findstr ":${port}"`);
      const lines = stdout.trim().split('\n').filter(Boolean);
      const killedPids = new Set();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const localAddr = parts[1];
        const state = parts[3];
        const pid = parts[4];
        // 仅终止 LISTENING 状态 + 精确端口匹配的进程
        if (state !== 'LISTENING') continue;
        if (extractPortFromAddr(localAddr) !== port) continue;
        if (pid && pid !== '0' && !killedPids.has(pid)) {
          killedPids.add(pid);
          // /T 杀进程树（含子进程），/F 强制终止
          await execAsync(`taskkill /F /T /PID ${pid}`).catch(() => {});
        }
      }
    } else {
      await execAsync(`lsof -ti:${port} | xargs kill -9`).catch(() => {});
    }
    return true;
  } catch (_) {
    return false;
  }
}

// ============================================================
// 根据启动模式获取服务列表
// ============================================================
export function getServicesToStart(mode = 'all') {
  switch (mode) {
    case 'api-only':
      return ['api'];
    case 'dev':
      return ['api', 'web', 'admin'];
    case 'all':
    default:
      return ['api', 'web', 'admin', 'browse'];
  }
}
