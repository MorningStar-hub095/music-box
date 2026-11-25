/**
 * Python 脚本统一执行器
 *
 * 核心功能：
 *   1. 统一设置 windowsHide: true，避免在 Windows 上弹出控制台窗口
 *   2. 统一 Python 可执行路径解析（支持 PYTHON_BIN 环境变量）
 *   3. 全局并发信号量，防止 Python 进程爆炸
 *   4. 统一超时和错误处理
 *   5. 等待槽位超时保护，防止进程卡死导致队列无限增长
 *
 * 2026-08-09 新增：修复 Python 窗口增殖问题
 * 2026-08-09 增强：可配置并发数 + 等待超时 + 队列清理
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Python 可执行路径
 * 优先级：PYTHON_BIN 环境变量 > PATH 中的 python
 */
const PYTHON_BIN = process.env.PYTHON_BIN || 'python';

/**
 * 全局并发限制：同时运行的 Python 进程数
 * 支持通过环境变量 MAX_PYTHON_CONCURRENT 配置
 */
const MAX_CONCURRENT_PYTHON = parseInt(process.env.MAX_PYTHON_CONCURRENT || '5', 10);
let runningCount = 0;
const waitQueue: Array<{ resolve: () => void; timer: ReturnType<typeof setTimeout> }> = [];

/**
 * 等待获取执行槽位（带超时保护）
 * @param timeoutMs 最大等待时间，默认 60 秒
 * @throws 等待超时时抛出错误
 */
function acquire(timeoutMs = 60000): Promise<void> {
  if (runningCount < MAX_CONCURRENT_PYTHON) {
    runningCount++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      // 从队列中移除自身
      const idx = waitQueue.findIndex((item) => item.resolve === resolve);
      if (idx !== -1) waitQueue.splice(idx, 1);
      reject(new Error(`Python 进程槽位等待超时 (${timeoutMs}ms)，当前运行${runningCount}/${MAX_CONCURRENT_PYTHON}，队列${waitQueue.length}`));
    }, timeoutMs);

    waitQueue.push({
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
      timer,
    });
  });
}

/**
 * 释放执行槽位
 */
function release(): void {
  runningCount--;
  const next = waitQueue.shift();
  if (next) {
    clearTimeout(next.timer);
    runningCount++;
    next.resolve();
  }
}

/**
 * 获取当前 Python 执行状态
 */
export function getPythonRunnerStatus() {
  return {
    pythonBin: PYTHON_BIN,
    running: runningCount,
    maxConcurrent: MAX_CONCURRENT_PYTHON,
    queued: waitQueue.length,
  };
}

/**
 * 执行 Python 脚本（统一封装）
 *
 * @param args 命令行参数数组（不含 python 可执行文件本身）
 * @param options 选项（timeout 等，windowsHide 已内置）
 * @returns { stdout, stderr }
 */
export async function runPython(
  args: string[],
  options: { timeout?: number; cwd?: string; encoding?: BufferEncoding } = {},
): Promise<{ stdout: string; stderr: string }> {
  await acquire();
  try {
    const result = await execFileAsync(PYTHON_BIN, args, {
      timeout: options.timeout || 300000, // 默认 5 分钟
      cwd: options.cwd,
      encoding: options.encoding || 'utf8',
      // 修复: 原 execFileAsync 未设置 windowsHide，导致 Windows 上每个 Python 子进程弹出新控制台窗口
      // windowsHide: true 等价于 CREATE_NO_WINDOW 标志，阻止控制台窗口创建
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024, // 10MB，防止大量输出崩溃
    });
    return result;
  } finally {
    release();
  }
}

export default { runPython, getPythonRunnerStatus };
