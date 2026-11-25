#!/usr/bin/env node
/**
 * ============================================================
 *  音乐盒子（Music Box）启动脚本
 * ============================================================
 *
 *  用法:
 *    node scripts/startup.js              # 启动全部服务（生产模式）
 *    node scripts/startup.js --dev        # 开发模式（启用热重载）
 *    node scripts/startup.js --skip-build # 跳过构建，直接启动
 *    node scripts/startup.js --api-only   # 仅启动API服务
 *    node scripts/startup.js --help       # 显示帮助信息
 *
 *  功能:
 *    1. 环境检查（Node版本、MySQL连接、端口可用性）
 *    2. 依赖验证（node_modules、Prisma Client、构建产物）
 *    3. 自动构建（tsc编译后端、Vite打包前端）
 *    4. 按依赖顺序启动服务（API → Web → Admin → Browse）
 *    5. 健康检查验证（HTTP GET /api/health）
 *    6. 彩色日志输出 + 故障排查提示
 *
 * ============================================================
 */

const { spawn, execSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ── ANSI 颜色 ──────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgBlue: '\x1b[44m',
};

// ── 项目路径 ──────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');
const WEB_DIR = path.join(ROOT, 'web');

// ── 服务配置 ──────────────────────────────────────────────
const SERVICES = [
  { name: 'API Server',  port: 49200, dir: SERVER_DIR, cmd: 'node', args: ['dist/index.js'], healthPath: '/api/health' },
  { name: 'Web Player',  port: 49201, dir: WEB_DIR,    cmd: 'npx',  args: ['vite', '--port', '49201', '--host'], healthPath: '/' },
  { name: 'Admin',        port: 49202, dir: path.join(WEB_DIR, 'admin'),  cmd: 'npx', args: ['vite', '--port', '49202', '--host'], healthPath: '/' },
  { name: 'Browse',       port: 49203, dir: path.join(WEB_DIR, 'browse'), cmd: 'npx', args: ['vite', '--port', '49203', '--host'], healthPath: '/' },
];

// ── 解析命令行参数 ────────────────────────────────────────
const args = process.argv.slice(2);
const isDev = args.includes('--dev');
const skipBuild = args.includes('--skip-build');
const apiOnly = args.includes('--api-only');
const showHelp = args.includes('--help') || args.includes('-h');

if (showHelp) {
  console.log(`
${C.cyan}${C.bold}╔══════════════════════════════════════════════════════════╗
║           音乐盒子（Music Box）启动脚本 v1.1.0          ║
╚══════════════════════════════════════════════════════════╝${C.reset}

${C.bold}用法:${C.reset}
  node scripts/startup.js [选项]

${C.bold}选项:${C.reset}
  ${C.green}--dev${C.reset}        开发模式（启用热重载，Vite dev server）
  ${C.green}--skip-build${C.reset} 跳过构建阶段，直接启动服务
  ${C.green}--api-only${C.reset}   仅启动API服务（端口 49200）
  ${C.green}--help${C.reset}       显示此帮助信息

${C.bold}服务端口:${C.reset}
  ${C.cyan}API Server${C.reset}   49200  后端API服务
  ${C.cyan}Web Player${C.reset}   49201  前端播放器
  ${C.cyan}Admin${C.reset}        49202  管理后台
  ${C.cyan}Browse${C.reset}       49203  浏览页面

${C.bold}快捷命令:${C.reset}
  npm run start        启动全部服务
  npm run start:dev    开发模式
  npm run stop         停止全部服务
  npm run restart      重启
  npm run health       健康检查
`);
  process.exit(0);
}

// ── 日志工具 ──────────────────────────────────────────────
const log = {
  info: (msg) => console.log(`${C.cyan}[INFO]${C.reset}  ${msg}`),
  ok: (msg) => console.log(`${C.green}[OK]${C.reset}    ${msg}`),
  warn: (msg) => console.log(`${C.yellow}[WARN]${C.reset}  ${msg}`),
  err: (msg) => console.log(`${C.red}[ERR]${C.reset}   ${msg}`),
  step: (msg) => console.log(`${C.blue}${C.bold}[→]${C.reset} ${msg}`),
  phase: (msg) => console.log(`\n${C.magenta}${C.bold}━━━ ${msg} ━━━${C.reset}`),
  divider: () => console.log(`${C.dim}${'─'.repeat(56)}${C.reset}`),
};

