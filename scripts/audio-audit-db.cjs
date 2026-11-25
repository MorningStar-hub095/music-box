/** 音频缓存与数据库交叉审计：启动内嵌 PG（副本）→ 查询 Song 表 → 比对缓存目录 → 停库 */
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

const PORT = 55440;
const DATA = 'C:/Users/Lenovo/AppData/Local/Temp/pgtest';
const PGBIN = 'D:/music_box/部署包-20261111/MusicBox/resources/pgbin/bin';
const CACHE_DIR = 'D:/music_box/data/audio-cache';

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

function q(pgPool, sql) {
  return pgPool.query(sql).then((r) => r.rows);
}

async function main() {
  // 1. 启动 PG（detached 方式，与桌面版一致）
  const ctl = spawn(path.join(PGBIN, 'pg_ctl.exe'),
    ['-D', DATA, '-l', path.join(DATA, '..', 'audit-pg.log'), '-w', '-t', '60', '-o', `-p ${PORT} -h 127.0.0.1`, 'start'],
    { detached: true, stdio: 'ignore' });
  ctl.unref();
  const t0 = Date.now();
  for (;;) {
    if (await pgProbeOnce(PORT)) break;
    if (Date.now() - t0 > 40000) throw new Error('PG 启动超时');
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log('[PG] ready on', PORT);

  const { Client } = require('D:/music_box/desktop/node_modules/pg');
  const client = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'music_box' });
  await client.connect();

  const total = await q(client, `SELECT count(*)::int AS n FROM "Song"`);
  const byPlatform = await q(client, `SELECT COALESCE(platform,'(null)') AS p, count(*)::int AS n FROM "Song" GROUP BY 1 ORDER BY 2 DESC`);
  const bySource = await q(client, `SELECT COALESCE("dataSource",'(null)') AS s, count(*)::int AS n FROM "Song" GROUP BY 1`);
  const playable = await q(client, `SELECT playable, count(*)::int AS n FROM "Song" GROUP BY 1`);
  const archived = await q(client, `SELECT archived, count(*)::int AS n FROM "Song" GROUP BY 1`);
  const idPattern = await q(client, `SELECT count(*)::int AS n FROM "Song" WHERE id ~ '^(netease|qq|manual|kugou)_?'`);
  const durations = await q(client, `SELECT count(*)::int AS n FROM "Song" WHERE duration IS NULL`);
  const durationStats = await q(client, `SELECT min(duration)::int AS min, max(duration)::int AS max, avg(duration)::int AS avg FROM "Song" WHERE duration IS NOT NULL`);

  // 2. 缓存目录比对（trackIdToFilename: 非法字符替换为 _，后缀 .mp3）
  const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.mp3'));
  const fileStems = new Set(files.map((f) => f.slice(0, -4)));

  const idRows = await q(client, `SELECT id, title, artist, platform, "dataSource" AS src, playable, archived, duration, "playCount" AS plays FROM "Song"`);
  const dbIds = new Set(idRows.map((r) => r.id));
  const toFilename = (id) => id.replace(/[^a-zA-Z0-9_-]/g, '_');

  const orphans = files.filter((f) => !dbIds.has(f.slice(0, -4)));            // 缓存有、库里没有
  const missing = idRows.filter((r) => !fileStems.has(toFilename(r.id)));     // 库里有、缓存没有

  // 播放量 top（缓存命中热点）
  const topPlays = idRows.slice().sort((a, b) => (b.plays || 0) - (a.plays || 0)).slice(0, 5)
    .map((r) => `${r.plays}次 ${r.title} - ${r.artist}`);

  console.log('\n=== 数据库概览 ===');
  console.log('歌曲总数:', total[0].n);
  console.log('按平台:', JSON.stringify(byPlatform));
  console.log('按来源(dataSource):', JSON.stringify(bySource));
  console.log('playable:', JSON.stringify(playable), ' archived:', JSON.stringify(archived));
  console.log('duration 缺失:', durations[0].n, '条; 范围:', JSON.stringify(durationStats[0]));
  console.log('\n=== 缓存比对 ===');
  console.log('缓存文件数:', files.length);
  console.log('孤儿缓存(缓存有/库无):', orphans.length);
  orphans.slice(0, 15).forEach((f) => console.log('   ', f));
  console.log('库中有但缓存缺失:', missing.length);
  missing.slice(0, 10).forEach((r) => console.log(`    [${r.platform}/${r.src}] ${r.id} ${r.title} - ${r.artist}`));
  console.log('\n播放量TOP5:', topPlays.join(' | '));

  await client.end();
  await new Promise((resolve) => {
    execFile(path.join(PGBIN, 'pg_ctl.exe'), ['-D', DATA, '-m', 'fast', 'stop'], { windowsHide: true, timeout: 30000 }, () => resolve());
  });
  console.log('[PG] stopped');
}

main().catch((e) => { console.error('AUDIT_FAIL:', e.message); process.exit(1); });
