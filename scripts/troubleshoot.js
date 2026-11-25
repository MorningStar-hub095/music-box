#!/usr/bin/env node

/**
 * Music Box 故障诊断工具
 * 自动检测常见启动和连接问题并给出修复建议
 */

import { execSync } from 'child_process';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');

const C = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m', bright: '\x1b[1m',
};

let PASS = 0, FAIL = 0, WARN = 0;
const issues = [];

function ok(msg)   { PASS++; console.log(`  ${C.green}[OK]${C.reset} ${msg}`); }
function fail(msg) { FAIL++; console.log(`  ${C.red}[FAIL]${C.reset} ${msg}`); }
function warn(msg) { WARN++; console.log(`  ${C.yellow}[WARN]${C.reset} ${msg}`); }
function fix(msg)  { console.log(`         ${C.cyan}fix:${C.reset} ${msg}`); }

function checkPortOpen(port, host = 'localhost') {
  return new Promise(resolve => {
    const s = new net.Socket();
    s.setTimeout(2000);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => { s.destroy(); resolve(false); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.connect(port, host);
  });
}

function getPortPids(port) {
  try {
    const out = execSync(`netstat -ano | findstr ":${port}"`, { timeout: 5000, encoding: 'utf-8' });
    const pids = new Set();
    for (const line of out.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5 && parts[3] === 'LISTENING') {
        const m = parts[1].match(/:(\d+)$/);
        if (m && parseInt(m[1]) === port && parts[4] !== '0') pids.add(parts[4]);
      }
    }
    return [...pids];
  } catch { return []; }
}

// ============================================================
// 诊断项目
// ============================================================

async function checkNode() {
  console.log(`\n${C.bright}[1/9] Node.js${C.reset}`);
  try {
    const ver = execSync('node -v', { encoding: 'utf-8' }).trim();
    const major = parseInt(ver.replace('v', '').split('.')[0]);
    if (major < 18) { fail(`版本过低: ${ver}，需要 >= 18`); fix('安装 Node.js 18+: https://nodejs.org/'); }
    else { ok(`版本 ${ver}`); }
  } catch { fail('Node.js 未安装或不在 PATH 中'); fix('安装 Node.js 18+: https://nodejs.org/'); }
}

async function checkNpm() {
  console.log(`\n${C.bright}[2/9] npm${C.reset}`);
  try {
    const ver = execSync('npm -v', { encoding: 'utf-8' }).trim();
    ok(`版本 ${ver}`);
  } catch { fail('npm 不可用'); fix('重新安装 Node.js'); }
}

async function checkDeps() {
  console.log(`\n${C.bright}[3/9] 项目依赖${C.reset}`);
  const dirs = ['server', 'web', 'web/admin', 'web/browse'];
  let allOk = true;
  for (const d of dirs) {
    const nm = path.join(ROOT_DIR, d, 'node_modules');
    if (!fs.existsSync(nm)) { fail(`${d}/node_modules 不存在`); allOk = false; }
  }
  if (allOk) ok('所有子项目依赖已安装');
  else fix('运行 npm run install:all');
}

async function checkEnv() {
  console.log(`\n${C.bright}[4/9] 环境配置${C.reset}`);
  const envPath = path.join(ROOT_DIR, 'server', '.env');
  if (!fs.existsSync(envPath)) {
    fail('server/.env 不存在');
    fix('复制 server/.env.example 为 server/.env 并填写数据库密码');
    return;
  }
  ok('server/.env 存在');
  const env = fs.readFileSync(envPath, 'utf-8');
  if (!env.includes('DATABASE_URL')) { warn('缺少 DATABASE_URL'); fix('在 server/.env 中添加 DATABASE_URL'); }
  if (!env.includes('JWT_SECRET')) { warn('缺少 JWT_SECRET'); fix('在 server/.env 中添加 JWT_SECRET'); }
  if (!env.includes('PORT')) { warn('缺少 PORT，将使用默认端口 49200'); }
}

async function checkMySQL() {
  console.log(`\n${C.bright}[5/9] MySQL (端口 3306)${C.reset}`);
  const up = await checkPortOpen(3306);
  if (up) ok('MySQL 正在运行');
  else { fail('MySQL 未运行 (端口 3306 不可达)'); fix('启动 MySQL 服务: net start MySQL'); }
}