// ── 计时器 ────────────────────────────────────────────────
class Timer {
  constructor() { this.starts = new Map(); this.results = []; }
  start(name) { this.starts.set(name, Date.now()); }
  stop(name) {
    const ms = Date.now() - (this.starts.get(name) || Date.now());
    this.results.push({ name, ms });
    return ms;
  }
  report() {
    log.divider();
    log.info(`${C.bold}性能报告${C.reset}`);
    log.divider();
    for (const r of this.results) {
      const sec = (r.ms / 1000).toFixed(2);
      console.log(`  ${r.name.padEnd(30)} ${sec}s`);
    }
    const total = this.results.reduce((s, r) => s + r.ms, 0);
    log.divider();
    console.log(`  ${'总计'.padEnd(28)} ${(total / 1000).toFixed(2)}s`);
  }
}

// ── 工具函数 ──────────────────────────────────────────────

/** TCP 端口检查 */
function checkPort(port, host = 'localhost') {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(2000);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => { sock.destroy(); resolve(false); });
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.connect(port, host);
  });
}

/** HTTP 健康检查 */
function httpGet(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (d) => body += d);
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, body }));
    });
    req.on('error', () => resolve({ ok: false }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
  });
}

/** 等待端口可用 */
async function waitForPort(port, timeoutMs = 30000, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkPort(port)) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

/** 运行命令（同步，有输出） */
function runCmd(cmd, cwd, label) {
  log.step(`${label}...`);
  try {
    execSync(cmd, { cwd, stdio: 'inherit', timeout: 120000 });
    return true;
  } catch (e) {
    log.err(`${label} 失败: ${e.message}`);
    return false;
  }
}

/** 目录存在检查 */
function dirExists(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function fileExists(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }

// ── 子进程管理 ────────────────────────────────────────────
const children = [];

function spawnService(svc) {
  const child = spawn(svc.cmd, svc.args, {
    cwd: svc.dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    windowsHide: true,
    env: { ...process.env, NODE_ENV: isDev ? 'development' : 'production' },
  });
  child._svcName = svc.name;
  child._svcPort = svc.port;
  children.push(child);

  child.stdout.on('data', (d) => {
    const lines = d.toString().trim().split('\n');
    for (const line of lines) {
      if (line.trim()) console.log(`${C.dim}[${svc.name}]${C.reset} ${line}`);
    }
  });
  child.stderr.on('data', (d) => {
    const lines = d.toString().trim().split('\n');
    for (const line of lines) {
      if (line.trim()) console.log(`${C.dim}[${svc.name}]${C.reset} ${line}`);
    }
  });
  child.on('exit', (code) => {
    log.warn(`${svc.name} 已退出 (code=${code})`);
    const idx = children.indexOf(child);
    if (idx >= 0) children.splice(idx, 1);
  });

  return child;
}

/** 停止所有子进程 */
function stopAll() {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch {}
  }
}

