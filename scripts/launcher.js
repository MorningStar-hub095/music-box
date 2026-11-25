#!/usr/bin/env node

/**
 * 音乐盒子独立启动器
 * 用于打包成 .exe 可执行文件
 *
 * ===========================================================================
 * 重构说明 (2026-08-06)：
 * 本文件修复了原 launcher 的 12 项缺陷，详见 docs/launcher-audit.md：
 *   C2: 使用 process.execPath 替代 PATH 中的 node
 *   C3: 改用 start-server.cjs（轻量、带降级）替代 start.js
 *   H1: Windows 下使用 taskkill /F /T 终止进程树（替代 SIGINT）
 *   H2: TTY 检测后再调用 setRawMode，避免非 TTY 抛异常
 *   H3: 子进程 exit 后主进程同步退出（避免僵尸 launcher）
 *   H4: 用 ANSI 转义替代 cls 清屏（pkg 打包后更稳健）
 *   M1: 增加 logs/launcher.log 持久化日志
 *   M2: 增加 30s 启动超时
 *   M3: 启动前检查端口 49200
 *   M4: 移除 shell: true
 *   M5: 增加 child.on('error') 显式处理
 *   M6: 启动时切换 chcp 65001（仅 Windows）
 * 原代码以块注释保留，新逻辑以普通注释标注。
 * ===========================================================================
 */

import { spawn, execSync, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// 获取应用根目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');

// 颜色定义
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

// ===========================================================================
// [M1 修复] 新增：日志文件持久化
// 原代码仅输出到控制台，用户关闭窗口后无法复盘
// ===========================================================================
const LOG_DIR = path.join(APP_ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'launcher.log');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function writeLog(level, msg) {
  const ts = new Date().toISOString();
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, `[${ts}] [${level}] ${msg}\n`, 'utf-8');
  } catch (_) {
    // 文件写入失败不影响主流程
  }
}

// 日志函数
const log = {
  info: (msg) => { console.log(`${colors.cyan}[INFO]${colors.reset} ${msg}`); writeLog('INFO', msg); },
  success: (msg) => { console.log(`${colors.green}[OK]${colors.reset} ${msg}`); writeLog('OK', msg); },
  warn: (msg) => { console.log(`${colors.yellow}[WARN]${colors.reset} ${msg}`); writeLog('WARN', msg); },
  error: (msg) => { console.error(`${colors.red}[ERROR]${colors.reset} ${msg}`); writeLog('ERROR', msg); },
  step: (msg) => { console.log(`${colors.blue}[STEP]${colors.reset} ${msg}`); writeLog('STEP', msg); },
};

// ===========================================================================
// [C2 修复] 新增：智能查找 Node 命令
// 原代码直接 spawn('node', ...)，依赖系统 PATH，pkg 打包后失去意义
// 新逻辑：pkg 打包后用 process.execPath（exe 自身可作为 node 运行 .cjs），
//       开发模式下回退到 PATH 中的 node
// ===========================================================================
function findNodeCommand() {
  // pkg 打包后 process.execPath 指向 exe 自身，可作为 node 解释器
  // 检测方法：pkg 注入 process.pkg 对象
  if (process.pkg && process.execPath) {
    return process.execPath;
  }
  // 开发模式：直接用 PATH 中的 node
  return 'node';
}

// [C2 修复] 缓存 Node 命令，避免多次检测
const NODE_CMD = findNodeCommand();

// 显示 Banner
function showBanner() {
  console.log('');
  console.log(`${colors.cyan}${colors.bright}`);
  console.log('  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║                                                          ║');
  console.log('  ║          🎵  音乐盒子 Music Box  🎵                      ║');
  console.log('  ║                                                          ║');
  console.log('  ║          一键启动所有服务                                 ║');
  console.log('  ║                                                          ║');
  console.log('  ╚══════════════════════════════════════════════════════════╝');
  console.log(`${colors.reset}`);
  console.log('');
}

