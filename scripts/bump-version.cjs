/**
 * 版本号统一更新脚本
 *
 * 用法：node scripts/bump-version.js <version>
 * 例如：node scripts/bump-version.js 1.2.0
 *
 * 同步更新以下四处，保证「单一事实来源」一致：
 *   1. server/package.json        （后端版本）
 *   2. desktop/package.json       （桌面应用版本，electron-builder 使用）
 *   3. package.json               （根启动器版本）
 *   4. server/src/version.ts      （APP_VERSION 常量，/api/version 接口输出）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const newVersion = process.argv[2];
if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error('用法: node scripts/bump-version.js <x.y.z>');
  process.exit(1);
}

function bumpPackageJson(relPath) {
  const file = path.join(ROOT, relPath);
  const pkg = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const old = pkg.version;
  pkg.version = newVersion;
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`[BUMP] ${relPath}: ${old} -> ${newVersion}`);
}

function bumpVersionTs() {
  const file = path.join(ROOT, 'server', 'src', 'version.ts');
  const src = fs.readFileSync(file, 'utf-8');
  const updated = src.replace(
    /export const APP_VERSION = '[\d.]+';/,
    `export const APP_VERSION = '${newVersion}';`
  );
  if (updated === src) {
    console.error('[BUMP][FATAL] server/src/version.ts 中未找到 APP_VERSION 常量');
    process.exit(1);
  }
  fs.writeFileSync(file, updated);
  console.log(`[BUMP] server/src/version.ts: APP_VERSION -> ${newVersion}`);
}

bumpPackageJson('server/package.json');
bumpPackageJson('desktop/package.json');
bumpPackageJson('package.json');
bumpVersionTs();
console.log(`[BUMP] 完成，当前版本 ${newVersion}。请记得在 server/src/version.ts 的 CHANGELOG 中补充本次更新内容。`);
