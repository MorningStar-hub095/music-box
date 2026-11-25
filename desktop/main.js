/**
 * 音乐盒子桌面版 - Electron 主进程
 *
 * 启动编排：
 * 1. 内嵌 PostgreSQL：首次运行解压随应用携带的预初始化集群（含曲库数据），
 *    pg_ctl 管理启停；若被本机安全软件拦截，自动回退连接系统级 PostgreSQL 服务
 * 2. 以 ELECTRON_RUN_AS_NODE 启动后端子进程（Express + Prisma）
 * 3. 轮询 /api/health 就绪后创建窗口，加载同源前端
 */
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn, execFile, execFileSync } = require('child_process');

// ---------------------------------------------------------------------------
// 路径规划
// ---------------------------------------------------------------------------
const isPackaged = app.isPackaged;
const RESOURCES = isPackaged ? process.resourcesPath : __dirname;
// 开发态：desktop/app/{server,web}；打包态：resources/{server,web,db,pgbin}
const SERVER_DIR = isPackaged ? path.join(RESOURCES, 'server') : path.join(RESOURCES, 'app', 'server');
const DB_DIR_RES = isPackaged ? path.join(RESOURCES, 'db') : path.join(RESOURCES, 'resources', 'db');
const PG_BIN = isPackaged
  ? path.join(RESOURCES, 'pgbin', 'bin')
  : path.join(RESOURCES, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin');
const TAR_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

const USER_DATA = app.getPath('userData');
const PG_DATA_DIR = path.join(USER_DATA, 'pgdata');
const INSTANCE_FILE = path.join(USER_DATA, 'instance.json');
const LOG_FILE = path.join(USER_DATA, 'app.log');
const PG_LOG_FILE = path.join(USER_DATA, 'pg.log');
// 回退用：本机系统级 PostgreSQL 服务
const SYSTEM_DATABASE_URL = process.env.MB_SYSTEM_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/music_box';

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (a instanceof Error ? a.stack : a)).join(' ')}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (_) {
    /* ignore */
  }
  process.stdout.write(line);
}

function errText(e) {
  if (!e) return String(e);
  if (typeof e === 'string') return e;
  return [e.message, e.stderr, e.stdout, e.stack].filter(Boolean).join(' | ');
}

// ---------------------------------------------------------------------------
// 启动引导窗口（Splash）
// ---------------------------------------------------------------------------
// 后端就绪前（内嵌 PG + 后端进程 + 健康检查通常需 8~15 秒）主窗口尚不存在，
// 必须先显示引导窗口给用户即时反馈，否则双击图标后长时间“毫无反应”。
let splashWin = null;

