/**
 * 缓存恢复对账（2026-11-16 事故恢复）
 * 背景：测试误触 migrateCacheDir 自迁移导致主缓存 727 文件丢失；已从 D:\data\audio-cache 旧副本恢复 506 个。
 * 本脚本：① 对恢复集做试听片段复查；② 删除归档死歌对应的缓存文件（与用户确认的归档口径一致）；
 *         ③ 统计有效口径下仍缺缓存的曲目数。
 */
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 54329;
const DATA = path.join(process.env.APPDATA, 'MusicBox', 'pgdata');
const PGBIN = 'D:/music_box/部署包-20261111/MusicBox/resources/pgbin/bin';
const CACHE_DIR = 'D:/music_box/data/audio-cache';

function pgProbeOnce(port) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => { if (!settled) { settled = true; try { sock.destroy(); } catch (_) {} resolve(ok); } };
    const sock = require('net').connect(port, '127.0.0.1');
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
    ['-D', DATA, '-l', path.join(DATA, '..', 'reconcile-pg.log'), '-w', '-t', '60', '-o', `-p ${PORT} -h 127.0.0.1`, 'start'],
    { detached: true, stdio: 'ignore' });
  ctl.unref();
  const t0 = Date.now();
  for (;;) {
    if (await pgProbeOnce(PORT)) break;
    if (Date.now() - t0 > 45000) throw new Error('真实 PG 启动超时');
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log('[PG] 就绪');

  const { Client } = require('D:/music_box/desktop/node_modules/pg');
  const client = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'music_box' });
  await client.connect();
  const Q = (sql, p) => client.query(sql, p).then((r) => r.rows);
  const songs = await Q(`SELECT id, title, playable, archived, duration FROM songs`);
  const byStem = new Map(songs.map((s) => [s.id.replace(/[^a-zA-Z0-9_-]/g, '_'), s]));

  let files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.mp3'));
  console.log('恢复集文件数:', files.length);

  // ① 片段复查
  let clips = 0;
  for (const f of files) {
    const s = byStem.get(f.slice(0, -4));
    if (!s || !s.duration || s.duration < 30 || s.duration > 7200) continue;
    const size = fs.statSync(path.join(CACHE_DIR, f)).size;
    if (size < s.duration * 10 * 1024) { fs.unlinkSync(path.join(CACHE_DIR, f)); clips++; }
  }
  console.log('片段复查删除:', clips);

  // ② 归档死歌的缓存文件（与归档口径一致，保持曲库口径干净）
  files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.mp3'));
  let removedArchived = 0;
  for (const f of files) {
    const s = byStem.get(f.slice(0, -4));
    if (s && s.archived) { fs.unlinkSync(path.join(CACHE_DIR, f)); removedArchived++; }
  }
  console.log('归档死歌缓存删除:', removedArchived);

  // ③ 覆盖率统计
  files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.mp3'));
  const stems = new Set(files.map((f) => f.slice(0, -4)));
  const active = songs.filter((s) => !s.archived);
  const activePlayable = active.filter((s) => s.playable);
  const cachedPlayable = activePlayable.filter((s) => stems.has(s.id.replace(/[^a-zA-Z0-9_-]/g, '_')));
  const missingPlayable = activePlayable.length - cachedPlayable.length;
  let size = 0;
  for (const f of files) size += fs.statSync(path.join(CACHE_DIR, f)).size;
  console.log(`\n=== 恢复后状态 ===`);
  console.log(`缓存文件: ${files.length} 个, ${(size / 1048576).toFixed(0)} MB`);
  console.log(`有效曲库: ${active.length} 首 (playable ${activePlayable.length})`);
  console.log(`playable 已缓存: ${cachedPlayable.length}/${activePlayable.length}, 仍缺 ${missingPlayable} 首`);
  const missing = activePlayable.filter((s) => !stems.has(s.id.replace(/[^a-zA-Z0-9_-]/g, '_')));
  fs.writeFileSync('D:/music_box/docs/恢复后待重下载清单.json',
    JSON.stringify(missing.map((s) => ({ id: s.id, title: s.title })), null, 2), 'utf8');
  console.log('缺失清单已写入 docs/恢复后待重下载清单.json');

  await client.end();
  await new Promise((resolve) => {
    execFile(path.join(PGBIN, 'pg_ctl.exe'), ['-D', DATA, '-m', 'fast', 'stop'], { windowsHide: true, timeout: 30000 }, () => resolve());
  });
  console.log('[PG] 已停止');
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
