#!/usr/bin/env node

/**
 * 强制释放所有项目端口
 * 用于解决端口占用问题
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const PORTS = [parseInt(process.env.API_PORT || process.env.PORT || '49200', 10), parseInt(process.env.WEB_PORT || '49201', 10), parseInt(process.env.ADMIN_PORT || '49202', 10), parseInt(process.env.BROWSE_PORT || '49203', 10)];

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

/** 从 "127.0.0.1:49200" 或 "[::]:49200" 形式的地址中提取端口 */
function extractPortFromAddr(addr) {
  const m = String(addr || '').match(/:(\d+)$/);
  return m ? parseInt(m[1], 10) : NaN;
}

async function killPort(port) {
  try {
    if (process.platform === 'win32') {
      // Windows: 使用 netstat 查找并终止进程
      // 安全修复：仅终止 LISTENING 状态 + 本地地址精确匹配目标端口的进程，
      // 避免误杀处于 TIME_WAIT/ESTABLISHED 等状态的无关进程
      const { stdout } = await execAsync(`netstat -ano -p tcp`, { timeout: 5000 });
      const lines = stdout.trim().split('\n').filter(Boolean);
      const killedPids = new Set();

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const localAddr = parts[1];
        const state = parts[3];
        const pid = parts[4];
        if (state !== 'LISTENING') continue;              // 只杀监听进程
        if (extractPortFromAddr(localAddr) !== port) continue; // 精确端口匹配
        if (pid && pid !== '0' && !killedPids.has(pid)) {
          killedPids.add(pid);
          try {
            // /T 杀进程树（含子进程），/F 强制终止
            await execAsync(`taskkill /F /T /PID ${pid}`, { timeout: 5000 });
            console.log(`${colors.green}[✓]${colors.reset} 已终止进程 PID: ${pid} (端口 ${port})`);
          } catch (e) {
            // 进程可能已经结束
          }
        }
      }
    } else {
      // macOS/Linux: 使用 lsof 查找并终止进程
      try {
        const { stdout } = await execAsync(`lsof -ti:${port}`, { timeout: 5000 });
        const pids = stdout.trim().split('\n').filter(Boolean);
        for (const pid of pids) {
          await execAsync(`kill -9 ${pid}`).catch(() => {});
          console.log(`${colors.green}[✓]${colors.reset} 已终止进程 PID: ${pid} (端口 ${port})`);
        }
      } catch (e) {
        // 端口未被占用
      }
    }
  } catch (e) {
    // 端口未被占用或命令执行失败
  }
}

async function main() {
  console.log(`\n${colors.cyan}正在清理项目端口...${colors.reset}\n`);
  
  for (const port of PORTS) {
    await killPort(port);
  }
  
  // 等待端口完全释放
  console.log(`\n${colors.yellow}等待端口释放...${colors.reset}`);
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log(`${colors.green}\n✓ 端口清理完成！${colors.reset}\n`);
}

main().catch(console.error);
