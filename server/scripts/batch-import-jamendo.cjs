/** 批量导入 Jamendo 曲库（方案 A 内置精选）：多风格标签 × 每标签 N 首 */
const path = require('path');
process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/music_box';
process.env.JAMENDO_CLIENT_ID = 'b50cfeff';

const { importByTag } = require(path.join('D:/', 'music_box', 'server', 'dist', 'modules', 'library', 'jamendo.service.js'));
const { PrismaClient } = require(path.join('D:/', 'music_box', 'server', 'node_modules', '@prisma', 'client'));

// 与 GENRE_TAG_MAP 对齐的风格标签（保证 genre 维度映射到中文风格）
const TAGS = [
  'pop', 'rock', 'folk', 'electronic', 'hiphop',
  'jazz', 'classical', 'ambient', 'acoustic', 'blues',
  'soundtrack', 'world', 'reggae', 'latin', 'metal',
];
const PER_TAG = 12;

(async () => {
  const t0 = Date.now();
  const summary = [];
  for (const tag of TAGS) {
    try {
      const r = await importByTag(tag, PER_TAG);
      const skips = (r.skipped || []).map(s => `${s.trackId}:${s.reason}`).slice(0, 6);
      console.log(`[${tag}] imported=${r.imported} skipped=${(r.skipped || []).length}${skips.length ? ' | ' + skips.join(', ') : ''}`);
      summary.push({ tag, imported: r.imported, skipped: (r.skipped || []).length });
    } catch (e) {
      console.error(`[${tag}] FATAL:`, e.message);
      summary.push({ tag, error: e.message });
    }
  }
  const p = new PrismaClient();
  const total = await p.$queryRawUnsafe(`select count(*)::int n from songs where id like 'jamendo:%'`);
  const lic = await p.$queryRawUnsafe(`select count(*)::int n from audio_licenses where source='jamendo'`);
  const feat = await p.$queryRawUnsafe(`select count(*)::int n from song_features where song_id like 'jamendo:%'`);
  console.log('=== 汇总:', JSON.stringify(summary));
  console.log(`=== jamendo 歌曲: ${total[0].n} | 授权登记: ${lic[0].n} | 特征行: ${feat[0].n} | 耗时: ${Math.round((Date.now() - t0) / 1000)}s`);
  await p.$disconnect();
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
