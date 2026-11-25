#!/usr/bin/env node
/**
 * 为现有歌曲生成估算的 SongFeature 记录
 *
 * 背景：
 *   SongFeature 表为空，导致情绪 DNA / 社交 DNA 向量全零，无意义。
 *   本脚本根据歌曲的流派/情绪分类生成估算的 8 维频段特征值。
 *   这是临时方案——真正的音频分析（FFT）可后续替换这些估算值。
 *
 * 频段说明（8 维）：
 *   subBass(20-60Hz)  bass(60-250Hz)   lowMid(250-500Hz) mid(500-2kHz)
 *   highMid(2-4kHz)   presence(4-6kHz) brilliance(6-20kHz) air(20kHz+)
 *
 * 流派特征模式（归一化到 0-1）：
 *   电子/舞曲: 低频强（subBass/bass 高），高频中等
 *   摇滚:      中低频强，高频较高
 *   流行:      中频强，各频段较均衡
 *   民谣:      中高频强，低频较低
 *   古典:      各频段均衡，中高频稍高
 *   嘻哈/R&B:  低频强，中频中等
 */
'use strict';

const fs = require('fs');
const path = require('path');

// 加载 .env
const envPath = path.join(__dirname, '..', 'server', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx < 0) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  let val = trimmed.slice(eqIdx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  process.env[key] = val;
}

const { PrismaClient } = require(path.join(__dirname, '..', 'server', 'node_modules', '@prisma', 'client'));
const prisma = new PrismaClient();

// 流派 ID → 特征模板（genre ID 对应 seed_data.sql）
const GENRE_PROFILES = {
  1:  { subBass: 0.45, bass: 0.55, lowMid: 0.60, mid: 0.65, highMid: 0.55, presence: 0.50, brilliance: 0.45, air: 0.40 }, // 流行
  2:  { subBass: 0.55, bass: 0.65, lowMid: 0.55, mid: 0.60, highMid: 0.65, presence: 0.60, brilliance: 0.55, air: 0.45 }, // 摇滚
  3:  { subBass: 0.25, bass: 0.35, lowMid: 0.50, mid: 0.65, highMid: 0.60, presence: 0.55, brilliance: 0.50, air: 0.45 }, // 民谣
  4:  { subBass: 0.70, bass: 0.75, lowMid: 0.55, mid: 0.45, highMid: 0.50, presence: 0.55, brilliance: 0.60, air: 0.50 }, // 电子
  5:  { subBass: 0.65, bass: 0.70, lowMid: 0.50, mid: 0.45, highMid: 0.40, presence: 0.40, brilliance: 0.35, air: 0.30 }, // 嘻哈
  6:  { subBass: 0.55, bass: 0.60, lowMid: 0.50, mid: 0.50, highMid: 0.45, presence: 0.45, brilliance: 0.40, air: 0.35 }, // R&B
  7:  { subBass: 0.35, bass: 0.40, lowMid: 0.50, mid: 0.55, highMid: 0.55, presence: 0.55, brilliance: 0.55, air: 0.50 }, // 古典
  8:  { subBass: 0.30, bass: 0.40, lowMid: 0.50, mid: 0.55, highMid: 0.55, presence: 0.50, brilliance: 0.50, air: 0.45 }, // 爵士
  9:  { subBass: 0.60, bass: 0.70, lowMid: 0.60, mid: 0.55, highMid: 0.60, presence: 0.60, brilliance: 0.55, air: 0.45 }, // 金属
  10: { subBass: 0.50, bass: 0.60, lowMid: 0.55, mid: 0.55, highMid: 0.60, presence: 0.60, brilliance: 0.55, air: 0.45 }, // 朋克
  11: { subBass: 0.45, bass: 0.55, lowMid: 0.60, mid: 0.65, highMid: 0.55, presence: 0.50, brilliance: 0.45, air: 0.40 }, // 华语流行
  12: { subBass: 0.45, bass: 0.55, lowMid: 0.60, mid: 0.65, highMid: 0.55, presence: 0.50, brilliance: 0.45, air: 0.40 }, // 欧美流行
  13: { subBass: 0.45, bass: 0.55, lowMid: 0.60, mid: 0.65, highMid: 0.55, presence: 0.50, brilliance: 0.45, air: 0.40 }, // 日韩流行
  14: { subBass: 0.70, bass: 0.75, lowMid: 0.55, mid: 0.45, highMid: 0.50, presence: 0.55, brilliance: 0.60, air: 0.50 }, // House
  15: { subBass: 0.72, bass: 0.70, lowMid: 0.50, mid: 0.40, highMid: 0.45, presence: 0.50, brilliance: 0.55, air: 0.45 }, // Techno
  16: { subBass: 0.68, bass: 0.72, lowMid: 0.55, mid: 0.50, highMid: 0.55, presence: 0.60, brilliance: 0.65, air: 0.55 }, // Trance
  17: { subBass: 0.75, bass: 0.65, lowMid: 0.45, mid: 0.40, highMid: 0.50, presence: 0.60, brilliance: 0.65, air: 0.55 }, // Dubstep
};