async function checkRedis() {
  console.log(`\n${C.bright}[6/9] Redis (端口 6379)${C.reset}`);
  const up = await checkPortOpen(6379);
  if (up) ok('Redis 正在运行');
  else { warn('Redis 未运行 (缓存功能不可用，不影响启动)'); fix('启动 Redis 服务'); }
}

async function checkPorts() {
  console.log(`\n${C.bright}[7/9] 端口可用性${C.reset}`);
  const ports = [
    { port: parseInt(process.env.API_PORT || process.env.PORT || '49200', 10), name: 'API Server' },
    { port: parseInt(process.env.WEB_PORT || '49201', 10), name: 'Web Player' },
    { port: parseInt(process.env.ADMIN_PORT || '49202', 10), name: 'Admin' },
    { port: parseInt(process.env.BROWSE_PORT || '49203', 10), name: 'Browse' },
  ];
  let hasConflict = false;
  for (const { port, name } of ports) {
    const pids = getPortPids(port);
    if (pids.length > 0) {
      warn(`端口 ${port} (${name}) 被占用 - PID: ${pids.join(', ')}`);
      hasConflict = true;
    } else {
      ok(`端口 ${port} (${name}) 可用`);
    }
  }
  if (hasConflict) fix('运行 npm run kill-ports 释放端口');
}

async function checkPrisma() {
  console.log(`\n${C.bright}[8/9] Prisma Client${C.reset}`);
  const prismaPath = path.join(ROOT_DIR, 'server', 'node_modules', '.prisma', 'client', 'query_engine-windows.dll.node');
  if (fs.existsSync(prismaPath)) ok('Prisma Client 已生成');
  else { warn('Prisma Client 未生成'); fix('运行 cd server && npx prisma generate'); }
}

async function checkApiHealth() {
  console.log(`\n${C.bright}[9/9] API Server 健康检查${C.reset}`);
  const port = process.env.API_PORT || process.env.PORT || '49200';
  const url = `http://localhost:${port}/health`;
  const up = await checkPortOpen(parseInt(port));
  if (!up) { warn(`API Server 未运行 (端口 ${port})`); fix('运行 npm start 启动服务'); return; }
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (resp.ok) ok(`API Server 健康 (${url})`);
    else { warn(`API Server 响应异常: HTTP ${resp.status}`); }
  } catch { warn(`API Server 无法访问 (${url})`); fix('检查 server/.env 配置和数据库连接'); }
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  console.log(`\n${C.bright}============================================================${C.reset}`);
  console.log(`${C.bright}              Music Box 故障诊断工具${C.reset}`);
  console.log(`${C.bright}============================================================${C.reset}`);

  await checkNode();
  await checkNpm();
  await checkDeps();
  await checkEnv();
  await checkMySQL();
  await checkRedis();
  await checkPorts();
  await checkPrisma();
  await checkApiHealth();

  console.log(`\n${C.bright}============================================================${C.reset}`);
  console.log(`${C.bright}                        诊断结果${C.reset}`);
  console.log(`${C.bright}============================================================${C.reset}\n`);
  console.log(`  ${C.green}通过: ${PASS}${C.reset}    ${C.red}失败: ${FAIL}${C.reset}    ${C.yellow}警告: ${WARN}${C.reset}\n`);

  if (FAIL > 0) {
    console.log(`  ${C.red}[结论] 存在 ${FAIL} 个问题需要修复${C.reset}\n`);
    console.log('  常用修复命令:');
    console.log('    npm run install:all    安装所有依赖');
    console.log('    npm run kill-ports     释放被占用的端口');
    console.log('    npm run setup          完整初始化');
    console.log('    npm start              启动全部服务');
    console.log('    npm run start:api      仅启动 API 服务器');
  } else {
    console.log(`  ${C.green}[结论] 环境检查全部通过，可以正常启动${C.reset}\n`);
    console.log('  启动命令:');
    console.log('    npm start              启动全部服务');
    console.log('    npm run start:dev      开发模式 (详细输出)');
    console.log('    npm run start:api      仅启动 API 服务器');
  }

  if (WARN > 0) {
    console.log(`\n  ${C.yellow}注意: ${WARN} 个警告不影响启动但建议处理${C.reset}`);
  }

  console.log(`\n${C.bright}============================================================${C.reset}`);
  console.log(`日志文件: logs/startup.log`);
  console.log(`诊断时间: ${new Date().toLocaleString()}`);
  console.log(`${C.bright}============================================================${C.reset}\n`);
}

main().catch(console.error);
