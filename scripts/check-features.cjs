#!/usr/bin/env node
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

(async () => {
  try {
    // 1. SongFeature 总数
    const totalFeatures = await prisma.songFeature.count();
    console.log(`SongFeature 总数: ${totalFeatures}`);

    // 2. 有非零特征的 SongFeature 数量
    const nonZeroFeatures = await prisma.songFeature.count({
      where: { OR: [
        { subBass: { not: 0 } },
        { bass: { not: 0 } },
        { lowMid: { not: 0 } },
        { mid: { not: 0 } },
        { highMid: { not: 0 } },
        { presence: { not: 0 } },
        { brilliance: { not: 0 } },
        { air: { not: 0 } },
      ] },
    });
    console.log(`有非零特征的 SongFeature: ${nonZeroFeatures}`);

    // 3. Song 总数
    const totalSongs = await prisma.song.count();
    console.log(`Song 总数: ${totalSongs}`);

    // 4. 检查最近上报的聆听事件的特征值
    const recentEvents = await prisma.listeningEvent.findMany({
      orderBy: { occurredAt: 'desc' },
      take: 5,
      select: {
        songId: true,
        eventType: true,
        featSubBass: true,
        featBass: true,
        featMid: true,
        featAir: true,
        engagementScore: true,
      },
    });
    console.log('\n最近 5 条聆听事件:');
    for (const e of recentEvents) {
      console.log(`  songId: ${e.songId} | type: ${e.eventType} | featSubBass: ${e.featSubBass} | featBass: ${e.featBass} | featMid: ${e.featMid} | featAir: ${e.featAir} | engagement: ${e.engagementScore}`);
    }

    // 5. 检查这些事件对应的 SongFeature
    if (recentEvents.length > 0) {
      const songIds = recentEvents.map(e => e.songId).filter(Boolean);
      const features = await prisma.songFeature.findMany({
        where: { songId: { in: songIds } },
      });
      console.log(`\n这些事件对应的 SongFeature 数量: ${features.length}`);
      for (const f of features.slice(0, 3)) {
        console.log(`  songId: ${f.songId} | subBass: ${f.subBass} | bass: ${f.bass} | mid: ${f.mid} | air: ${f.air}`);
      }

      // 如果 SongFeature 不存在，检查 Song 表中是否有 features 关系
      if (features.length === 0) {
        console.log('\n⚠️ 这些歌曲没有 SongFeature 记录！音频特征为 0，DNA 计算结果无意义。');
        console.log('  需要：为歌曲生成 SongFeature 记录（通过音频分析或特征上传）');

        // 检查 Song 表中 playable 的歌曲
        const playableSongs = await prisma.song.count({ where: { playable: true, archived: false } });
        console.log(`  可播放歌曲数: ${playableSongs}`);
      }
    }

  } catch (err) {
    console.error('查询失败:', err.message || err);
  } finally {
    await prisma.$disconnect();
  }
})();