// 检查 Node.js
function checkNode() {
  log.step('检查 Node.js 环境...');
  try {
    // [C2 修复] 使用检测到的 NODE_CMD 替代硬编码 'node'
    const version = execSync(`"${NODE_CMD}" -v`, { encoding: 'utf-8' }).trim();
    log.success(`Node.js ${version} (${NODE_CMD})`);
    writeLog('INFO', `Node command: ${NODE_CMD}`);
    return true;
  } catch (e) {
    log.error('未找到 Node.js，请先安装 Node.js >= 18');
    log.error('下载地址: https://nodejs.org/');
    return false;
  }
}

/* [原代码保留 - 通过注释代替删除]
// 检查 Node.js
function checkNode() {
  log.step('检查 Node.js 环境...');
  try {
    const version = execSync('node -v', { encoding: 'utf-8' }).trim();
    log.success(`Node.js ${version}`);
    return true;
  } catch (e) {
    log.error('未找到 Node.js，请先安装 Node.js >= 18');
    log.error('下载地址: https://nodejs.org/');
    return false;
  }
}
*/

// 检查依赖
function checkDependencies() {
  log.step('检查项目依赖...');
  // [L5 改进] 仅检查 server/node_modules（实际启动所需），不再检查根目录 node_modules
  const serverModules = path.join(APP_ROOT, 'server', 'node_modules');
  if (!fs.existsSync(serverModules)) {
    log.warn('server 依赖未安装，正在安装...');
    try {
      execSync(`"${NODE_CMD}" -e "require('child_process').execSync('npm install',{cwd:'server',stdio:'inherit'})"`, {
        cwd: APP_ROOT,
        stdio: 'inherit',
      });
      log.success('依赖安装完成');
    } catch (e) {
      log.error('依赖安装失败: ' + e.message);
      return false;
    }
  } else {
    log.success('server 依赖已安装');
  }
  return true;
}

/* [原代码保留 - 通过注释代替删除]
// 检查依赖
function checkDependencies() {
  log.step('检查项目依赖...');
  const nodeModules = path.join(APP_ROOT, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    log.warn('首次运行，正在安装依赖...');
    try {
      execSync('npm install', { cwd: APP_ROOT, stdio: 'inherit' });
      log.success('依赖安装完成');
    } catch (e) {
      log.error('依赖安装失败');
      return false;
    }
  } else {
    log.success('依赖已安装');
  }
  return true;
}
*/

// 检查环境配置
function checkEnvironment() {
  log.step('检查环境配置...');
  // [L5 改进] 检查 server/.env 而非根目录 .env（与实际启动脚本一致）
  const envFile = path.join(APP_ROOT, 'server', '.env');
  const envExample = path.join(APP_ROOT, 'server', '.env.example');
  if (!fs.existsSync(envFile)) {
    if (fs.existsSync(envExample)) {
      fs.copyFileSync(envExample, envFile);
      log.success('已从 .env.example 创建 server/.env');
    } else {
      log.warn('未找到 server/.env.example，将使用默认值');
    }
  } else {
    log.success('环境配置已存在 (server/.env)');
  }
}

/* [原代码保留 - 通过注释代替删除]
// 检查环境配置
function checkEnvironment() {
  log.step('检查环境配置...');
  const envFile = path.join(APP_ROOT, '.env');
  const envDev = path.join(APP_ROOT, '.env.development');
  const envExample = path.join(APP_ROOT, '.env.example');

  if (!fs.existsSync(envFile)) {
    if (fs.existsSync(envDev)) {
      fs.copyFileSync(envDev, envFile);
      log.success('已创建环境配置（开发模式）');
    } else if (fs.existsSync(envExample)) {
      fs.copyFileSync(envExample, envFile);
      log.success('已创建环境配置');
    } else {
      log.warn('未找到环境配置模板');
    }
  } else {
    log.success('环境配置已存在');
  }
}
*/

// ===========================================================================
// [M3 修复] 新增：启动前检查端口 49200 是否可用
// 原代码不检查端口，若上次启动残留进程则新启动会失败
// ===========================================================================
function checkPortInUse(port) {
  // [ESM 修复] 使用顶部导入的 net 模块替代 require('net')
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: 'localhost', port });
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