function splashHTML(msg) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#05060f;font-family:"Microsoft YaHei",system-ui,sans-serif;
    display:flex;flex-direction:column;align-items:center;justify-content:center;user-select:none}
  .logo{font-size:44px;color:#7c6cff;margin-bottom:14px}
  h1{margin:0 0 10px;font-size:20px;color:#eef0ff;font-weight:600;letter-spacing:2px}
  #msg{margin:0;font-size:13px;color:#8b90b8}
  .bar{width:220px;height:4px;border-radius:2px;background:#1a1c33;margin-top:20px;overflow:hidden}
  .bar i{display:block;height:100%;width:40%;border-radius:2px;background:linear-gradient(90deg,#7c6cff,#41d1c7);
    animation:slide 1.2s ease-in-out infinite}
  @keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
  </style></head><body><div class="logo">&#9835;</div><h1>音乐盒子</h1>
  <p id="msg">${msg}</p><div class="bar"><i></i></div></body></html>`;
}

function showSplash(msg) {
  splashWin = new BrowserWindow({
    width: 420,
    height: 280,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    center: true,
    backgroundColor: '#05060f',
    title: '音乐盒子',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splashWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashHTML(msg)));
  // 启动中途关掉引导窗口 = 用户放弃启动，优雅退出
  splashWin.on('closed', () => {
    splashWin = null;
    if (!mainWindow) app.quit();
  });
}

function splashMsg(msg) {
  if (splashWin && !splashWin.isDestroyed()) {
    splashWin.webContents
      .executeJavaScript(`document.getElementById('msg').textContent=${JSON.stringify(msg)}`)
      .catch(() => {});
  }
}

function closeSplash() {
  if (splashWin && !splashWin.isDestroyed()) splashWin.destroy();
  splashWin = null;
}

// ---------------------------------------------------------------------------
// 端口探测
// ---------------------------------------------------------------------------
function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    const tryNext = () => {
      if (port > startPort + 100) return reject(new Error('no free port'));
      const srv = net.createServer();
      srv.once('error', () => {
        port += 1;
        tryNext();
      });
      srv.once('listening', () => srv.close(() => resolve(port)));
      // 不指定 host，双栈探测（与后端 app.listen(port) 行为一致）：
      // 指定 127.0.0.1 探测时 Windows 下检不出 0.0.0.0/[::] 的通配绑定占用，
      // 会导致选中已被占用的端口、后端子进程 EADDRINUSE 退出
      srv.listen(port);
    };
    tryNext();
  });
}

// ---------------------------------------------------------------------------
// 实例配置（JWT 密钥持久化）
// ---------------------------------------------------------------------------
function loadInstanceConfig() {
  try {
    return JSON.parse(fs.readFileSync(INSTANCE_FILE, 'utf-8'));
  } catch (_) {
    const cfg = {
      jwtSecret: crypto.randomBytes(48).toString('hex'),
      desktopApiKey: crypto.randomBytes(32).toString('hex'),
      // 更新源地址：优先级 env MB_UPDATE_URL > 本文件 updateFeedUrl > 不启用自动更新
      updateFeedUrl: '',
    };
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(INSTANCE_FILE, JSON.stringify(cfg, null, 2));
    return cfg;
  }
}

/** 解析自动更新源地址：环境变量 > 实例配置文件（可由运维手动编辑） */
function resolveUpdateFeedUrl(instance) {
  return (
    process.env.MB_UPDATE_URL ||
    (instance && instance.updateFeedUrl) ||
    ''
  ).trim();
}

// 音频缓存目录：显式环境变量 > 本机现有曲库缓存 > userData
function resolveAudioCacheDir() {
  if (process.env.MB_AUDIO_CACHE_DIR) return process.env.MB_AUDIO_CACHE_DIR;
  const localLibrary = 'D:\\music_box\\data\\audio-cache';
  if (fs.existsSync(localLibrary)) return localLibrary;
  return path.join(USER_DATA, 'audio-cache');
}

// 永久音频曲库目录（2026-11-18 三层供给架构）：
// 打包态随安装包分发（resources/audio-library，内置 CC 授权曲目，不被缓存 LRU 淘汰）；
// 显式环境变量优先，其次本机开发目录，最后 userData。
function resolveAudioLibraryDir() {
  if (process.env.MB_AUDIO_LIBRARY_DIR) return process.env.MB_AUDIO_LIBRARY_DIR;
  const resourcesLib = path.join(RESOURCES, 'audio-library');
  if (fs.existsSync(resourcesLib)) return resourcesLib;
  const localDevLib = 'D:\\music_box\\data\\audio-library';
  if (fs.existsSync(localDevLib)) return localDevLib;
  return path.join(USER_DATA, 'audio-library');
}

// ---------------------------------------------------------------------------
// 内嵌 PostgreSQL
// ---------------------------------------------------------------------------
function execFileAsync(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 120000, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

let pgPort = 54329;

/** 首次运行：解压随应用携带的预初始化集群（含曲库数据，免 initdb/种子恢复） */
function preparePgData() {
  if (fs.existsSync(path.join(PG_DATA_DIR, 'PG_VERSION'))) return;
  log('[PG] 首次运行，解压内置数据库集群...');
  const zip = path.join(DB_DIR_RES, 'pgdata.zip');
  if (!fs.existsSync(zip)) throw new Error(`内置数据库集群缺失: ${zip}`);
  fs.rmSync(PG_DATA_DIR, { recursive: true, force: true });
  const tmpDir = PG_DATA_DIR + '.extracting';
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  // Windows 10+ 自带 bsdtar，原生支持 zip 解压
  // windowsHide: true——GUI 父进程下 spawn 控制台程序会新建可见控制台窗口（首次运行闪黑框）
  execFileSync(TAR_EXE, ['-xf', zip, '-C', tmpDir], { stdio: 'ignore', timeout: 300000, windowsHide: true });
  fs.renameSync(tmpDir, PG_DATA_DIR);
  if (!fs.existsSync(path.join(PG_DATA_DIR, 'PG_VERSION'))) {
    throw new Error('集群解压后缺少 PG_VERSION，压缩包可能损坏');
  }
  log('[PG] 内置集群解压完成');
}

/**
 * 一次协议级就绪探测（与 pg_isready 相同语义）：
 * 发送 StartupMessage（protocol 3.0），按应答判定：
 *  - 'R' Authentication* / 'S' NegotiateProtocolVersion：已可接受新连接 → 就绪；
 *  - 'E' ErrorResponse 且 SQLSTATE 57P03（"the database system is starting up"）：
 *        处于崩溃恢复中 → 未就绪，继续等待；
 *  - 'E' 其他（如密码错误 28P01）：说明已能正常处理协议 → 视为就绪。
 * 不依赖 pg_isready.exe（部署包 pgbin 未携带该二进制），纯 Node 实现。
 */
function pgProbeOnce(port) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch (_) { /* ignore */ }
      resolve(ok);
    };
    const sock = net.connect(port, '127.0.0.1');
    sock.setTimeout(3000, () => done(false));
    sock.once('error', () => done(false));
    sock.once('connect', () => {
      const payload = Buffer.from('user\0postgres\0\0', 'latin1');
      const head = Buffer.alloc(8);
      head.writeInt32BE(8 + payload.length, 0);
      head.writeInt32BE(196608, 4); // protocol version 3.0
      sock.write(Buffer.concat([head, payload]));
    });
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length < 5) return;
      const type = String.fromCharCode(buf[0]);
      if (type === 'R' || type === 'S') return done(true);
      if (type === 'E') return done(!/57P03/.test(buf.toString('latin1')));
      done(false);
    });
  });
}

/**
 * 等待内嵌 PostgreSQL 达到“可接受查询”就绪状态。
 * pg_ctl -w 在本机环境下（CREATE_NO_WINDOW / 管道句柄）返回时机不可靠，
 * 不能依赖它的退出作为“已就绪”信号；TCP 端口监听也不够——崩溃恢复期间
 * 端口已监听但连接会被 57P03 拒绝，必须做协议级探测。
 */
async function waitForPgReady(timeoutMs = 60000) {
  const startedAt = Date.now();
  for (;;) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`内嵌 PostgreSQL 启动超时（${Math.round(timeoutMs / 1000)}s 内未就绪，端口 ${pgPort}）`);
    }
    if (await pgProbeOnce(pgPort)) {
      // 协议层已就绪；再留 300ms 余量给恢复收尾（如 end-of-recovery checkpoint）
      await new Promise((r) => setTimeout(r, 300));
      return;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function startPgServer() {
  // 若上次异常退出残留了运行中的 postgres，先停掉
  try {
    const { stdout } = await execFileAsync(path.join(PG_BIN, 'pg_ctl.exe'), ['-D', PG_DATA_DIR, 'status']);
    if (/server is running/i.test(stdout)) {
      log('[PG] 发现残留实例，先停止...');
      await execFileAsync(path.join(PG_BIN, 'pg_ctl.exe'), ['-D', PG_DATA_DIR, '-m', 'fast', 'stop']);
    }
  } catch (_) {
    /* 未运行 */
  }
  log('[PG] pg_ctl 启动内嵌实例, port=', pgPort);
  // 关键修复（2026-11-16）：pg_ctl / postgres 以 windowsHide（CREATE_NO_WINDOW，即无控制台）
  // 方式启动时，其启动等待逻辑会挂死，实测直到父进程超时才返回（每次恰好 120s，见 app.log）；
  // 管道 stdio 还会让 postgres 继承句柄导致 execFile 等待 EOF。
  // 因此必须用 detached（子进程自带控制台）+ stdio:'ignore' 启动，就绪判定改为自行轮询 TCP。
  const pgctl = spawn(
    path.join(PG_BIN, 'pg_ctl.exe'),
    [
      '-D', PG_DATA_DIR,
      '-l', PG_LOG_FILE,
      '-w', '-t', '60',
      '-o', `-p ${pgPort} -h 127.0.0.1`,
      'start',
    ],
    { detached: true, stdio: 'ignore' }
  );
  pgctl.unref();
  // 崩溃恢复（WAL 重放/checkpoint）实测可达 44~113s，60s 探测会误判超时回退到
  // 系统 5432（可能已被本应用自己停止）导致后端连不上库。放宽到 180s，
  // 与 pg_ctl -t 60 的启动等待解耦（就绪探测是独立的 HTTP 握手循环）。
  await waitForPgReady(180000);
}

async function stopPgServer() {
  try {
    await execFileAsync(path.join(PG_BIN, 'pg_ctl.exe'), ['-D', PG_DATA_DIR, '-m', 'fast', 'stop'], { timeout: 30000 });
    log('[PG] 内嵌实例已停止');
  } catch (e) {
    log('[PG] 停止异常:', errText(e));
  }
}

// ---------------------------------------------------------------------------
// 后端子进程
// ---------------------------------------------------------------------------
let serverProc = null;
let serverPort = 0;

function startBackendChild(instance, audioCacheDir, audioLibraryDir, databaseUrl) {
  return findFreePort(49200).then((port) => {
    serverPort = port;
    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      DATABASE_URL: databaseUrl,
      PORT: String(port),
      JWT_SECRET: instance.jwtSecret,
      DESKTOP_API_KEY: instance.desktopApiKey || crypto.randomBytes(32).toString('hex'),
      AUDIO_CACHE_DIR: audioCacheDir,
      AUDIO_LIBRARY_DIR: audioLibraryDir,
      // LLM 配置等运行时可写持久化文件指向用户数据目录（安装目录在 Program Files 下不可写）
      MB_ENV_FILE: path.join(USER_DATA, 'server.env'),
      TOOLS_DIR: path.join(SERVER_DIR, 'tools-stub'),
      LOG_LEVEL: 'info',
    };
    // 打包内置默认配置合并（v1.4.6）：resources/server.env 提供 JAMENDO_CLIENT_ID 等
    // 出厂默认值；用户 server.env（MB_ENV_FILE）优先级更高（仅补缺，不覆盖显式设置）。
    // Jamendo client_id 是公开应用标识（非密钥），随包分发以开箱即用。
    if (!env.JAMENDO_CLIENT_ID) {
      const bundledEnv = path.join(RESOURCES, 'server.env');
      try {
        if (fs.existsSync(bundledEnv)) {
          for (const line of fs.readFileSync(bundledEnv, 'utf8').split(/\r?\n/)) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
            if (m && !env[m[1]]) env[m[1]] = m[2];
          }
        }
      } catch (_) { /* bundled env 解析失败不阻塞启动 */ }
    }
    log('[SERVER] 启动后端子进程, port=', port, ' audioCache=', audioCacheDir, ' audioLibrary=', audioLibraryDir);
    serverProc = spawn(process.execPath, [path.join(SERVER_DIR, 'dist', 'index.js')], {
      cwd: SERVER_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    serverProc.stdout.on('data', (d) => log('[server:out]', String(d).trim()));
    serverProc.stderr.on('data', (d) => log('[server:err]', String(d).trim()));
    // spawn 失败（如 dist/index.js 缺失）会触发 error 事件，不监听会让健康检查空转到超时
    serverProc.on('error', (err) => {
      log('[SERVER] 后端进程启动失败:', errText(err));
    });
    serverProc.on('exit', (code) => {
      log('[SERVER] 后端进程退出 code=', code);
      serverProc = null;
    });
  });
}

function waitForHealth(timeoutMs = 120000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const tick = () => {
      if (!serverProc && Date.now() - startedAt > 3000) {
        return reject(new Error('后端进程在健康检查期间退出'));
      }
      const req = http.get(`http://127.0.0.1:${serverPort}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
      function retry() {
        if (timedOut) return;
        if (Date.now() - startedAt > timeoutMs) {
          timedOut = true;
          return reject(new Error('健康检查超时'));
        }
        setTimeout(tick, 600);
      }
    };
    tick();
  });
}

