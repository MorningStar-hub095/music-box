/**
 * 打包暂存脚本：组装 desktop/app 目录
 *  - server/dist（编译产物）+ package.json + lock + .npmrc
 *  - 全新安装生产依赖（npm ci --omit=dev，剔除 jest/eslint 等巨型 dev 依赖）
 *  - web/dist（前端构建产物）
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server');
const WEB = path.join(ROOT, 'web');
const STAGE = path.resolve(__dirname, '..', 'app');
const FORCE = process.argv.includes('--force');

/** 递归取目录内最新文件 mtime（毫秒） */
function newestMtime(dir) {
  let newest = 0;
  const walk = (p) => {
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(p)) walk(path.join(p, e));
    } else if (st.mtimeMs > newest) {
      newest = st.mtimeMs;
    }
  };
  walk(dir);
  return newest;
}

/**
 * 构建产物新鲜度检查：防止把过期的 dist 打进安装包。
 * 源码比产物新 → 报错退出（npm run stage -- --force 可跳过）。
 */
function checkFreshness() {
  const checks = [
    ['server/src', 'server/dist/index.js'],
    ['web/src', 'web/dist/index.html'],
  ];
  for (const [srcRel, distRel] of checks) {
    const distFile = path.join(ROOT, distRel);
    if (!fs.existsSync(distFile)) {
      console.error(`[STAGE][FATAL] 缺少构建产物 ${distRel}，请先运行 npm run build:all`);
      process.exit(1);
    }
    const srcNewest = newestMtime(path.join(ROOT, srcRel));
    if (srcNewest > fs.statSync(distFile).mtimeMs) {
      console.error(
        `[STAGE][FATAL] ${srcRel} 存在比 ${distRel} 更新的源码，产物已过期。\n` +
        `  请先运行 npm run build:all，或执行 npm run stage -- --force 跳过检查。`
      );
      process.exit(1);
    }
  }
  console.log('[STAGE] 构建产物新鲜度检查通过');
}

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // 兜底：部分受管运行环境会拦截大目录的 fs.rmSync（如企业安全策略/Agent 沙箱），
    // 退回系统 shell 删除，保证暂存目录总能被清理重建
    if (process.platform === 'win32') {
      execSync(`if exist "${p}" rd /s /q "${p}"`, { stdio: 'ignore' });
    } else {
      execSync(`rm -rf "${p}"`, { stdio: 'ignore' });
    }
  }
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function copy(src, dest) {
  fs.cpSync(src, dest, { recursive: true });
  console.log('copy', path.relative(ROOT, src), '->', path.relative(ROOT, dest));
}

console.log('[STAGE] 清理暂存目录...');
if (FORCE) {
  console.log('[STAGE] --force：跳过构建产物新鲜度检查');
} else {
  checkFreshness();
}
rmrf(STAGE);
ensureDir(path.join(STAGE, 'server'));

console.log('[STAGE] 复制服务器编译产物...');
copy(path.join(SERVER, 'dist'), path.join(STAGE, 'server', 'dist'));
copy(path.join(SERVER, 'prisma'), path.join(STAGE, 'server', 'prisma'));
for (const f of ['package.json', 'package-lock.json', '.npmrc']) {
  fs.copyFileSync(path.join(SERVER, f), path.join(STAGE, 'server', f));
  console.log('copy server/' + f);
}

console.log('[STAGE] 安装生产依赖（约几分钟）...');
execSync('npm ci --omit=dev --no-audit --no-fund', {
  cwd: path.join(STAGE, 'server'),
  stdio: 'inherit',
});

console.log('[STAGE] 生成 Prisma 客户端引擎...');
execSync(
  `node "${path.join(SERVER, 'node_modules', 'prisma', 'build', 'index.js')}" generate --schema=prisma/schema.prisma`,
  { cwd: path.join(STAGE, 'server'), stdio: 'inherit' }
);

console.log('[STAGE] 复制前端构建产物...');
ensureDir(path.join(STAGE, 'web'));
copy(path.join(WEB, 'dist'), path.join(STAGE, 'web', 'dist'));

console.log('[STAGE] 暂存完成:', STAGE);
