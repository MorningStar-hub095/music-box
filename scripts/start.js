#!/usr/bin/env node

/**
 * 音乐盒子启动器（重构版）
 * 共享模块: scripts/env-check.js
 * 流程: Phase 0 环境检查 → Phase 1 DB 准备 → Phase 2 启动服务 → Phase 3 健康检查 → Phase 4 打开浏览器
 */

import { spawn, execSync, exec } from 'child_process';
import path from 'path';
import fs from 'fs';

import {
  colors,
  log,
  ROOT_DIR,
  serviceConfig,
  checkNodeVersion,
  checkMySQL,
  checkRedis,
  checkPortConflict,
  checkDependencies,
  checkPrismaClient,
  httpHealthCheck,
  getServicesToStart,
  killPortProcess,
  checkPort,
  waitForPortFree,
} from './env-check.js';

const LOG_DIR = path.join(ROOT_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'startup.log');

// ============================================================
// 解析启动参数
// ============================================================
const args = process.argv.slice(2);
const isDev = args.includes('--dev');
const isApiOnly = args.includes('--api-only');
const skipChecks = args.includes('--skip-checks');
const verbose = args.includes('--verbose');

// ============================================================
// 性能计时
// ============================================================
const timings = [];

function timerStart(label) {
  return { label, start: Date.now() };
}

function timerEnd(t) {
  const elapsed = Date.now() - t.start;
  timings.push({ label: t.label, elapsed });
  return elapsed;
}

// ============================================================
// 确保日志目录（启动时截断旧日志，避免累积）
// ============================================================
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function rotateLog(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      // 超过 2MB 则截断，保留最后 500 行
      if (stat.size > 2 * 1024 * 1024) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const tail = lines.slice(-500).join('\n');
        fs.writeFileSync(filePath, tail, 'utf-8');
      }
    }
  } catch (_) {}
}

function writeLog(level, msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${msg}\n`;
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
  } catch (_) {}
}

// ============================================================
// Prisma 生成
// ============================================================
async function generatePrisma() {
  log.step('生成 Prisma Client...');

  if (checkPrismaClient()) {
    log.success('Prisma Client 已存在，跳过生成');
    return true;
  }

  try {
    execSync('npx prisma generate', {
      cwd: path.join(ROOT_DIR, 'server'),
      stdio: verbose ? 'inherit' : 'ignore',
      timeout: 30_000,
    });
    log.success('Prisma Client 已生成');
    return true;
  } catch (error) {
    log.error('Prisma Client 生成失败: ' + error.message);
    return false;
  }
}

// ============================================================
// 服务启动（带重试 + 计时）
// ============================================================
const MAX_RETRIES = 5;
const RETRY_DELAY = 2000;

function startServiceOnce(config) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const command = isWindows ? `${config.command}.cmd` : config.command;

    const child = spawn(command, config.args, {
      cwd: config.dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      detached: true,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: 'true' },
    });

    // 服务专属日志文件
    const serviceLogFile = path.join(LOG_DIR, `${config.name.replace(/\s+/g, '_').toLowerCase()}.log`);
    ensureLogDir();
    rotateLog(serviceLogFile);
    const logStream = fs.createWriteStream(serviceLogFile, { flags: 'a' });

    let started = false;
    const timeoutMs = config.healthTimeout || 30000;
    const timeout = setTimeout(() => {
      if (!started) {
        started = true;
        logStream.end();
        if (isWindows && child.pid) {
          try { execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' }); } catch (_) {}
        } else if (child.pid) {
          try { process.kill(-child.pid, 'SIGTERM'); } catch (_) { child.kill(); }
        }
        reject(new Error(`${config.name} 启动超时（${timeoutMs / 1000}秒未检测到就绪信号）`));
      }
    }, timeoutMs);

    const readyPatterns = config.readyPatterns || ['ready', 'Local:', 'localhost', 'VITE', 'listening'];

    const onData = (data) => {
      const raw = data.toString();
      logStream.write(data);

      if (verbose) {
        process.stdout.write(`${colors.dim}[${config.name}]${colors.reset} ${raw}`);
      }

      // 剥离 ANSI 转义码后再做模式匹配（Vite 等工具输出含颜色码）
      const output = raw.replace(/\x1b\[[0-9;]*m/g, '');

      // 快速失败检测（避免等 30 秒超时）
      if (!started) {
        if (output.includes('EADDRINUSE')) {
          started = true;
          clearTimeout(timeout);
          reject(new Error(`端口 ${config.port} 被占用 (EADDRINUSE)`));
          return;
        }
        if (output.includes('MODULE_NOT_FOUND') || output.includes('Cannot find module')) {
          started = true;
          clearTimeout(timeout);
          reject(new Error('缺少依赖模块，请运行 npm run install:all'));
          return;
        }
        if (output.includes('SyntaxError') && output.includes('import')) {
          started = true;
          clearTimeout(timeout);
          reject(new Error('模块语法错误，可能是 ESM/CJS 配置问题'));
          return;
        }
      }

      if (!started && readyPatterns.some((p) => output.includes(p))) {
        started = true;
        clearTimeout(timeout);
        resolve(child);
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    // 端口检测作为备选方案：如果输出中未检测到就绪信号，但端口已开放，则认为服务已就绪
    const portCheckInterval = setInterval(async () => {
      if (started) {
        clearInterval(portCheckInterval);
        return;
      }
      try {
        const portOpen = await checkPort(config.port);
        if (portOpen) {
          started = true;
          clearTimeout(timeout);
          clearInterval(portCheckInterval);
          log.info(`${config.name} 端口 ${config.port} 已开放，视为就绪`);
          resolve(child);
        }
      } catch (_) {}
    }, 3000);

    child.on('error', (error) => {
      if (!started) {
        started = true;
        clearTimeout(timeout);
        logStream.end();
        reject(error);
      }
    });

    child.on('exit', (code) => {
      logStream.end();
      if (!started) {
        started = true;
        clearTimeout(timeout);
        if (code !== null && code !== 0) {
          reject(new Error(`进程退出，代码: ${code}`));
        } else {
          reject(new Error(`${config.name} 进程意外退出 (代码: ${code})`));
        }
      }
    });
  });
}

async function startServiceWithRetry(config) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const child = await startServiceOnce(config);
      return child;
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        log.warn(`${config.name} 启动失败 (第${attempt}次)，${RETRY_DELAY / 1000}秒后重试...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      } else {
        throw error;
      }
    }
  }
}

