/** 实验：pg_ctl detached 启动后 postgres 保持运行 25s，期间用外部轮询观察窗口 */
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

const PORT = parseInt(process.argv[2], 10);
const DATA = process.argv[3];
const PGBIN = process.argv[4];
const LOG = path.join(DATA, '..', 'experiment-pg2.log');

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

async function main() {
  fs.writeFileSync(LOG, '');
  const child = spawn(
    path.join(PGBIN, 'pg_ctl.exe'),
    ['-D', DATA, '-l', LOG, '-w', '-t', '60', '-o', `-p ${PORT} -h 127.0.0.1`, 'start'],
    { detached: true, stdio: 'ignore' }
  );
  child.unref();
  const t0 = Date.now();
  for (;;) {
    if (await pgProbeOnce(PORT)) { console.log(`READY ${((Date.now() - t0) / 1000).toFixed(1)}s`); break; }
    if (Date.now() - t0 > 30000) { console.log('TIMEOUT'); process.exit(1); }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log('PG_KEPT_ALIVE_25S — 请立即运行窗口轮询');
  await new Promise((r) => setTimeout(r, 25000));
  await new Promise((resolve) => {
    execFile(path.join(PGBIN, 'pg_ctl.exe'), ['-D', DATA, '-m', 'fast', 'stop'], { windowsHide: true, timeout: 30000 }, () => resolve());
  });
  console.log('STOPPED');
}
main();
