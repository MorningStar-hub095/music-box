#!/usr/bin/env node
/**
 * 检查用户 "111" 的聆听数据、情绪DNA、社交DNA 状态
 * 用于验证 DNA 功能修复后的数据完整性
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

(async () => {
  try {
    // 1. 查找用户 "111"
    const user = await prisma.user.findFirst({
      where: { username: '111' },
      select: {
        id: true,
        username: true,
        status: true,
        createdAt: true,
        emotionDna: true,
      },
    });

    if (!user) {
      console.log('❌ 未找到用户名 "111"');
      return;
    }

    console.log('='.repeat(60));
    console.log('用户信息:');
    console.log('='.repeat(60));
    console.log(`  ID: ${user.id}`);
    console.log(`  用户名: ${user.username}`);
    console.log(`  状态: ${user.status}`);
    console.log(`  创建时间: ${user.createdAt}`);
    console.log(`  emotionDna (持久化): ${JSON.stringify(user.emotionDna)}`);
    console.log('');

    // 2. 聆听事件统计
    const totalCount = await prisma.listeningEvent.count({
      where: { userId: user.id },
    });

    const recent6Months = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const recentCount = await prisma.listeningEvent.count({
      where: {
        userId: user.id,
        occurredAt: { gt: recent6Months },
      },
    });

    // 事件类型分布
    const eventTypeStats = await prisma.listeningEvent.groupBy({
      by: ['eventType'],
      where: { userId: user.id },
      _count: { eventType: true },
    });

    console.log('='.repeat(60));
    console.log('聆听事件统计:');
    console.log('='.repeat(60));
    console.log(`  总事件数: ${totalCount}`);
    console.log(`  近 6 个月事件数: ${recentCount}`);
    console.log(`  阈值要求: 5 条 (不足则标记 insufficient)`);
    console.log(`  事件类型分布:`);
    for (const s of eventTypeStats) {
      console.log(`    ${s.eventType}: ${s._count.eventType} 条`);
    }

    // 3. 最近 5 条事件
    const recentEvents = await prisma.listeningEvent.findMany({
      where: { userId: user.id },
      orderBy: { occurredAt: 'desc' },
      take: 5,
      select: {
        eventType: true,
        songId: true,
        occurredAt: true,
        engagementScore: true,
      },
    });

    console.log('');
    console.log('最近 5 条事件:');
    for (const e of recentEvents) {
      console.log(`  [${e.occurredAt.toISOString()}] ${e.eventType} | song: ${e.songId} | engagement: ${e.engagementScore}`);
    }
    console.log('');

    // 4. 社交 DNA
    const socialDna = await prisma.socialDna.findUnique({
      where: { userId: user.id },
    });

    console.log('='.repeat(60));
    console.log('社交 DNA:');
    console.log('='.repeat(60));
    if (socialDna) {
      const v = socialDna.vectorJson;
      const vector = v?.vector || v;
      const isAllZero = Array.isArray(vector) && vector.every((x) => x === 0);
      console.log(`  向量: [${Array.isArray(vector) ? vector.join(', ') : JSON.stringify(vector)}]`);
      console.log(`  全零向量: ${isAllZero ? '是 (无效数据)' : '否 (有效)'}`);
      console.log(`  更新时间: ${socialDna.updatedAt}`);
      console.log(`  cipherSvg 长度: ${socialDna.cipherSvg?.length || 0} 字符`);
    } else {
      console.log('  (无社交 DNA 记录)');
    }
    console.log('');

    // 5. 诊断结论
    console.log('='.repeat(60));
    console.log('诊断结论:');
    console.log('='.repeat(60));
    const threshold = 5;
    if (recentCount < threshold) {
      console.log(`  ⚠️  近 6 个月事件不足 (${recentCount}/${threshold})`);
      console.log(`      → 情绪DNA: 将显示空状态 + "聆听数据不足"提示`);
      console.log(`      → 社交DNA: 将显示空状态 + "聆听数据不足"提示`);
      console.log(`      → 基因图谱: 不依赖个人数据，显示全站歌曲星图`);
    } else {
      console.log(`  ✓ 近 6 个月事件充足 (${recentCount}/${threshold})`);
      console.log(`      → 情绪DNA: 应正常计算 8 维频段向量`);
      console.log(`      → 社交DNA: 应正常计算 12 维向量暗号`);
    }

    if (user.emotionDna) {
      const ed = user.emotionDna;
      const vector = ed.vector || {};
      const keys = ['subBass', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'brilliance', 'air'];
      const isAllZero = keys.every((k) => (vector[k] ?? 0) === 0);
      if (isAllZero) {
        console.log(`  ⚠️  持久化的 emotionDna 为全零向量 (旧数据)`);
        console.log(`      → getForUser 会自动检测并重新计算`);
      } else {
        console.log(`  ✓ 持久化的 emotionDna 有效`);
      }
    }

  } catch (err) {
    console.error('查询失败:', err.message || err);
  } finally {
    await prisma.$disconnect();
  }
})();