// ============================================================
// 打开浏览器
// ============================================================
function openBrowser(url) {
  const platform = process.platform;
  let command;
  if (platform === 'win32') {
    command = 'start';
  } else if (platform === 'darwin') {
    command = 'open';
  } else {
    command = 'xdg-open';
  }
  exec(`${command} ${url}`, (error) => {
    if (error) {
      log.warn(`无法自动打开浏览器: ${url}`);
    }
  });
}

// ============================================================
// 状态表格
// ============================================================
function printStatusTable(servicesToStart, serviceResults) {
  const separator = `${colors.dim}${'─'.repeat(64)}${colors.reset}`;
  const header = `${'服务'.padEnd(16)}${'端口'.padEnd(10)}${'状态'.padEnd(14)}${'地址'.padEnd(24)}`;

  log.plain('');
  log.plain(`${colors.bright}📊 服务状态${colors.reset}`);
  log.plain(separator);
  log.plain(`${colors.dim}${header}${colors.reset}`);
  log.plain(separator);

  for (const key of servicesToStart) {
    const config = serviceConfig[key];
    const result = serviceResults[key];
    const url = `http://localhost:${config.port}`;
    const name = `${config.icon} ${config.name}`;
    const nameCol = name.padEnd(24);
    const portCol = String(config.port).padEnd(10);
    const statusCol = result?.ok ? '✔ 运行中    ' : '✘ 失败      ';
    const statusColor = result?.ok ? colors.green : colors.red;

    log.plain(
      `${nameCol}${portCol}${statusColor}${statusCol}${colors.reset}${colors.cyan}${url}${colors.reset}`
    );
  }

  log.plain(separator);
  log.plain('');
}

