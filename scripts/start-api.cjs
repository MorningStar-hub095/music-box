/**
 * 轻量级 API 服务器启动脚本（供 Tauri 桌面应用自动启动使用）
 * 跳过环境检查，直接启动 API 服务器
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');
const DIST_ENTRY = path.join(SERVER_DIR, 'dist', 'index.js');

// 确保日志目录
const LOG_DIR = path.join(ROOT, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, 'auto-start.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
}

// 确保 Prisma Client 已生成
function ensurePrisma() {
  const prismaClient = path.join(SERVER_DIR, 'node_modules', '.prisma', 'client', 'index.js');
  if (fs.existsSync(prismaClient)) return true;

  log('Prisma Client 未生成，正在生成...');
  try {
    const { execSync } = require('child_process');
    execSync('npx prisma generate', {
      cwd: SERVER_DIR,
      timeout: 30000,
      stdio: 'pipe',
    });
    log('Prisma Client 生成成功');
    return true;
  } catch (e) {
    log('Prisma Client 生成失败: ' + e.message);
    return false;
  }
}

// 加载 .env 文件
function loadEnv() {
  const envPath = path.join(SERVER_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}

async function main() {
  log('========== 自动启动 API 服务器 ==========');

  // 加载环境变量
  loadEnv();

  // 确保 Prisma
  if (!ensurePrisma()) {
    log('无法启动：Prisma 未就绪');
    process.exit(1);
  }

  // 选择启动方式：优先用编译后的 JS，否则用 ts-node
  let cmd, args;
  if (fs.existsSync(DIST_ENTRY)) {
    cmd = 'node';
    args = [DIST_ENTRY];
    log('使用编译版本: dist/index.js');
  } else {
    cmd = 'npx';
    args = ['ts-node', 'src/index.ts'];
    log('使用 ts-node: src/index.ts');
  }

  log(`启动命令: ${cmd} ${args.join(' ')}`);

  const child = spawn(cmd, args, {
    cwd: SERVER_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    shell: process.platform === 'win32',
  });

  child.stdout.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) log('[stdout] ' + msg);
  });

  child.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) log('[stderr] ' + msg);
  });

  child.on('error', (err) => {
    log('进程启动错误: ' + err.message);
  });

  child.on('exit', (code, signal) => {
    log(`进程退出: code=${code}, signal=${signal}`);
  });

  // 不等待子进程，让它在后台运行
  child.unref();

  log('API 服务器启动命令已执行，PID: ' + child.pid);

  // 等待一小段时间确保进程启动
  await new Promise(r => setTimeout(r, 2000));

  // 检查进程是否还在运行
  if (child.exitCode !== null) {
    log('警告：进程已退出，exitCode=' + child.exitCode);
    process.exit(1);
  }

  log('API 服务器启动成功（后台运行中）');
  process.exit(0);
}

main().catch(err => {
  log('启动脚本异常: ' + err.message);
  process.exit(1);
});
