/**
 * 受控实验：不同的 PostgreSQL 启动方式
 *   1) TCP 协议级就绪探测（等价 pg_isready）
 *   2) 子进程是否拥有可见控制台窗口（MainWindowHandle != 0）
 *
 * 用法: node pg-launch-experiment.cjs <mode> <port>
 *   mode: pgctl-detached       = spawn pg_ctl detached:true stdio:'ignore'        （v1.4.1 现状）
 *         pgctl-detached-hide  = spawn pg_ctl detached:true windowsHide:true      （候选修复 F）
 *         postgres-direct      = spawn postgres.exe windowsHide:true              （候选修复 G）
 */
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

const MODE = process.argv[2];
const PORT = parseInt(process.argv[3], 10);
const DATA = process.argv[4];
const PGBIN = process.argv[5];
const LOG = path.join(DATA, '..', 'experiment-pg.log');

function log(...a) { console.log(new Date().toISOString().slice(11, 19), ...a); }

function pgProbeOnce(port) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => { if (!settled) { settled = true; try { sock.destroy(); } catch (_) {} resolve(ok); } };
    const sock = net.connect(port, '127.0.0.1');
    sock.setTimeout(3000, () => done(false));
    sock.once('error', () => done(false));
    sock.once('connect', () => {
      const payload = Buffer.from('user\0postgres\0\0', 'latin1');
      const head = Buffer.alloc(8);
      head.writeInt32BE(8 + payload.length, 0);
      head.writeInt32BE(196608, 4);
      sock.write(Buffer.concat([head, payload]));
    });
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length < 5) return;
      const t = String.fromCharCode(buf[0]);
      if (t === 'R' || t === 'S') return done(true);
      if (t === 'E') return done(!/57P03/.test(buf.toString('latin1')));
      done(false);
    });
  });
}

async function waitReady(timeoutMs = 30000, child) {
  const t0 = Date.now();
  for (;;) {
    if (child && child.exitCode !== null && child.exitCode !== 0) {
      log(`子进程已提前退出 code=${child.exitCode}`);
      return false;
    }
    if (Date.now() - t0 > timeoutMs) return false;
    if (await pgProbeOnce(PORT)) { log(`TCP 协议就绪，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`); return true; }
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** 列出 postgres.exe / pg_ctl.exe 进程的 MainWindowHandle（非 0 = 有可见窗口） */
function checkWindows() {
  return new Promise((resolve) => {
    const ps = `Get-Process postgres,pg_ctl -ErrorAction SilentlyContinue | Select-Object Name,Id,MainWindowHandle | ConvertTo-Json -Compress; exit 0`;
    execFile('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 15000 }, (err, stdout) => {
      resolve(err ? '(探测失败 ' + err.message.slice(0, 80) + ')' : stdout.trim() || '(无进程)');
    });
  });
}

async function main() {
  fs.writeFileSync(LOG, '');
  log(`MODE=${MODE} PORT=${PORT}`);
  log('启动前进程状态:', await checkWindows());

  let child;
  if (MODE === 'pgctl-detached' || MODE === 'pgctl-detached-hide') {
    const opts = { detached: true, stdio: 'ignore' };
    if (MODE === 'pgctl-detached-hide') opts.windowsHide = true;
    child = spawn(
      path.join(PGBIN, 'pg_ctl.exe'),
      ['-D', DATA, '-l', LOG, '-w', '-t', '60', '-o', `-p ${PORT} -h 127.0.0.1`, 'start'],
      opts
    );
    child.unref();
  } else if (MODE === 'postgres-direct') {
    const fd = fs.openSync(LOG, 'a');
    child = spawn(
      path.join(PGBIN, 'postgres.exe'),
      ['-D', DATA, '-p', String(PORT), '-h', '127.0.0.1'],
      { windowsHide: true, stdio: ['ignore', fd, fd], detached: false }
    );
    child.on('exit', (code, sig) => log(`postgres.exe 进程退出 code=${code} sig=${sig}`));
  } else {
    console.error('未知模式'); process.exit(2);
  }

  const ok = await waitReady(30000, child);
  log('就绪?', ok);
  await new Promise((r) => setTimeout(r, 800));
  log('启动后进程状态(看 MainWindowHandle):', await checkWindows());

  if (ok) {
    await new Promise((resolve) => {
      execFile(path.join(PGBIN, 'pg_ctl.exe'), ['-D', DATA, '-m', 'fast', 'stop'],
        { windowsHide: true, timeout: 30000 }, (err, stdout, stderr) => {
          log('pg_ctl stop:', err ? ('失败 ' + err.message.slice(0, 100)) : 'OK');
          resolve();
        });
    });
  }
  log('结束进程状态:', await checkWindows());
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