// ── 主流程 ────────────────────────────────────────────────
async function main() {
  const timer = new Timer();
  const startTime = Date.now();

  console.log(`
${C.cyan}${C.bold}╔══════════════════════════════════════════════════════════╗
║              🎵 音乐盒子启动器 v1.1.0                   ║
╠══════════════════════════════════════════════════════════╣
║  模式: ${isDev ? '开发' : '生产'}${' '.repeat(48)}║
╚══════════════════════════════════════════════════════════╝${C.reset}
`);

  // ──────────────────────────────────────────────
  //  Phase 1: 环境检查
  // ──────────────────────────────────────────────
  log.phase('Phase 1: 环境检查');
  timer.start('环境检查');

  // 1.1 Node.js 版本
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1), 10);
  if (nodeMajor < 18) {
    log.err(`Node.js 版本过低: ${nodeVersion}（需要 >= 18.0）`);
    log.info('请访问 https://nodejs.org/ 下载最新 LTS 版本');
    process.exit(1);
  }
  log.ok(`Node.js 版本: ${nodeVersion}`);

  // 1.2 .env 文件
  if (!fileExists(path.join(ROOT, '.env'))) {
    log.warn('.env 文件不存在，将使用默认配置');
    log.info('建议复制 .env.example 为 .env 并配置数据库连接');
  } else {
    log.ok('.env 文件存在');
  }

  // 1.3 MySQL 连接
  log.step('检查 MySQL 连接...');
  const mysqlUp = await checkPort(3306);
  if (!mysqlUp) {
    log.err('MySQL 未运行（端口 3306 无法连接）');
    log.info('故障排查:');
    log.info('  1. 确认 MySQL 服务已启动');
    log.info('  2. 检查端口: netstat -ano | findstr :3306');
    log.info('  3. Windows: services.msc → MySQL80 → 启动');
    log.info('  4. Docker: docker-compose up -d mysql');
    process.exit(1);
  }
  log.ok('MySQL 连接正常 (端口 3306)');

  // 1.4 端口可用性
  const targetServices = apiOnly ? SERVICES.filter(s => s.port === 49200) : SERVICES;
  for (const svc of targetServices) {
    const inUse = await checkPort(svc.port);
    if (inUse) {
      log.warn(`端口 ${svc.port} (${svc.name}) 已被占用`);
      log.info('尝试自动释放端口...');
      try {
        if (process.platform === 'win32') {
          const result = execSync(`netstat -ano | findstr :${svc.port} | findstr LISTENING`, { encoding: 'utf8' }).trim();
          if (result) {
            const pid = result.split(/\s+/).pop();
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
            log.ok(`已释放端口 ${svc.port} (PID: ${pid})`);
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      } catch {
        log.err(`无法自动释放端口 ${svc.port}`);
        log.info('请手动停止占用该端口的进程:');
        log.info(`  Windows: netstat -ano | findstr :${svc.port}`);
        log.info(`  然后: taskkill /F /PID <PID>`);
        process.exit(1);
      }
    } else {
      log.ok(`端口 ${svc.port} (${svc.name}) 可用`);
    }
  }

  // 1.5 依赖目录
  log.step('检查依赖目录...');
  const serverNM = dirExists(path.join(SERVER_DIR, 'node_modules'));
  const webNM = dirExists(path.join(WEB_DIR, 'node_modules'));
  if (!serverNM || !webNM) {
    log.warn('部分 node_modules 缺失，将自动安装依赖');
    if (!serverNM) {
      if (!runCmd('npm install', SERVER_DIR, '安装后端依赖')) process.exit(1);
    }
    if (!webNM) {
      if (!runCmd('npm install', WEB_DIR, '安装前端依赖')) process.exit(1);
    }
  } else {
    log.ok('依赖目录完整');
  }

  timer.stop('环境检查');

  // ──────────────────────────────────────────────
  //  Phase 2: 依赖验证
  // ──────────────────────────────────────────────
  log.phase('Phase 2: 依赖验证');
  timer.start('依赖验证');

  // 2.1 Prisma Client
  const prismaClient = path.join(SERVER_DIR, 'node_modules', '.prisma', 'client');
  if (!dirExists(prismaClient)) {
    if (!runCmd('npx prisma generate', SERVER_DIR, '生成 Prisma Client')) process.exit(1);
  } else {
    log.ok('Prisma Client 已就绪');
  }

  // 2.2 后端构建产物
  const serverDist = dirExists(path.join(SERVER_DIR, 'dist'));
  const webDist = dirExists(path.join(WEB_DIR, 'dist'));

  if (!skipBuild) {
    if (!serverDist) log.info('后端未构建，将在构建阶段编译');
    if (!webDist && !apiOnly) log.info('前端未构建，将在构建阶段编译');
  }

  timer.stop('依赖验证');

  // ──────────────────────────────────────────────
  //  Phase 3: 构建
  // ──────────────────────────────────────────────
  if (!skipBuild) {
    log.phase('Phase 3: 构建');
    timer.start('构建');

    // 3.1 编译后端
    if (!serverDist || !skipBuild) {
      if (!runCmd('npm run build', SERVER_DIR, '编译后端 (tsc)')) {
        log.err('后端编译失败');
        log.info('故障排查:');
        log.info('  1. 检查 TypeScript 错误: cd server && npx tsc --noEmit');
        log.info('  2. 检查 Prisma: cd server && npx prisma generate');
        log.info('  3. 清理重编译: cd server && rm -rf dist && npm run build');
        process.exit(1);
      }
      log.ok('后端编译完成');
    }

    // 3.2 编译前端（仅非 api-only 模式）
    if (!apiOnly && (!webDist || !skipBuild)) {
      if (!runCmd('npm run build', WEB_DIR, '编译前端 (Vite)')) {
        log.err('前端编译失败');
        log.info('故障排查:');
        log.info('  1. 检查类型错误: cd web && npx tsc --noEmit');
        log.info('  2. 清理缓存: cd web && rm -rf node_modules/.vite dist');
        log.info('  3. 重新安装: cd web && npm install && npm run build');
        process.exit(1);
      }
      log.ok('前端编译完成');
    }

    timer.stop('构建');
  } else {
    log.phase('Phase 3: 构建（已跳过）');
    if (!serverDist) {
      log.err('后端未构建且 --skip-build，无法启动');
      process.exit(1);
    }
  }

  // ──────────────────────────────────────────────
  //  Phase 4: 启动服务
  // ──────────────────────────────────────────────
  log.phase('Phase 4: 启动服务');
  timer.start('启动服务');

  for (const svc of targetServices) {
    log.step(`启动 ${svc.name} (端口 ${svc.port})...`);

    // API Server 使用 node dist/index.js，其他使用 vite dev
    if (svc.port === 49200) {
      // API Server: 使用编译后的 dist/index.js
      spawnService({ ...svc, cmd: 'node', args: ['dist/index.js'] });
    } else if (isDev) {
      // 开发模式: vite dev server
      spawnService(svc);
    } else {
      // 生产模式: 使用已构建的静态文件，通过 API Server 的静态文件服务
      log.info(`${svc.name}: 生产模式下通过 API Server (49200) 提供静态文件`);
      continue;
    }

    // 等待服务启动
    const ready = await waitForPort(svc.port, 30000);
    if (ready) {
      log.ok(`${svc.name} 已启动 → http://localhost:${svc.port}`);
    } else {
      log.warn(`${svc.name} 启动超时（端口 ${svc.port} 未就绪）`);
      log.info('服务可能仍在初始化，请稍后手动检查');
    }
  }

  timer.stop('启动服务');

  // ──────────────────────────────────────────────
  //  Phase 5: 健康检查
  // ──────────────────────────────────────────────
  log.phase('Phase 5: 健康检查');
  timer.start('健康检查');

  // 等待 API Server 完全就绪
  await new Promise(r => setTimeout(r, 3000));
  const health = await httpGet(`http://localhost:49200/api/health`);
  if (health.ok) {
    log.ok(`API Server 健康检查通过 (HTTP ${health.status})`);
    try {
      const data = JSON.parse(health.body);
      if (data.uptime) log.info(`运行时间: ${Math.round(data.uptime)}秒`);
      if (data.memory) log.info(`内存使用: ${Math.round(data.memory.heapUsed / 1024 / 1024)}MB`);
    } catch {}
  } else {
    log.warn('API Server 健康检查未通过，服务可能仍在启动中');
  }

  timer.stop('健康检查');

  // ──────────────────────────────────────────────
  //  完成
  // ──────────────────────────────────────────────
  timer.report();

  console.log(`
${C.green}${C.bold}╔══════════════════════════════════════════════════════════╗
║                   启动完成！                             ║
╚══════════════════════════════════════════════════════════╝${C.reset}

${C.bold}访问地址:${C.reset}
  ${C.cyan}API Server${C.reset}   http://localhost:49200
  ${C.cyan}Web Player${C.reset}   http://localhost:49201
  ${C.cyan}Admin${C.reset}        http://localhost:49202
  ${C.cyan}Browse${C.reset}       http://localhost:49203

${C.bold}常用命令:${C.reset}
  ${C.dim}npm run health${C.reset}       健康检查
  ${C.dim}npm run stop${C.reset}         停止所有服务
  ${C.dim}npm run restart${C.reset}      重启
  ${C.dim}Ctrl+C${C.reset}               停止本脚本及所有子进程
`);

  // 优雅关闭
  process.on('SIGINT', () => {
    console.log(`\n${C.yellow}正在停止所有服务...${C.reset}`);
    stopAll();
    setTimeout(() => process.exit(0), 2000);
  });

  process.on('SIGTERM', () => {
    stopAll();
    process.exit(0);
  });
}

// ── 启动 ──────────────────────────────────────────────────
main().catch((err) => {
  log.err(`启动失败: ${err.message}`);
  console.error(err);
  stopAll();
  process.exit(1);
});
