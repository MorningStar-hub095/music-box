// 精确统计清理口径
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

const CACHE_DIR = 'D:/music_box/data/audio-cache';
const toFilename = (id) => id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.mp3';

async function main() {
  const cacheFiles = new Set(fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.mp3')));
  const songs = await prisma.$queryRawUnsafe(`select id, platform, title, artist, playable, archived, duration, data_source, audio_url from songs`);
  const cached = songs.filter(s => cacheFiles.has(toFilename(s.id)));
  const notCached = songs.filter(s => !cacheFiles.has(toFilename(s.id)));

  console.log('songs total:', songs.length);
  console.log('cached:', cached.length, '| not cached:', notCached.length);
  console.log('cached ∧ playable=true:', cached.filter(s => s.playable).length);
  console.log('cached ∧ playable=false:', cached.filter(s => !s.playable).length);
  console.log('notCached ∧ playable=true:', notCached.filter(s => s.playable).length);
  console.log('notCached ∧ archived=true:', notCached.filter(s => s.archived).length);
  console.log('notCached ∧ archived=false:', notCached.filter(s => !s.archived).length);
  console.log('notCached by source:', JSON.stringify(notCached.reduce((a, s) => (a[s.data_source] = (a[s.data_source]||0)+1, a), {})));
  console.log('cached by source:', JSON.stringify(cached.reduce((a, s) => (a[s.data_source] = (a[s.data_source]||0)+1, a), {})));

  // manual 歌曲详情
  console.log('--- manual 歌曲 ---');
  for (const s of songs.filter(s => s.data_source === 'manual')) {
    console.log(s.id, '|', s.title, '|', s.artist, '| playable=' + s.playable, '| cached=' + cacheFiles.has(toFilename(s.id)), '| dur=' + s.duration);
  }

  // 缓存但时长为空或异常的（可修复项）
  const measured = JSON.parse(fs.readFileSync('D:/music_box/output/cache-check-20261117.json'));
  const byFile = new Map(measured.map(r => [r.file, r]));
  let fixDurNull = 0, fixDurWrong = 0;
  const wrongList = [];
  for (const s of cached) {
    const m = byFile.get(toFilename(s.id));
    if (!m || m.seconds == null) continue;
    if (s.duration == null) fixDurNull++;
    else if (Math.abs(s.duration - m.seconds) > 10) { fixDurWrong++; wrongList.push(`${s.id} db=${s.duration} actual=${m.seconds}`); }
  }
  console.log('缓存歌曲时长需回填(null):', fixDurNull, '| 需修正(差>10s):', fixDurWrong);
  console.log(wrongList.slice(0, 12).join('\n'));

  // tracks.json 与 DB 重合
  const t = require('D:/music_box/shared/tracks.json');
  const dbIds = new Set(songs.map(s => s.id));
  const inDb = t.filter(x => dbIds.has(x.id));
  const cachedTracks = inDb.filter(x => cacheFiles.has(toFilename(x.id)));
  console.log('tracks.json:', t.length, '| 在DB中:', inDb.length, '| 且有缓存:', cachedTracks.length);
  const orphan = t.filter(x => !dbIds.has(x.id));
  console.log('tracks.json 不在DB中(前端孤儿数据):', orphan.length, orphan.slice(0, 5).map(x => x.id));

  // listening_events 引用将被删除歌曲的数量
  const deadIds = new Set(notCached.map(s => s.id));
  const ev = await prisma.$queryRawUnsafe(`select song_id, count(*)::int n from listening_events group by 1`);
  const evDead = ev.filter(r => deadIds.has(r.song_id)).reduce((a, r) => a + r.n, 0);
  console.log('listening_events 总数引用死歌的行数:', evDead, '/', ev.reduce((a, r) => a + r.n, 0));
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
