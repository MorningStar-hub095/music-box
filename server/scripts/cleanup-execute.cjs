// 主清理脚本：删除无缓存死歌 + 修正 playable/时长 + 清除失效 URL + 回填特征
// 前置：已全库备份至 D:/music_box/output/db-backup-20261117
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

const CACHE_DIR = 'D:/music_box/data/audio-cache';
const toFilename = (id) => id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.mp3';

async function main() {
  const cacheFiles = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.mp3'));
  const cachedSet = new Set(cacheFiles.map(f => f.replace(/\.mp3$/, '')));
  const measured = JSON.parse(fs.readFileSync('D:/music_box/output/cache-check-20261117.json'));
  const durBySong = new Map(measured.filter(r => r.seconds != null).map(r => [r.songId, Math.round(r.seconds)]));

  const songs = await prisma.$queryRawUnsafe(`select id, playable, duration from songs`);
  const cached = songs.filter(s => cachedSet.has(s.id.replace(/[^a-zA-Z0-9_-]/g, '_')));
  const notCached = songs.filter(s => !cachedSet.has(s.id.replace(/[^a-zA-Z0-9_-]/g, '_')));
  const cachedIds = cached.map(s => s.id);
  console.log(`cached=${cached.length} notCached=${notCached.length}`);

  // ---- 1. 删除无缓存死歌（级联清理 song_features/daily_recommendations/comments 等）----
  const del = await prisma.$executeRawUnsafe(
    `delete from songs where id <> all($1::text[])`, cachedIds
  );
  console.log('deleted songs:', del);

  // ---- 2. 删除引用死歌的 listening_events 孤儿行 ----
  const delEv = await prisma.$executeRawUnsafe(
    `delete from listening_events where song_id is not null and song_id <> all($1::text[])`, cachedIds
  );
  console.log('deleted orphan listening_events:', delEv);

  // ---- 3. 缓存歌曲全部置 playable=true ----
  const upPlayable = await prisma.$executeRawUnsafe(
    `update songs set playable = true where id = any($1::text[]) and playable = false`, cachedIds
  );
  console.log('playable fixed ->true:', upPlayable);

  // ---- 4. 回填/修正时长（以缓存文件实测帧解析时长为准）----
  let durNull = 0, durWrong = 0;
  for (const s of cached) {
    const m = durBySong.get(s.id);
    if (m == null) continue;
    if (s.duration == null) {
      await prisma.$executeRawUnsafe(`update songs set duration = $2 where id = $1`, s.id, m);
      durNull++;
    } else if (Math.abs(s.duration - m) > 10 || s.duration > 7200) {
      await prisma.$executeRawUnsafe(`update songs set duration = $2 where id = $1`, s.id, m);
      durWrong++;
    }
  }
  console.log('duration backfilled(null):', durNull, '| corrected(>10s or >2h):', durWrong);

  // ---- 5. 清除全部失效 audio_url（实测 100% 403），重置 URL 状态 ----
  const upUrl = await prisma.$executeRawUnsafe(
    `update songs set audio_url = null, url_expires_at = null, url_checked_at = now(), url_failure_count = 0, url_last_failure = null`
  );
  console.log('dead audio_url cleared:', upUrl);

  // ---- 6. 为新可播放歌曲回填中性声学特征 ----
  const feats = await prisma.$queryRawUnsafe(`select song_id from song_features`);
  const featSet = new Set(feats.map(r => r.song_id));
  const missing = cachedIds.filter(id => !featSet.has(id));
  for (const id of missing) {
    await prisma.$executeRawUnsafe(
      `insert into song_features (song_id, sub_bass, bass, low_mid, mid, high_mid, presence, brilliance, air, bpm, computed_at)
       values ($1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0, now()) on conflict (song_id) do nothing`, id
    );
  }
  console.log('features backfilled:', missing.length);

  // ---- 7. 终态验证 ----
  const fin = await prisma.$queryRawUnsafe(`select
    count(*)::int total,
    count(*) filter (where playable)::int playable,
    count(*) filter (where duration is null)::int dur_null,
    count(*) filter (where duration > 7200)::int dur_over2h,
    count(*) filter (where audio_url is not null)::int with_url,
    (select count(*)::int from song_features) features,
    (select count(*)::int from daily_recommendations) daily_rec,
    (select count(*)::int from listening_events) events
    from songs`);
  console.log('=== FINAL ===');
  console.table(fin);

  // 保存保留歌曲 ID 清单供后续步骤使用
  fs.writeFileSync('D:/music_box/output/kept-song-ids.json', JSON.stringify(cachedIds));
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
