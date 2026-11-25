#!/usr/bin/env node

/**
 * 首次安装向导
 * 检查环境 → 复制 .env → 安装依赖 → 生成 Prisma → 运行迁移
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

import {
  colors,
  log,
  ROOT_DIR,
  checkNodeVersion,
  checkMySQL,
  checkRedis,
} from './env-check.js';

// ============================================================
// 辅助：同步执行命令并打印输出
// ============================================================
function run(cmd, cwd) {
  log.step(`执行: ${cmd}`);
  try {
    const output = execSync(cmd, {
      cwd,
      stdio: 'inherit',
      timeout: 120_000,
    });
    return true;
  } catch (err) {
    log.error(`命令失败: ${cmd}`);
    if (err.stderr) log.error(err.stderr.toString());
    return false;
  }
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  const startTime = Date.now();

  console.log(`\n${colors.bright}📦 音乐盒子 - 首次安装向导${colors.reset}\n`);

  // ------- Phase 1: 环境检查 -------
  log.step('Phase 1: 环境检查');

  if (!checkNodeVersion()) {
    process.exit(1);
  }

  const mysqlOk = await checkMySQL();
  if (!mysqlOk) {
    log.error('MySQL 不可用，请先启动 MySQL 后重试');
    process.exit(1);
  }

  // Redis 可选
  await checkRedis();

  console.log('');

  // ------- Phase 2: 复制 .env -------
  log.step('Phase 2: 配置文件');

  const envExample = path.join(ROOT_DIR, 'server', '.env.example');
  const envFile = path.join(ROOT_DIR, 'server', '.env');

  if (!fs.existsSync(envExample)) {
    log.error(`找不到 ${envExample}，请确认文件存在`);
    process.exit(1);
  }

  if (fs.existsSync(envFile)) {
    log.warn('server/.env 已存在，跳过复制');
  } else {
    fs.copyFileSync(envExample, envFile);
    log.success('已复制 server/.env.example → server/.env');
    log.warn('请根据实际环境编辑 server/.env 中的数据库密码等配置');
  }

  console.log('');

  // ------- Phase 3: 安装依赖 -------
  log.step('Phase 3: 安装项目依赖');

  const subProjects = [
    { name: 'server',      dir: path.join(ROOT_DIR, 'server') },
    { name: 'web',         dir: path.join(ROOT_DIR, 'web') },
    { name: 'web/admin',   dir: path.join(ROOT_DIR, 'web', 'admin') },
    { name: 'web/browse',  dir: path.join(ROOT_DIR, 'web', 'browse') },
  ];

  let installFailed = false;
  for (const proj of subProjects) {
    const pkgPath = path.join(proj.dir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      log.warn(`${proj.name}/package.json 不存在，跳过`);
      continue;
    }
    log.info(`安装 ${proj.name} 依赖...`);
    const ok = run('npm install', proj.dir);
    if (!ok) {
      log.error(`${proj.name} 依赖安装失败`);
      installFailed = true;
    } else {
      log.success(`${proj.name} 依赖安装完成`);
    }
  }

  if (installFailed) {
    log.error('部分依赖安装失败，请检查上方输出后重试');
    process.exit(1);
  }

  console.log('');

  // ------- Phase 4: Prisma 生成 & 迁移 -------
  log.step('Phase 4: Prisma 初始化');

  const serverDir = path.join(ROOT_DIR, 'server');

  // prisma generate
  log.info('生成 Prisma Client...');
  if (!run('npx prisma generate', serverDir)) {
    log.error('Prisma Client 生成失败');
    process.exit(1);
  }
  log.success('Prisma Client 已生成');

  // prisma migrate deploy
  log.info('执行数据库迁移...');
  if (!run('npx prisma migrate deploy', serverDir)) {
    log.error('数据库迁移失败');
    log.warn('请检查 server/.env 中的 DATABASE_URL 配置');
    process.exit(1);
  }
  log.success('数据库迁移完成');

  console.log('');

  // ------- 完成总结 -------
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  log.plain(`${colors.bright}${'─'.repeat(50)}${colors.reset}`);
  log.plain(`${colors.green}${colors.bright}✅ 安装完成！耗时 ${elapsed}s${colors.reset}`);
  log.plain('');
  log.plain(`${colors.bright}下一步:${colors.reset}`);
  log.plain(`  1. ${colors.cyan}编辑 server/.env${colors.reset}  — 填入正确的数据库密码等`);
  log.plain(`  2. ${colors.cyan}npm start${colors.reset}           — 启动所有服务`);
  log.plain(`  3. ${colors.cyan}npm run health${colors.reset}      — 检查服务状态`);
  log.plain(`${colors.bright}${'─'.repeat(50)}${colors.reset}`);
  console.log('');
}

main().catch((error) => {
  log.error(`安装失败: ${error.message}`);
  process.exit(1);
});
