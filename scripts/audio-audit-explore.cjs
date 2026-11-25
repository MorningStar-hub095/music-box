/** 探查 pgdata 副本中的数据库与表 */
const { spawn, execFile } = require('child_process');
const path = require('path');
const net = require('net');

const PORT = 55441;
const DATA = 'C:/Users/Lenovo/AppData/Local/Temp/pgtest';
const PGBIN = 'D:/music_box/部署包-20261111/MusicBox/resources/pgbin/bin';

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
  const ctl = spawn(path.join(PGBIN, 'pg_ctl.exe'),
    ['-D', DATA, '-l', path.join(DATA, '..', 'audit-pg2.log'), '-w', '-t', '60', '-o', `-p ${PORT} -h 127.0.0.1`, 'start'],
    { detached: true, stdio: 'ignore' });
  ctl.unref();
  const t0 = Date.now();
  for (;;) {
    if (await pgProbeOnce(PORT)) break;
    if (Date.now() - t0 > 40000) throw new Error('PG 启动超时');
    await new Promise((r) => setTimeout(r, 400));
  }
  const { Client } = require('D:/music_box/desktop/node_modules/pg');
  const admin = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
  await admin.connect();
  const dbs = await admin.query(`SELECT datname FROM pg_database WHERE datistemplate = false`);
  console.log('databases:', dbs.rows.map((r) => r.datname).join(', '));
  await admin.end();
  for (const db of dbs.rows.map((r) => r.datname)) {
    const c = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: db });
    try {
      await c.connect();
      const tables = await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`);
      console.log(`\n[${db}] tables:`, tables.rows.map((r) => r.table_name).join(', ') || '(无)');
      await c.end();
    } catch (e) { console.log(`[${db}] 连接失败: ${e.message}`); }
  }
  await new Promise((resolve) => {
    execFile(path.join(PGBIN, 'pg_ctl.exe'), ['-D', DATA, '-m', 'fast', 'stop'], { windowsHide: true, timeout: 30000 }, () => resolve());
  });
  console.log('[PG] stopped');
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