// ============================================================
// 性能报告
// ============================================================
function printPerformanceReport(totalElapsed) {
  log.plain(`${colors.bright}⏱  性能报告${colors.reset}`);
  log.plain(`${colors.dim}${'─'.repeat(50)}${colors.reset}`);

  for (const t of timings) {
    const sec = (t.elapsed / 1000).toFixed(2);
    const label = t.label.padEnd(32);
    log.plain(`  ${label}${colors.cyan}${sec}s${colors.reset}`);
  }

  log.plain(`${colors.dim}${'─'.repeat(50)}${colors.reset}`);
  log.plain(`  ${'总计'.padEnd(32)}${colors.bright}${(totalElapsed / 1000).toFixed(2)}s${colors.reset}`);
  log.plain('');
}

// ============================================================
// 主函数
// ============================================================
async function main() {
  const globalStart = Date.now();

  ensureLogDir();
  // 启动时轮转旧日志
  rotateLog(LOG_FILE);
  writeLog('INFO', '========== 音乐盒子启动 ==========');

  // ------- Header -------
  console.log(`\n${colors.bright}🎵 音乐盒子启动器${colors.reset}`);
  const modeStr = isApiOnly ? '仅API (--api-only)' : isDev ? '开发 (--dev)' : '全部';
  console.log(`${colors.dim}  模式: ${modeStr}${colors.reset}`);
  if (skipChecks) console.log(`${colors.dim}  跳过环境检查 (--skip-checks)${colors.reset}`);
  if (verbose) console.log(`${colors.dim}  详细输出 (--verbose)${colors.reset}`);
  console.log('');

  // ------- Phase 0: 环境检查 -------
  if (!skipChecks) {
    const t0 = timerStart('Phase 0: 环境检查');
    log.step('Phase 0: 环境检查...');

    if (!checkNodeVersion()) process.exit(1);
    if (!checkDependencies()) process.exit(1);

    const mysqlOk = await checkMySQL();
    if (!mysqlOk) {
      log.error('MySQL 连接失败，无法继续');
      process.exit(1);
    }

    // Redis 可选
    await checkRedis();

    // 端口冲突检测
    const servicesToStart = getServicesToStart(
      isApiOnly ? 'api-only' : isDev ? 'dev' : 'all'
    );
    for (const key of servicesToStart) {
      const cfg = serviceConfig[key];
      const conflict = await checkPortConflict(cfg.port);
      if (conflict) {
        log.warn(`正在释放端口 ${cfg.port} (PID: ${conflict.pid})...`);
        await killPortProcess(cfg.port);
        // 主动轮询等待端口真正释放，最多等 10 秒
        const freed = await waitForPortFree(cfg.port, 10000, 500);
        if (freed) {
          log.success(`端口 ${cfg.port} 已释放`);
        } else {
          log.error(`端口 ${cfg.port} 释放超时，可能仍有进程占用`);
        }
      }
    }

    log.success('环境检查完成');
    timerEnd(t0);
  } else {
    log.warn('已跳过环境检查');
  }

  console.log('');

  // ------- Phase 1: DB 准备 -------
  const t1 = timerStart('Phase 1: DB 准备');
  log.step('Phase 1: DB 准备...');

  const prismaOk = await generatePrisma();
  if (!prismaOk) {
    log.error('Prisma Client 生成失败，无法继续');
    process.exit(1);
  }

  log.success('Phase 1 完成');
  timerEnd(t1);

  console.log('');

  // ------- Phase 2: 启动服务 -------
  const t2 = timerStart('Phase 2: 启动服务');
  log.step('Phase 2: 启动服务...');

  const servicesToStart = getServicesToStart(
    isApiOnly ? 'api-only' : isDev ? 'dev' : 'all'
  );

  const processes = [];
  const serviceResults = {};

  // 注册信号处理器
  const isWindowsPlatform = process.platform === 'win32';
  function gracefulShutdown(signal) {
    console.log(`\n${colors.yellow}收到 ${signal} 信号，正在停止所有服务...${colors.reset}`);
    for (const { process: child, config } of processes) {
      if (isWindowsPlatform && child.pid) {
        try { execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' }); } catch (_) {}
      } else if (child.pid) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch (_) { child.kill(); }
      }
      log.info(`${config.name} 已停止`);
    }
    writeLog('INFO', '========== 服务已停止 ==========');
    process.exit(0);
  }
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // API 串行，前端并行
  const apiKeys = servicesToStart.filter((k) => k === 'api');
  const frontendKeys = servicesToStart.filter((k) => k !== 'api');

  for (const serviceKey of apiKeys) {
    const config = serviceConfig[serviceKey];
    const tService = timerStart(`启动 ${config.name}`);
    log.step(`启动 ${config.name} (端口 ${config.port})...`);
    try {
      const child = await startServiceWithRetry(config);
      processes.push({ key: serviceKey, process: child, config });
      serviceResults[serviceKey] = { ok: true };
      const ms = timerEnd(tService);
      log.success(`${config.name} 已启动 (端口 ${config.port}) [${(ms / 1000).toFixed(1)}s]`);
    } catch (error) {
      timerEnd(tService);
      serviceResults[serviceKey] = { ok: false, error: error.message };
      log.error(`${config.name} 启动失败: ${error.message}`);
    }
  }

  const apiOk = serviceResults['api']?.ok;
  if (frontendKeys.length > 0 && apiOk) {
    await Promise.all(
      frontendKeys.map(async (serviceKey) => {
        const config = serviceConfig[serviceKey];
        const tService = timerStart(`启动 ${config.name}`);
        log.step(`启动 ${config.name} (端口 ${config.port})...`);
        try {
          const child = await startServiceWithRetry(config);
          processes.push({ key: serviceKey, process: child, config });
          serviceResults[serviceKey] = { ok: true };
          const ms = timerEnd(tService);
          log.success(`${config.name} 已启动 (端口 ${config.port}) [${(ms / 1000).toFixed(1)}s]`);
        } catch (error) {
          timerEnd(tService);
          serviceResults[serviceKey] = { ok: false, error: error.message };
          log.error(`${config.name} 启动失败: ${error.message}`);
        }
      })
    );
  } else if (!apiOk) {
    log.warn('API Server 启动失败，跳过前端服务');
  }

  log.success('Phase 2 完成');
  timerEnd(t2);

  console.log('');

  // ------- Phase 3: 健康检查 -------
  const t3 = timerStart('Phase 3: 健康检查');
  log.step('Phase 3: 健康检查...');

  if (serviceResults['api']?.ok) {
    const healthy = await httpHealthCheck(serviceConfig.api.healthUrl, 10000);
    if (healthy) {
      log.success('API Server 健康检查通过');
    } else {
      log.warn('API Server 健康检查未通过');
    }
  }

  log.success('Phase 3 完成');
  timerEnd(t3);

  console.log('');

  // ------- Phase 4: 打开浏览器 -------
  const t4 = timerStart('Phase 4: 浏览器');
  if (serviceResults['web']?.ok) {
    log.step('Phase 4: 打开 Web Player...');
    setTimeout(() => {
      openBrowser(`http://localhost:${serviceConfig.web.port}`);
    }, 2000);
  }
  timerEnd(t4);

  // ------- 状态表格 -------
  printStatusTable(servicesToStart, serviceResults);

  // ------- 性能报告 -------
  const totalElapsed = Date.now() - globalStart;
  printPerformanceReport(totalElapsed);

  // ------- 汇总 -------
  const okCount = Object.values(serviceResults).filter((r) => r.ok).length;
  const totalCount = servicesToStart.length;
  const failCount = totalCount - okCount;

  log.info(`启动完成: ${okCount}/${totalCount} 个服务运行中，耗时 ${(totalElapsed / 1000).toFixed(1)}s`);
  log.info(`日志文件: ${LOG_FILE}`);

  if (failCount > 0) {
    console.log('');
    console.log(`${colors.yellow}⚠ ${failCount} 个服务启动失败，可尝试以下操作：${colors.reset}`);
    console.log(`  ${colors.cyan}npm run troubleshoot${colors.reset}   运行诊断工具`);
    console.log(`  ${colors.cyan}npm run kill-ports${colors.reset}     释放被占用的端口`);
    console.log(`  ${colors.cyan}npm run start:dev${colors.reset}      开发模式（查看详细日志）`);
    console.log(`  日志目录: ${colors.dim}${LOG_DIR}${colors.reset}`);
  }

  console.log(`${colors.bright}按 Ctrl+C 停止所有服务${colors.reset}\n`);

  // 保持进程运行
  await new Promise(() => {});
}

main().catch((error) => {
  log.error(`启动失败: ${error.message}`);
  writeLog('FATAL', error.stack || error.message);
  process.exit(1);
});