// ---------------------------------------------------------------------------
// 版本管理与更新提示
// ---------------------------------------------------------------------------
// 每次应用更新后首次启动时，向后端 /api/version 查询版本与更新日志，
// 与 userData 中记录的「已确认版本」比对：有新版本则弹窗展示更新内容。
// 版本号以 server/src/version.ts 为单一事实来源（scripts/bump-version.js 统一维护）。
const ACK_VERSION_FILE = path.join(USER_DATA, 'acknowledged-version.json');

function loadAcknowledgedVersion() {
  try {
    return JSON.parse(fs.readFileSync(ACK_VERSION_FILE, 'utf-8')).version || null;
  } catch (_) {
    return null;
  }
}

function saveAcknowledgedVersion(version) {
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(
      ACK_VERSION_FILE,
      JSON.stringify({ version, acknowledgedAt: new Date().toISOString() }, null, 2)
    );
  } catch (e) {
    log('[VERSION] 写入已确认版本失败:', errText(e));
  }
}

function compareSemver(a, b) {
  const pa = String(a || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function fetchJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
  });
}

async function checkForUpdates() {
  try {
    const payload = await fetchJson(`http://127.0.0.1:${serverPort}/api/version`);
    const info = payload && payload.data;
    if (!info || !info.version) return;
    const serverVersion = info.version;
    const appVersion = app.getVersion();
    if (compareSemver(serverVersion, appVersion) !== 0) {
      log('[VERSION] 应用版本', appVersion, '与后端版本', serverVersion, '不一致');
    }

    const acknowledged = loadAcknowledgedVersion();
    if (acknowledged === serverVersion) return; // 已提示过，不再打扰

    // 取出「已确认版本」之后的更新日志
    const base = acknowledged || '0.0.0';
    const entries = (info.changelog || [])
      .filter((e) => compareSemver(e.version, base) > 0)
      .sort((a, b) => compareSemver(b.version, a.version));
    const isUpdate = acknowledged !== null && compareSemver(serverVersion, acknowledged) > 0;

    const detailLines = entries.length
      ? entries.flatMap((e) => [`【v${e.version}（${e.date}）】`, ...e.changes.map((c) => `  • ${c}`)])
      : [`当前版本 v${serverVersion}`];

    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: isUpdate ? '音乐盒子已更新' : '欢迎使用音乐盒子',
      message: isUpdate ? `已更新到 v${serverVersion}` : `音乐盒子 v${serverVersion}`,
      detail: detailLines.join('\n'),
      buttons: ['好的'],
    });
    log('[VERSION] 更新提示完成:', acknowledged || '(首次运行)', '->', serverVersion);
    saveAcknowledgedVersion(serverVersion);
  } catch (e) {
    // 版本检查失败不阻塞主流程
    log('[VERSION] 版本检查失败:', errText(e));
  }
}

