#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
};

const log = {
  info: (msg) => console.log(`${colors.cyan}[INFO]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}[✓]${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}[✗]${colors.reset} ${msg}`),
  step: (msg) => console.log(`${colors.blue}[→]${colors.reset} ${msg}`),
};

// 要构建的项目
const projects = [
  { name: 'Server', dir: path.join(ROOT_DIR, 'server') },
  { name: 'Web', dir: path.join(ROOT_DIR, 'web') },
  { name: 'Admin', dir: path.join(ROOT_DIR, 'web', 'admin') },
  { name: 'Browse', dir: path.join(ROOT_DIR, 'web', 'browse') },
];

// 构建项目
function build(dir) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const command = isWindows ? 'npm.cmd' : 'npm';
    
    const child = spawn(command, ['run', 'build'], {
      cwd: dir,
      stdio: 'inherit',
      shell: true,
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`构建失败，退出码: ${code}`));
      }
    });

    child.on('error', reject);
  });
}

// 主函数
async function main() {
  console.log('\n' + colors.bright + '🔨 构建音乐盒子' + colors.reset + '\n');

  for (const { name, dir } of projects) {
    log.step(`构建 ${name}...`);
    try {
      await build(dir);
      log.success(`${name} 构建完成`);
    } catch (error) {
      log.error(`${name} 构建失败: ${error.message}`);
      process.exit(1);
    }
  }

  console.log('\n' + colors.green + '✅ 所有项目构建完成' + colors.reset + '\n');
}

main().catch((error) => {
  log.error(`构建失败: ${error.message}`);
  process.exit(1);
});