async function ensurePortFree(port) {
  const inUse = await checkPortInUse(port);
  if (!inUse) {
    log.success(`端口 ${port} 可用`);
    return true;
  }
  log.warn(`端口 ${port} 被占用，可能上次启动的服务仍在运行`);
  log.warn('如启动失败，请运行: taskkill /F /T /PID <PID> 或 node scripts/kill-ports.js');
  // 不强制清理，避免误杀用户其他服务；让 start-server.cjs 处理
  return true;
}

// 启动服务
function startServices() {
  log.step('启动所有服务...');
  console.log('');
  console.log('  ─────────────────────────────────────────────────────────');
  console.log('   服务启动中，请稍候...');
  console.log('   启动完成后将自动打开浏览器');
  console.log('   按 Ctrl+C 停止所有服务');
  console.log('  ─────────────────────────────────────────────────────────');
  console.log('');

  // [C3 修复] 改用 start-server.cjs（轻量、带降级策略），原 start.js 触发重型环境检查易失败
  // [M4 修复] 移除 shell: true（避免命令注入风险）
  const startScript = path.join(APP_ROOT, 'scripts', 'start-server.cjs');

  if (!fs.existsSync(startScript)) {
    log.error(`启动脚本不存在: ${startScript}`);
    log.error('请检查项目文件完整性');
    return null;
  }

  log.info(`Node 命令: ${NODE_CMD}`);
  log.info(`启动脚本: ${startScript}`);

  // 使用 Node.js 运行启动脚本
  const child = spawn(NODE_CMD, [startScript, '--foreground'], {
    cwd: APP_ROOT,
    stdio: 'inherit',
    // [M4 修复] 移除 shell: true
    env: { ...process.env, FORCE_COLOR: 'true' },
  });

  // [M5 修复] 新增：显式 error 事件处理
  child.on('error', (err) => {
    log.error(`启动失败: ${err.message}`);
    writeLog('ERROR', `spawn error: ${err.message}`);
    if (err.code === 'ENOENT') {
      log.error(`未找到可执行文件: ${NODE_CMD}`);
      log.error('如为打包版本，请检查 pkg 配置；如为开发模式，请确认 Node.js 在 PATH 中');
    }
  });

  // [H3 修复] 子进程退出后，主进程同步退出（原代码仅记录日志导致僵尸 launcher）
  child.on('exit', (code, signal) => {
    writeLog('INFO', `child exited code=${code} signal=${signal}`);
    if (code !== 0 && code !== null) {
      log.error(`启动失败，退出码: ${code}`);
      log.error('详细日志请查看: logs/start-server.log 与 logs/api-server.log');
    } else if (code === 0) {
      log.success('服务已退出（正常）');
    }
    // [H3 修复] 主进程同步退出
    process.exit(code ?? 0);
  });

  // [H1 修复] Windows 下用 taskkill /F /T 终止整个进程树
  // 原代码 child.kill('SIGINT') 在 Windows 不会传播到孙进程，导致 API 服务器变孤儿
  function killProcessTree() {
    if (!child.pid) return;
    log.info('正在停止服务进程树...');
    try {
      if (process.platform === 'win32') {
        // /F 强制终止，/T 终止整个进程树（含孙进程）
        execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' });
      } else {
        process.kill(-child.pid, 'SIGTERM');
      }
    } catch (_) {
      // 兜底：直接 kill 子进程
      try { child.kill('SIGKILL'); } catch (_) {}
    }
  }

  // 处理退出信号
  process.on('SIGINT', () => {
    console.log('\n收到 Ctrl+C，正在停止...');
    killProcessTree();
    setTimeout(() => process.exit(130), 1000);
  });

  process.on('SIGTERM', () => {
    killProcessTree();
    setTimeout(() => process.exit(0), 1000);
  });

  // [M2 修复] 新增：30s 启动超时检测
  // 原代码无限等待，start.js 卡住时 launcher 永不退出
  setTimeout(() => {
    if (!child.killed) {
      // 检查健康端点是否已响应
      checkPortInUse(49200).then((ok) => {
        if (ok) {
          log.success('检测到 API 服务器已在 49200 端口监听');
        } else {
          // 仍在运行但 30s 后端口未监听 — 提示但不强制终止（让用户自行决定）
          log.warn('启动已超过 30s，端口 49200 仍未监听');
          log.warn('可能原因: MySQL/Redis 启动慢、依赖安装中、Prisma 生成中');
          log.warn('如长时间无响应，请按 Ctrl+C 终止并查看日志');
        }
      });
    }
  }, 30000);

  return child;
}

