#!/usr/bin/env node

/**
 * 批量构建所有子项目
 * 用法: node scripts/build-all.js
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

console.log(`\n${colors.bright}🔨 构建所有子项目${colors.reset}\n`);

let failed = false;

for (const { name, dir } of subProjects) {
  log.step(`构建 ${colors.cyan}${name}${colors.reset}...`);
  try {
    execSync('npm run build', {
      cwd: dir,
      stdio: 'inherit',
    });
    log.success(`${name} 构建完成`);
  } catch (error) {
    log.error(`${name} 构建失败`);
    failed = true;
  }
}

console.log('');
if (failed) {
  log.error('部分项目构建失败，请检查错误信息');
  process.exit(1);
} else {
  log.success('所有子项目构建完成');
}
