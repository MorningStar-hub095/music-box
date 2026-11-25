/**
 * 音频清理执行脚本（2026-11-16，用户已确认）
 * 1. 试听片段判定并删除：duration∈[30,7200]s 且 size < duration×10KB/s（≈80kbps 均码率下不可能装下完整时长）
 * 2. 死歌归档：UPDATE songs SET archived=true WHERE playable=false 且无本地缓存文件
 * 对真实内嵌数据库（%APPDATA%/MusicBox/pgdata，端口 54329）操作，操作完自动停库。
 */
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 54329;
const DATA = path.join(process.env.APPDATA, 'MusicBox', 'pgdata');
const PGBIN = 'D:/music_box/部署包-20261111/MusicBox/resources/pgbin/bin';
const CACHE_DIR = 'D:/music_box/data/audio-cache';
const LOG = 'D:/music_box/docs/音频清理执行记录-2026-11-16.md';

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
  // 启动真实库
  const ctl = spawn(path.join(PGBIN, 'pg_ctl.exe'),
    ['-D', DATA, '-l', path.join(DATA, '..', 'cleanup-pg.log'), '-w', '-t', '60', '-o', `-p ${PORT} -h 127.0.0.1`, 'start'],
    { detached: true, stdio: 'ignore' });
  ctl.unref();
  const t0 = Date.now();
  for (;;) {
    if (await pgProbeOnce(PORT)) break;
    if (Date.now() - t0 > 45000) throw new Error('真实 PG 启动超时');
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log('[PG] 真实库已就绪 (54329)');

  const { Client } = require('D:/music_box/desktop/node_modules/pg');
  const client = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'music_box' });
  await client.connect();
  const Q = (sql, p) => client.query(sql, p).then((r) => r.rows);

  const songs = await Q(`SELECT id, title, artist, playable, archived, duration FROM songs`);
  const byStem = new Map(songs.map((s) => [s.id.replace(/[^a-zA-Z0-9_-]/g, '_'), s]));

  // ---- 1. 试听片段判定 ----
  const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.mp3'));
  const clips = [];
  for (const f of files) {
    const s = byStem.get(f.slice(0, -4));
    if (!s || !s.duration) continue;
    if (s.duration < 30 || s.duration > 7200) continue; // 时长不可信的脏数据跳过
    const size = fs.statSync(path.join(CACHE_DIR, f)).size;
    // 80kbps 均码率也装不下完整时长 ⇒ 必为片段
    if (size < s.duration * 10 * 1024) {
      clips.push({ file: f, size, duration: s.duration, title: s.title, artist: s.artist, playable: s.playable });
    }
  }
  const clipBytes = clips.reduce((a, c) => a + c.size, 0);
  console.log(`\n=== 试听片段判定：${clips.length} 个文件，共 ${(clipBytes / 1048576).toFixed(1)} MB ===`);
  for (const c of clips) {
    console.log(`  删除 ${c.file}  ${c.size}B  DB时长=${c.duration}s  「${c.title}」${c.artist}`);
    fs.unlinkSync(path.join(CACHE_DIR, c.file));
  }

  // ---- 2. 死歌归档 ----
  const remaining = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.mp3'));
  const cachedStems = new Set(remaining.map((f) => f.slice(0, -4)));
  const dead = songs.filter((s) => !s.playable && !s.archived && !cachedStems.has(s.id.replace(/[^a-zA-Z0-9_-]/g, '_')));
  console.log(`\n=== 死歌归档（playable=false 且无缓存且未归档）：${dead.length} 首 ===`);
  if (dead.length > 0) {
    await client.query(`UPDATE songs SET archived = true WHERE id = ANY($1)`, [dead.map((d) => d.id)]);
  }
  const after = await Q(`SELECT count(*)::int AS n FROM songs WHERE archived = true`);
  const stillAlive = await Q(`SELECT count(*)::int AS n FROM songs WHERE archived = false`);
  console.log(`归档后：archived=true 共 ${after[0].n} 首，曲库有效口径 ${stillAlive[0].n} 首`);

  // 汇总留档
  const md = [
    '# 音频清理执行记录（2026-11-16 18:00）',
    '',
    '用户确认方案：① music/ 与 web-public-audio-backup 归档到仓库外后删除；② 试听片段直接删除；③ 死歌归档；④ 实现缓存上限。',
    '',
    '## 1. 重复文件归档',
    '- `music/`（6 文件）与 `data/web-public-audio-backup/`（6 文件）→ 已移至 `D:\\music_box-archive\\2026-11-16-音频归档\\`（共 72.2MB，仓库内已删除）',
    '',
    `## 2. 试听片段删除（${clips.length} 个，${(clipBytes / 1048576).toFixed(1)} MB）`,
    '',
    '| 文件 | 大小 | DB时长(s) | 歌曲 | 歌手 |',
    '|---|---|---|---|---|',
    ...clips.map((c) => `| ${c.file} | ${c.size} | ${c.duration} | ${c.title} | ${c.artist} |`),
    '',
    `## 3. 死歌归档（${dead.length} 首 → archived=true）`,
    `- 归档后曲库有效口径：${stillAlive[0].n} 首（archived=${after[0].n}）`,
    '',
    '## 4. 缓存上限策略',
    '- 已实现：`AUDIO_CACHE_MAX_MB`（默认 5120MB）+ LRU 磁盘淘汰，见 v1.4.3 CHANGELOG。',
  ].join('\n');
  fs.writeFileSync(LOG, md, 'utf8');
  console.log('\n执行记录已写入', LOG);

  await client.end();
  await new Promise((resolve) => {
    execFile(path.join(PGBIN, 'pg_ctl.exe'), ['-D', DATA, '-m', 'fast', 'stop'], { windowsHide: true, timeout: 30000 }, () => resolve());
  });
  console.log('[PG] 已停止');
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