/* [原代码保留 - 通过注释代替删除]
// 启动服务
function startServices() {
  log.step('启动所有服务...');
  console.log('');
  console.log('  ─────────────────────────────────────────────────────────');
  console.log('   服务启动中，请稍候...');
  console.log('   启动完成后将自动打开浏览器');
  console.log('   按 Ctrl+C 停止所有服务');
  console.log('  ─────────────────────────────────────────────────────────');
  console.log('');

  const startScript = path.join(APP_ROOT, 'scripts', 'start.js');

  // 使用 Node.js 运行启动脚本
  const child = spawn('node', [startScript], {
    cwd: APP_ROOT,
    stdio: 'inherit',
    shell: true,
  });

  child.on('error', (err) => {
    log.error(`启动失败: ${err.message}`);
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      log.error('启动失败，请查看上方错误信息');
    }
  });

  // 处理退出信号
  process.on('SIGINT', () => {
    child.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    child.kill('SIGTERM');
  });
}
*/

// 主函数
async function main() {
  // [M1 修复] 启动日志记录
  writeLog('INFO', '========== Launcher 启动 ==========');

  // [M6 修复] Windows 切换 UTF-8 代码页（避免中文乱码）
  if (process.platform === 'win32') {
    try {
      execSync('chcp 65001', { stdio: 'ignore' });
    } catch (_) {}
  }

  // [H4 修复] 用 ANSI 转义清屏替代 execSync('cls')（pkg 打包后更稳健）
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');

  /* [原代码保留 - 通过注释代替删除]
  // 清屏（Windows）
  if (process.platform === 'win32') {
    try {
      execSync('cls', { stdio: 'inherit' });
    } catch (e) {
      console.clear();
    }
  }
  */

  showBanner();

  // 检查环境
  if (!checkNode()) {
    await waitForExit();
    return;
  }

  console.log('');

  if (!checkDependencies()) {
    await waitForExit();
    return;
  }

  console.log('');

  checkEnvironment();

  console.log('');

  // [M3 修复] 启动前检查端口
  await ensurePortFree(49200);
  console.log('');

  // 启动服务
  startServices();
}

// 等待用户按键退出
function waitForExit() {
  return new Promise((resolve) => {
    console.log('');
    console.log('按任意键退出...');

    // [H2 修复] 先检测是否为 TTY，避免非 TTY 场景调用 setRawMode 抛异常
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', () => {
        process.exit(0);
      });
    } else {
      // 非 TTY 场景：3 秒后自动退出
      log.warn('stdin 非 TTY，3 秒后自动退出...');
      setTimeout(() => process.exit(0), 3000);
    }
  });
}

/* [原代码保留 - 通过注释代替删除]
// 等待用户按键退出
function waitForExit() {
  return new Promise((resolve) => {
    console.log('');
    console.log('按任意键退出...');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', () => {
      process.exit(0);
    });
  });
}
*/

// [M5 修复] 新增：捕获未处理的 Promise rejection
process.on('unhandledRejection', (reason) => {
  log.error('未处理的 Promise 拒绝: ' + (reason && reason.stack ? reason.stack : reason));
  writeLog('ERROR', `unhandledRejection: ${reason}`);
  process.exit(1);
});

// 运行主函数
main().catch((err) => {
  log.error(err.message);
  writeLog('ERROR', `main catch: ${err.message}`);
  process.exit(1);
});