// 默认特征（无流派信息时使用）
const DEFAULT_PROFILE = { subBass: 0.40, bass: 0.50, lowMid: 0.55, mid: 0.60, highMid: 0.55, presence: 0.50, brilliance: 0.45, air: 0.40 };

/** 生成带随机扰动的特征值（±10%），避免所有同流派歌曲特征完全相同 */
function withJitter(profile, seed) {
  const jitter = (val, s) => {
    // 基于种子的伪随机扰动
    const r = Math.sin(s * 12.9898) * 43758.5453;
    const noise = (r - Math.floor(r) - 0.5) * 0.2; // ±10%
    return Math.max(0, Math.min(1, val + noise));
  };
  const result = {};
  let i = 0;
  for (const key of ['subBass', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'brilliance', 'air']) {
    result[key] = jitter(profile[key], seed + i);
    i++;
  }
  return result;
}

async function main() {
  console.log('='.repeat(60));
  console.log('SongFeature 估算生成器');
  console.log('='.repeat(60));

  // 1. 查找所有没有 SongFeature 的歌曲
  const songsWithoutFeatures = await prisma.song.findMany({
    where: { features: null },
    select: {
      id: true,
      title: true,
      artist: true,
      genres: { include: { genre: true } },
    },
  });

  console.log(`需要生成特征的歌曲数: ${songsWithoutFeatures.length}`);

  if (songsWithoutFeatures.length === 0) {
    console.log('✓ 所有歌曲已有 SongFeature 记录，无需生成');
    return;
  }

  // 2. 为每首歌生成特征
  let created = 0;
  let batch = [];

  for (const song of songsWithoutFeatures) {
    // 从歌曲流派获取第一个 genreId
    const genreId = song.genres?.[0]?.genreId || song.genres?.[0]?.genre?.id;
    const profile = (genreId && GENRE_PROFILES[genreId]) || DEFAULT_PROFILE;

    // 基于歌曲 ID 生成种子，保证同一首歌每次生成结果一致
    let seed = 0;
    for (let i = 0; i < song.id.length; i++) seed = (seed * 31 + song.id.charCodeAt(i)) | 0;
    const features = withJitter(profile, Math.abs(seed));

    // 估算 BPM 和 energy
    const bpm = 80 + Math.floor((Math.sin(seed * 0.001) * 0.5 + 0.5) * 80); // 80-160
    const energy = (features.bass + features.subBass + features.highMid) / 3;

    batch.push({
      songId: song.id,
      subBass: features.subBass,
      bass: features.bass,
      lowMid: features.lowMid,
      mid: features.mid,
      highMid: features.highMid,
      presence: features.presence,
      brilliance: features.brilliance,
      air: features.air,
      bpm,
      energy,
      computedAt: new Date(),
    });

    created++;

    // 每 100 首批量写入
    if (batch.length >= 100) {
      await prisma.songFeature.createMany({ data: batch });
      console.log(`  已生成: ${created}/${songsWithoutFeatures.length}`);
      batch = [];
    }
  }

  // 写入剩余
  if (batch.length > 0) {
    await prisma.songFeature.createMany({ data: batch });
  }

  console.log(`\n✓ 成功生成 ${created} 条 SongFeature 记录`);

  // 3. 验证
  const totalFeatures = await prisma.songFeature.count();
  console.log(`当前 SongFeature 总数: ${totalFeatures}`);

  // 4. 触发基因图谱 PCA 计算（需要在服务器端调用）
  console.log('\n提示: 请重启后端服务器，或调用基因图谱 recompute 端点以生成 genomeX/Y 坐标');
  console.log('  也可以通过 scheduler 自动在每日 3:00 计算');
}

main().catch(err => {
  console.error('生成失败:', err.message || err);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
