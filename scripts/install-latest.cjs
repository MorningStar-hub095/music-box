#!/usr/bin/env node
/**
 * install-latest.cjs — 以后重装全自动：找最新包 → （可选打包）→ 停应用 → 镜像重装 → 校验 → 启动
 *
 * 常用命令（在项目根 D:\music_box 下执行）：
 *
 *   node scripts/install-latest.cjs --launch     # 全自动：自动找最新部署包并重装，完成后启动应用
 *   node scripts/install-latest.cjs --build --launch
 *                                                # 最全自动：先重新打包（含 DB 快照），再重装并启动
 *   node scripts/install-latest.cjs --dry-run    # 只打印将执行的计划，不写入任何东西
 *   node scripts/install-latest.cjs --src "D:\某部署包\MusicBox"   # 手动指定包源，跳过自动发现
 *
 * 自动发现规则：
 *   1) 扫描 D:\music_box 下所有 部署包-*\MusicBox 与 MusicBox-* 形态的完整包目录
 *      （判定标准：同时存在 MusicBox.exe 与 resources/app.asar）
 *   2) 从各自 resources/server/dist/version.js 读取 APP_VERSION
 *   3) 取版本号最高者；版本相同取 app.asar 修改时间最新者
 */
'use strict';

const { execSync, spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------- 参数 ----------
const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const has = (name) => args.includes(name);

const DRY = has('--dry-run');
const LAUNCH = has('--launch');
const BUILD = has('--build');
const SRC_EXPLICIT = argOf('--src', null);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const dst = argOf('--dst', path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'Programs', 'MusicBox'
));

function log(s) { console.log(`[安装] ${s}`); }
function die(msg) { console.error(`[安装][失败] ${msg}`); process.exit(1); }
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// ---------- 包目录探测与版本读取 ----------
function readPkgVersion(pkgDir) {
  try {
    const vjs = fs.readFileSync(path.join(pkgDir, 'resources', 'server', 'dist', 'version.js'), 'utf8');
    const m = vjs.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  } catch { return null; }
}

function isCompletePkg(dir) {
  return fs.existsSync(path.join(dir, 'MusicBox.exe')) &&
         fs.existsSync(path.join(dir, 'resources', 'app.asar'));
}

function cmpSemver(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function discoverPackages() {
  const found = [];
  const scan = (base, pattern) => {
    let entries = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || !pattern.test(e.name)) continue;
      const full = path.join(base, e.name);
      // 部署包-*\MusicBox（打包脚本目标）或 MusicBox-*（展开包）本身
      const candidates = /^部署包-/.test(e.name)
        ? [path.join(full, 'MusicBox')]
        : [full];
      for (const c of candidates) {
        if (!isCompletePkg(c)) continue;
        const v = readPkgVersion(c);
        if (!v) continue;
        let mtime = 0;
        try { mtime = fs.statSync(path.join(c, 'resources', 'app.asar')).mtimeMs; } catch { /* ignore */ }
        found.push({ dir: c, version: v, mtime });
      }
    }
  };
  scan(PROJECT_ROOT, /^(部署包-|MusicBox-\d)/);
  return found;
}

// ---------- 主流程 ----------
let SRC = null;
let srcVersion = null;

function pickLatest() {
  const pkgs = discoverPackages();
  if (pkgs.length === 0) {
    die(`未在 ${PROJECT_ROOT} 下发现任何完整部署包。\n` +
        '  可先运行: node server/scripts/package-v145.cjs all\n' +
        '  或用 --src 手动指定包目录');
  }
  // 版本最高优先；同版本取 app.asar 最新（保证刚打包的胜出旧展开副本）
  pkgs.sort((a, b) => cmpSemver(b.version, a.version) || b.mtime - a.mtime);
  return { best: pkgs[0], pkgs };
}

if (SRC_EXPLICIT) {
  SRC = SRC_EXPLICIT;
  if (!isCompletePkg(SRC)) die(`指定的包源不完整（缺 MusicBox.exe 或 resources/app.asar）: ${SRC}`);
  srcVersion = readPkgVersion(SRC) || '(未知)';
} else {
  const { best, pkgs } = pickLatest();
  SRC = best.dir;
  srcVersion = best.version;
  log('发现可用部署包：');
  for (const p of pkgs) log(`  v${p.version}  ${p.dir}${p === best ? '   ← 选用' : ''}`);
}

log(`包源: ${SRC}  (v${srcVersion})`);
log(`目标: ${dst}`);

if (DRY) {
  log('【dry-run】仅打印计划，不执行。实际执行将：');
  if (BUILD) log('  0) 运行 node server/scripts/package-v145.cjs all 重新打包（含 DB 快照，约 5-15 分钟），完成后自动重新选最新包');
  log('  1) 结束运行中的 MusicBox.exe（如有）');
  log('  2) robocopy /MIR 包源 → 安装目录（镜像，清除目标旧文件）');
  log('  3) 校验组件齐全、asar 与源一致、版本一致');
  if (LAUNCH) log('  4) 启动 MusicBox.exe');
  process.exit(0);
}

