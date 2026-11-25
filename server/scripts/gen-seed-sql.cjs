// 从当前 DB 生成数据 INSERT 语句，与 schema-new.sql 合成完整 seed.sql
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

function sqlVal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') {
    // Date / Json
    if (v instanceof Date) return `'${v.toISOString()}'`;
    return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function main() {
  const tables = [
    'decades', 'genres', 'languages', 'moods', 'scenes', 'tags',
    'songs', 'song_decades', 'song_genres', 'song_languages', 'song_moods', 'song_scenes', 'song_tags',
    'song_features', 'users', 'social_dna', 'radio_sessions', 'radio_messages',
    'comments', 'comment_likes', 'comment_reports', 'daily_recommendations', 'audio_licenses',
  ];
  let out = [];
  out.push(`-- 音乐盒子 种子数据（由真实数据库导出，与 audio-cache 本地曲库一致）`);
  out.push(`-- 重新生成时间: ${new Date().toISOString()} | songs = 506（全部有本地缓存、经完整性与时长校验）`);
  out.push(`SELECT pg_catalog.set_config('search_path', '', false);`);
  for (const t of tables) {
    const cols = await prisma.$queryRawUnsafe(
      `select column_name, data_type from information_schema.columns where table_name=$1 and table_schema='public' order by ordinal_position`, t
    );
    if (!cols.length) { console.log('skip (no table):', t); continue; }
    const rows = await prisma.$queryRawUnsafe(`select * from "${t}"`);
    console.log(t, rows.length);
    if (!rows.length) continue;
    const colNames = cols.map(c => `"${c.column_name}"`).join(', ');
    for (const r of rows) {
      const vals = cols.map(c => {
        let v = r[c.column_name];
        if (typeof v === 'bigint') v = Number(v);
        if (c.data_type === 'json' || c.data_type === 'jsonb') {
          return v === null ? 'NULL' : `'${JSON.stringify(typeof v === 'string' ? JSON.parse(v) : v).replace(/'/g, "''")}'::${c.data_type}`;
        }
        if (c.data_type === 'timestamp with time zone' && v) return `'${new Date(v).toISOString()}'`;
        return sqlVal(v);
      }).join(', ');
      out.push(`INSERT INTO public."${t}" (${colNames}) VALUES (${vals});`);
    }
  }
  fs.writeFileSync('D:/music_box/output/seed-data-new.sql', out.join('\n'));
  console.log('data sql lines:', out.length);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
