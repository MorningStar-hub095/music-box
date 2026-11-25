#!/usr/bin/env node

/**
 * 音乐盒子健康检查（增强版）
 * 支持: --watch (持续监控) / --json (JSON 输出) / 默认单次表格
 */

import fs from 'fs';
import path from 'path';

import {
  colors,
  log,
  ROOT_DIR,
  serviceConfig,
  checkPort,
  httpHealthCheck,
} from './env-check.js';

const LOG_DIR = path.join(ROOT_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'startup.log');

// ============================================================
// 解析参数
// ============================================================
const args = process.argv.slice(2);
const watchMode = args.includes('--watch');
const jsonMode = args.includes('--json');
const WATCH_INTERVAL = 30_000;

// ============================================================
// 日志文件信息
// ============================================================
function checkLogFile() {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      return { exists: false, size: 0, sizeStr: '-' };
    }
    const stat = fs.statSync(LOG_FILE);
    const size = stat.size;
    let sizeStr;
    if (size < 1024) {
      sizeStr = `${size} B`;
    } else if (size < 1024 * 1024) {
      sizeStr = `${(size / 1024).toFixed(1)} KB`;
    } else {
      sizeStr = `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }
    const lastModified = stat.mtime.toLocaleString('zh-CN');
    return { exists: true, size, sizeStr, lastModified };
  } catch {
    return { exists: false, size: 0, sizeStr: '-' };
  }
}

// ============================================================
// 辅助: ANSI 感知的 padRight / padLeft
// ============================================================
function padRight(str, len) {
  const visible = str.replace(/\x1b\[\d+m/g, '');
  const pad = Math.max(0, len - visible.length);
  return str + ' '.repeat(pad);
}

function padLeft(str, len) {
  const visible = str.replace(/\x1b\[\d+m/g, '');
  const pad = Math.max(0, len - visible.length);
  return ' '.repeat(pad) + str;
}

// ============================================================
// 表格输出
// ============================================================
function printTable(results) {
  const headers = ['服务名称', '端口', '状态', '必需'];
  const colWidths = [16, 8, 22, 6];

  const separator = colWidths.map((w) => '─'.repeat(w)).join('─┼─');
  const topBorder    = colWidths.map((w) => '─'.repeat(w)).join('─┬─');
  const bottomBorder = colWidths.map((w) => '─'.repeat(w)).join('─┴─');

  console.log(`  ┌${topBorder}┐`);
  console.log(`  │ ${headers.map((h, i) => padRight(h, colWidths[i])).join(' │ ')} │`);
  console.log(`  ├${separator}┤`);

  for (const r of results) {
    const statusColor = r.status === '运行中' ? colors.green
      : r.status === '健康' ? colors.green
      : r.status === '异常' ? colors.yellow
      : colors.red;

    const statusStr = `${statusColor}${r.status}${colors.reset}`;
    const requiredStr = r.required ? `${colors.red}是${colors.reset}` : `${colors.dim}否${colors.reset}`;

    const cols = [
      padRight(r.name, colWidths[0]),
      padLeft(String(r.port), colWidths[1]),
      padRight(statusStr, colWidths[2]),
      padLeft(requiredStr, colWidths[3]),
    ];
    console.log(`  │ ${cols.join(' │ ')} │`);
  }

  console.log(`  └${bottomBorder}┘`);
}

// ============================================================
// 执行一次健康检查
// ============================================================
async function runCheck() {
  const results = [];
  let allHealthy = true;
  let requiredHealthy = true;

  for (const key of Object.keys(serviceConfig)) {
    const svc = serviceConfig[key];
    const portOk = await checkPort(svc.port);

    if (!portOk) {
      results.push({ name: svc.name, port: svc.port, status: '未运行', required: svc.required });
      if (svc.required) requiredHealthy = false;
      allHealthy = false;
      continue;
    }

    if (svc.healthUrl) {
      const httpOk = await httpHealthCheck(svc.healthUrl);
      if (httpOk) {
        results.push({ name: svc.name, port: svc.port, status: '健康', required: svc.required });
      } else {
        results.push({ name: svc.name, port: svc.port, status: '异常', required: svc.required });
        if (svc.required) requiredHealthy = false;
        allHealthy = false;
      }
    } else {
      results.push({ name: svc.name, port: svc.port, status: '运行中', required: svc.required });
    }
  }

  return { results, allHealthy, requiredHealthy };
}

// ============================================================
// JSON 输出
// ============================================================
function outputJSON(data) {
  const logInfo = checkLogFile();
  const payload = {
    timestamp: new Date().toISOString(),
    services: data.results.map((r) => ({
      name: r.name,
      port: r.port,
      status: r.status,
      required: r.required,
    })),
    allHealthy: data.allHealthy,
    requiredHealthy: data.requiredHealthy,
    logFile: logInfo,
  };
  console.log(JSON.stringify(payload, null, 2));
}

// ============================================================
// 表格输出 + 日志文件 + 总结
// ============================================================
function outputTable(data) {
  const logInfo = checkLogFile();

  console.log(`\n${colors.bright}🏥 音乐盒子健康检查${colors.reset}\n`);

  console.log(`${colors.bright}服务状态${colors.reset}`);
  printTable(data.results);

  console.log(`\n${colors.bright}日志文件${colors.reset}`);
  if (logInfo.exists) {
    log.success(`logs/startup.log  存在  大小: ${logInfo.sizeStr}  最后修改: ${logInfo.lastModified}`);
  } else {
    log.warn(`logs/startup.log  不存在`);
  }

  console.log('');
  if (data.allHealthy) {
    console.log(`${colors.green}✅ 所有服务运行正常${colors.reset}`);
  } else if (data.requiredHealthy) {
    console.log(`${colors.yellow}⚠️  必要服务正常，部分可选服务未运行${colors.reset}`);
  } else {
    console.log(`${colors.red}❌ 必要服务异常，请检查后重试${colors.reset}`);
  }
  console.log('');
}

// ============================================================
// 主函数
// ============================================================
async function main() {
  if (watchMode) {
    // 持续监控模式
    console.log(`${colors.bright}🔄 持续监控模式 (每 ${WATCH_INTERVAL / 1000} 秒刷新, Ctrl+C 退出)${colors.reset}\n`);

    let runCount = 0;
    const runLoop = async () => {
      runCount++;
      if (!jsonMode) {
        console.clear();
        console.log(`${colors.bright}🔄 健康检查 #${runCount}  ${new Date().toLocaleString('zh-CN')}${colors.reset}\n`);
      }

      const data = await runCheck();

      if (jsonMode) {
        outputJSON(data);
      } else {
        outputTable(data);
      }
    };

    // 立即执行一次
    await runLoop();

    // 定时循环
    setInterval(runLoop, WATCH_INTERVAL);

    // 保持进程运行
    await new Promise(() => {});
  } else {
    // 单次检查模式
    const data = await runCheck();

    if (jsonMode) {
      outputJSON(data);
    } else {
      outputTable(data);
    }

    process.exit(data.requiredHealthy ? 0 : 1);
  }
}

main().catch((error) => {
  log.error(`健康检查失败: ${error.message}`);
  process.exit(1);
});