// ---------- 0. 可选：先重新打包 ----------
if (BUILD) {
  log('步骤 0：重新打包（package-v145.cjs all，含 DB 快照，请耐心等待）...');
  const r = spawnSync('node', [path.join(__dirname, '..', 'server', 'scripts', 'package-v145.cjs'), 'all'],
    { stdio: 'inherit', cwd: PROJECT_ROOT });
  if (r.status !== 0) die(`打包失败（退出码 ${r.status}），中止重装`);
  // 打包后重新发现并选择最新包（版本可能升级；同版本时刚打包的 mtime 最新会胜出）
  if (!SRC_EXPLICIT) {
    const { best, pkgs } = pickLatest();
    SRC = best.dir;
    srcVersion = best.version;
    log('打包后重新选择最新包：');
    for (const p of pkgs) log(`  v${p.version}  ${p.dir}${p === best ? '   ← 选用' : ''}`);
  } else {
    srcVersion = readPkgVersion(SRC) || srcVersion;
  }
  log(`包源现为 v${srcVersion}: ${SRC}`);
}

// ---------- 1. 停止运行中的应用 ----------
try {
  const out = execSync('tasklist /FI "IMAGENAME eq MusicBox.exe" /NH', { encoding: 'utf8' });
  if (out.includes('MusicBox.exe')) {
    log('检测到 MusicBox.exe 正在运行，结束进程...');
    execSync('taskkill /IM MusicBox.exe /F', { stdio: 'ignore' });
    const waitStart = Date.now();
    while (Date.now() - waitStart < 15000) {
      const o2 = execSync('tasklist /FI "IMAGENAME eq MusicBox.exe" /NH', { encoding: 'utf8' });
      if (!o2.includes('MusicBox.exe')) break;
      sleep(500);
    }
    log('应用已停止');
  } else {
    log('应用未在运行，跳过停止步骤');
  }
} catch (e) {
  log(`停止应用时出现非致命问题: ${e.message.split('\n')[0]}`);
}

// ---------- 2. robocopy 镜像同步 ----------
log('开始镜像重装（robocopy /MIR，大包约 2-3 分钟）...');
const rc = spawn('robocopy', [SRC, dst, '/MIR', '/R:2', '/W:2', '/NFL', '/NDL', '/NJH'], { stdio: 'ignore' });
rc.on('close', (code) => {
  if (code >= 8) die(`robocopy 同步失败，退出码 ${code}`);
  log(`同步完成（robocopy 退出码 ${code}，0-7 为成功）`);

  // ---------- 3. 校验 ----------
  const srcAsar = path.join(SRC, 'resources', 'app.asar');
  const dstAsar = path.join(dst, 'resources', 'app.asar');
  const checks = [
    ['MusicBox.exe', path.join(dst, 'MusicBox.exe')],
    ['app.asar', dstAsar],
    ['server/dist', path.join(dst, 'resources', 'server', 'dist')],
    ['web/dist', path.join(dst, 'resources', 'web', 'dist')],
    ['db/pgdata.zip', path.join(dst, 'resources', 'db', 'pgdata.zip')],
    ['audio-library', path.join(dst, 'resources', 'audio-library')],
  ];
  let ok = true;
  for (const [name, p] of checks) {
    const exists = fs.existsSync(p);
    if (!exists) ok = false;
    log(`校验 ${name}: ${exists ? 'OK' : '缺失!'}`);
  }
  try {
    const same = fs.statSync(srcAsar).size === fs.statSync(dstAsar).size;
    log(`校验 asar 与源一致: ${same ? 'OK' : '不一致!'}`);
    if (!same) ok = false;
  } catch { ok = false; }
  const dstVersion = readPkgVersion(dst) || '(未知)';
  log(`版本: 包源 v${srcVersion} / 已装 v${dstVersion} ${srcVersion === dstVersion ? 'OK' : '不一致!'}`);
  if (srcVersion !== dstVersion) ok = false;

  if (!ok) die('校验未全部通过，请检查上方日志');
  log(`✅ 重装完成：v${dstVersion} @ ${dst}`);

  // ---------- 4. 可选启动 ----------
  if (LAUNCH) {
    log('启动应用...');
    spawn(path.join(dst, 'MusicBox.exe'), [], { cwd: dst, detached: true, stdio: 'ignore' }).unref();
    log('已发出启动命令，窗口稍后弹出；验证: curl http://127.0.0.1:49200/api/version');
  }
});
rc.on('error', (e) => die(`robocopy 启动失败: ${e.message}`));
