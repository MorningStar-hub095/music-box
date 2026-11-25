// 补跑：清除死链（audio_url NOT NULL 约束 → 置空串）+ 特征回填 + 终态验证
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

async function main() {
  // ---- 5. 清除全部失效 audio_url（实测 100% 403），置空串表示“无可用直链” ----
  const upUrl = await prisma.$executeRawUnsafe(
    `update songs set audio_url = '', url_expires_at = null, url_checked_at = now(), url_failure_count = 0, url_last_failure = null`
  );
  console.log('dead audio_url cleared:', upUrl);

  // ---- 6. 为新可播放歌曲回填中性声学特征 ----
  const kept = await prisma.$queryRawUnsafe(`select id from songs`);
  const keptIds = kept.map(r => r.id);
  const feats = await prisma.$queryRawUnsafe(`select song_id from song_features`);
  const featSet = new Set(feats.map(r => r.song_id));
  const missing = keptIds.filter(id => !featSet.has(id));
  for (const id of missing) {
    await prisma.$executeRawUnsafe(
      `insert into song_features (song_id, "subBass", bass, "lowMid", mid, "highMid", presence, brilliance, air, bpm, computed_at)
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
    count(*) filter (where audio_url <> '')::int with_url,
    count(*) filter (where local_path is not null and local_path <> '')::int with_local_path,
    (select count(*)::int from song_features) features,
    (select count(*)::int from daily_recommendations) daily_rec,
    (select count(*)::int from listening_events) events
    from songs`);
  console.log('=== FINAL ===');
  console.table(fin);

  const bad = await prisma.$queryRawUnsafe(`select id, title from songs where data_source='manual' and (title like '%??%' or artist like '%??%')`);
  console.log('残余乱码 manual 歌曲:', bad.length);
  const noLocal = await prisma.$queryRawUnsafe(`select count(*)::int n from songs where local_path is null or local_path = ''`);
  console.log('无 local_path 的保留歌曲:', noLocal[0].n);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
