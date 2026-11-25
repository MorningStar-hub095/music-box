#!/usr/bin/env node

/**
 * 批量安装所有子项目依赖
 * 用法: node scripts/install-all.js
 */

import { execSync } from 'child_process';
import path from 'path';
import { colors, log, ROOT_DIR } from './env-check.js';

const subProjects = [
  { name: 'server', dir: path.join(ROOT_DIR, 'server') },
  { name: 'web', dir: path.join(ROOT_DIR, 'web') },
  { name: 'web/admin', dir: path.join(ROOT_DIR, 'web', 'admin') },
  { name: 'web/browse', dir: path.join(ROOT_DIR, 'web', 'browse') },
];

console.log(`\n${colors.bright}📦 安装所有子项目依赖${colors.reset}\n`);

let failed = false;

for (const { name, dir } of subProjects) {
  log.step(`安装 ${colors.cyan}${name}${colors.reset} 依赖...`);
  try {
    execSync('npm install', {
      cwd: dir,
      stdio: 'inherit',
    });
    log.success(`${name} 依赖安装完成`);
  } catch (error) {
    log.error(`${name} 依赖安装失败`);
    failed = true;
  }
}

console.log('');
if (failed) {
  log.error('部分依赖安装失败，请检查错误信息');
  process.exit(1);
} else {
  log.success('所有子项目依赖安装完成');
}
