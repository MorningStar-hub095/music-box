/**
 * Demo 种子数据（2026-11-04）
 *
 * 目的：全新部署后 songs 表为空，主站无歌可放。
 * 本脚本注入 12 首"自有曲库"元数据（无真实歌词、无第三方音频直链），
 * audioUrl 指向 /api/library/audio/<file>——把有权限分发的音频文件
 * 放进项目根目录 local-music/（文件名与 file 字段一致）即可播放。
 *
 * 幂等：按 id upsert，可重复执行。
 * 用法：cd server && DATABASE_URL=... npm run seed:demo
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const demoSongs = [
  { id: 'demo-01', title: '晨光漫步', artist: 'Demo 曲库', file: 'demo-01-morning-walk.mp3', duration: 186, color: '#17C3B2' },
  { id: 'demo-02', title: '夜色温柔', artist: 'Demo 曲库', file: 'demo-02-gentle-night.mp3', duration: 214, color: '#6C5CE7' },
  { id: 'demo-03', title: '雨后街道', artist: 'Demo 曲库', file: 'demo-03-after-rain.mp3', duration: 198, color: '#0984E3' },
  { id: 'demo-04', title: '山间清风', artist: 'Demo 曲库', file: 'demo-04-mountain-breeze.mp3', duration: 242, color: '#00B894' },
  { id: 'demo-05', title: '午夜电台', artist: 'Demo 曲库', file: 'demo-05-midnight-radio.mp3', duration: 227, color: '#636E72' },
  { id: 'demo-06', title: '夏日冰饮', artist: 'Demo 曲库', file: 'demo-06-summer-soda.mp3', duration: 173, color: '#FDCB6E' },
  { id: 'demo-07', title: '旧书页', artist: 'Demo 曲库', file: 'demo-07-old-pages.mp3', duration: 205, color: '#E17055' },
  { id: 'demo-08', title: '城市脉搏', artist: 'Demo 曲库', file: 'demo-08-city-pulse.mp3', duration: 189, color: '#D63031' },
  { id: 'demo-09', title: '云端漫游', artist: 'Demo 曲库', file: 'demo-09-cloud-drift.mp3', duration: 231, color: '#74B9FF' },
  { id: 'demo-10', title: '篝火旁', artist: 'Demo 曲库', file: 'demo-10-campfire.mp3', duration: 258, color: '#E58E26' },
  { id: 'demo-11', title: '极简练习曲', artist: 'Demo 曲库', file: 'demo-11-minimal-etude.mp3', duration: 264, color: '#A29BFE' },
  { id: 'demo-12', title: '归途', artist: 'Demo 曲库', file: 'demo-12-way-home.mp3', duration: 209, color: '#55EFC4' },
];

async function main() {
  let created = 0;
  let updated = 0;
  for (const s of demoSongs) {
    const data = {
      title: s.title,
      artist: s.artist,
      album: 'Music Box 自有曲库',
      audioUrl: `/api/library/audio/${s.file}`,
      coverColor: s.color,
      duration: s.duration,
      platform: 'local',
      playable: true,
      lyricContent: null, // 合规：不内置任何第三方歌词
    };
    const existing = await prisma.song.findUnique({ where: { id: s.id } });
    if (existing) {
      await prisma.song.update({ where: { id: s.id }, data });
      updated++;
    } else {
      await prisma.song.create({ data: { id: s.id, ...data } });
      created++;
    }
  }
  console.log(`[SEED-DEMO] 完成：新增 ${created} 首，更新 ${updated} 首（共 ${demoSongs.length} 首）`);
  console.log('[SEED-DEMO] 提示：把有权限分发的音频放入 local-music/（文件名对应 file 字段）即可播放；');
  console.log('[SEED-DEMO] 未放文件的曲目在 Demo 模式或曲库代理下会返回 404，属预期行为。');
}

main()
  .catch((e) => {
    console.error('[SEED-DEMO] 失败:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