// ---------------------------------------------------------------------------
// 自动版本更新（electron-updater）
// ---------------------------------------------------------------------------
// 流程：启动后检查更新源（generic provider，latest.yml 元数据）→ 发现新版本
// → 征询用户 → 自动下载（支持 blockmap 差量下载与 sha512 完整性校验）
// → 用户确认后退出并静默安装；用户选「稍后」则在应用退出时自动安装。
//
// 稳定性保障：
//  - 仅打包态（app.isPackaged）且配置了更新源时启用，开发态与未配置时完全跳过；
//  - 任何更新环节的失败只写日志，绝不阻塞启动/关闭主流程；
//  - electron-updater 校验 latest.yml 中的 sha512，损坏的更新包会被拒绝安装；
//  - 本会话内用户拒绝后不再重复弹窗。
let autoUpdater = null;
let userPostponedUpdate = false;

function initAutoUpdater(instance) {
  const feedUrl = resolveUpdateFeedUrl(instance);
  if (!isPackaged) {
    log('[UPDATE] 开发态跳过自动更新');
    return;
  }
  if (!feedUrl) {
    log('[UPDATE] 未配置更新源（MB_UPDATE_URL 或 instance.json updateFeedUrl），跳过自动更新');
    return;
  }

  try {
    const { autoUpdater: updater } = require('electron-updater');
    autoUpdater = updater;
  } catch (e) {
    log('[UPDATE] electron-updater 加载失败，跳过自动更新:', errText(e));
    return;
  }

  autoUpdater.logger = null; // 统一走本文件 log，避免重复输出
  autoUpdater.autoDownload = false; // 发现新版本先征询用户，不静默下载
  autoUpdater.autoInstallOnAppQuit = true; // 「稍后」场景：退出时自动完成安装
  autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl, channel: 'latest' });
  log('[UPDATE] 自动更新已启用, feed=', feedUrl, ' 当前版本=', app.getVersion());

  autoUpdater.on('update-available', async (info) => {
    if (userPostponedUpdate) return;
    try {
      const remoteVersion = info && info.version;
      if (!remoteVersion) return;
      log('[UPDATE] 发现新版本:', remoteVersion);
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '发现新版本',
        message: `音乐盒子 ${remoteVersion} 可用（当前 v${app.getVersion()}）`,
        detail: '可立即下载更新。下载完成后需要退出应用并完成安装，期间不会丢失数据。',
        buttons: ['立即更新', '稍后（退出时自动安装）'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) {
        log('[UPDATE] 用户确认，开始下载更新...');
        await autoUpdater.downloadUpdate();
      } else {
        userPostponedUpdate = true;
        log('[UPDATE] 用户选择稍后，应用退出时将自动安装');
      }
    } catch (e) {
      log('[UPDATE] 处理新版本提示失败:', errText(e));
    }
  });

  autoUpdater.on('download-progress', (p) => {
    // 节流：每 20% 记一条日志
    const percent = Math.floor(p.percent || 0);
    if (percent > 0 && percent % 20 < 2) {
      log(`[UPDATE] 下载进度 ${percent}%（${Math.round((p.transferred || 0) / 1024 / 1024)}MB / ${Math.round((p.total || 0) / 1024 / 1024)}MB）`);
    }
  });

  autoUpdater.on('update-downloaded', async (info) => {
    try {
      log('[UPDATE] 更新包下载完成:', info && info.version);
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '更新就绪',
        message: `更新包下载完成（v${info && info.version}）`,
        detail: '是否立即重启并安装？选择「稍后」将在本次退出时自动完成安装。',
        buttons: ['立即重启安装', '稍后'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) {
        // isSilent=true：辅助安装器（oneClick:false）推荐静默安装；isForceRunAfter=true：装完自动重启
        setImmediate(() => autoUpdater.quitAndInstall(true, true));
      } else {
        userPostponedUpdate = true; // autoInstallOnAppQuit 已兜底
        log('[UPDATE] 用户选择稍后安装，退出时自动完成');
      }
    } catch (e) {
      log('[UPDATE] 更新就绪处理失败:', errText(e));
    }
  });

  autoUpdater.on('error', (e) => {
    // 任何更新错误只记录，不影响应用正常运行
    log('[UPDATE] 自动更新错误:', errText(e));
  });

  // 延迟数秒检查，避开启动高峰；失败静默
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => {
      log('[UPDATE] 检查更新失败（不影响使用）:', errText(e));
    });
  }, 5000);
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#05060f',
    autoHideMenuBar: true,
    title: '音乐盒子',
    icon: isPackaged ? undefined : path.join(RESOURCES, 'build', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once('ready-to-show', () => {
    closeSplash();
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.loadURL(`http://localhost:${serverPort}/`).catch((err) => {
    log('[WINDOW] 加载失败:', errText(err));
    dialog.showErrorBox('启动失败', '后端服务未能就绪，请重启应用。');
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------
let shuttingDown = false;

async function shutdown(useEmbeddedPg) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('[QUIT] 开始优雅关闭...');
  if (serverProc) {
    try {
      serverProc.kill();
    } catch (_) {
      /* ignore */
    }
  }
  if (useEmbeddedPg) await stopPgServer();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // 进程清理状态在顶层维护：启动失败路径也要能停掉已启动的内嵌 PostgreSQL
  let useEmbeddedPg = true;

  // before-quit 在顶层注册：app.exit() 会跳过退出事件，但用户正常关窗口
  // （包括启动中途）都必须走到这里的优雅关闭逻辑
  app.on('before-quit', (e) => {
    if (!shuttingDown) {
      e.preventDefault();
      shutdown(useEmbeddedPg).finally(() => setTimeout(() => app.exit(0), 300));
      // 兜底强制退出：需大于 stopPgServer 的 30s pg_ctl 超时，否则 PG 会被半途强杀残留
      setTimeout(() => app.exit(0), 45000);
    }
  });

  app.whenReady().then(async () => {
    const instance = loadInstanceConfig();
    const audioCacheDir = resolveAudioCacheDir();
    const audioLibraryDir = resolveAudioLibraryDir();
    let databaseUrl = '';
    showSplash('正在启动数据库...');
    try {
      log('[BOOT] 音乐盒子桌面版启动, userData=', USER_DATA);
      log('[BOOT] PG_BIN=', PG_BIN, ' SERVER_DIR=', SERVER_DIR);
      log('[BOOT] audioCache=', audioCacheDir, ' audioLibrary=', audioLibraryDir);
      if (!fs.existsSync(path.join(PG_BIN, 'pg_ctl.exe'))) {
        throw new Error(`内嵌 PostgreSQL 二进制缺失: ${PG_BIN}`);
      }
      pgPort = await findFreePort(54329);
      preparePgData();
      try {
        await startPgServer();
        databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${pgPort}/music_box`;
        log('[PG] 内嵌实例已就绪');
      } catch (e) {
        // 本机安全软件拦截内嵌 PG 时，回退连接系统级服务
        useEmbeddedPg = false;
        databaseUrl = SYSTEM_DATABASE_URL;
        log('[PG] 内嵌实例启动失败，回退系统 PostgreSQL 服务:', errText(e));
      }
      splashMsg('正在启动后端服务...');
      await startBackendChild(instance, audioCacheDir, audioLibraryDir, databaseUrl);
      await waitForHealth();
      log('[BOOT] 后端就绪, 创建窗口 http://127.0.0.1:' + serverPort);
      splashMsg('即将完成...');
      Menu.setApplicationMenu(null);
      createWindow();
      // 更新提示（异步，不阻塞窗口创建）
      checkForUpdates();
      // 自动版本更新（仅打包态且配置了更新源时启用）
      initAutoUpdater(instance);
    } catch (err) {
      // 启动失败：显式优雅关闭（停后端 + 停内嵌 PG）后再退出。
      // 注意不能用 app.exit() 直接退出——它会跳过 before-quit，导致 postgres.exe 孤儿残留
      log('[BOOT] 启动失败:', errText(err));
      try {
        await shutdown(useEmbeddedPg);
      } catch (e) {
        log('[BOOT] 关闭清理异常:', errText(e));
      }
      closeSplash();
      dialog.showErrorBox('音乐盒子启动失败', errText(err).slice(0, 800));
      app.exit(1);
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  process.on('uncaughtException', (err) => {
    log('[CRASH] 未捕获异常:', errText(err));
  });
}
