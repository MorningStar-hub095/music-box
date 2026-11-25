/**
 * 轻量级持久化日志模块
 *
 * 将服务启动、运行错误、退出等关键事件写入滚动日志文件，
 * 便于服务异常退出后追溯根因（进程崩溃时 console 输出会丢失）。
 *
 * 滚动策略：单文件超过 10MB 时轮转，保留最近 5 个文件。
 */
import fs from 'fs';
import path from 'path';

const LOG_DIR = process.env.LOG_DIR || path.resolve(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server.log');
const MAX_SIZE = 10 * 1024 * 1024; // 单文件上限 10MB
const MAX_FILES = 5; // 保留最近 5 个滚动文件

function ensureDir(): void {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch { /* ignore */ }
}

function rotate(): void {
  try {
    const stat = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE) : null;
    if (stat && stat.size >= MAX_SIZE) {
      for (let i = MAX_FILES - 1; i >= 1; i--) {
        const old = path.join(LOG_DIR, `server.log.${i}`);
        const next = path.join(LOG_DIR, `server.log.${i + 1}`);
        if (fs.existsSync(old)) fs.renameSync(old, next);
      }
      fs.renameSync(LOG_FILE, path.join(LOG_DIR, 'server.log.1'));
    }
  } catch { /* ignore */ }
}

function write(level: string, args: unknown[]): void {
  try {
    ensureDir();
    rotate();
    const msg = args
      .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack || a.message : JSON.stringify(a)))
      .join(' ');
    const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch { /* 日志写入失败不影响主流程 */ }
}

export const logger = {
  info: (...args: unknown[]) => {
    write('INFO', args);
    console.log(...args);
  },
  warn: (...args: unknown[]) => {
    write('WARN', args);
    console.warn(...args);
  },
  error: (...args: unknown[]) => {
    write('ERROR', args);
    console.error(...args);
  },
};

export default logger;
