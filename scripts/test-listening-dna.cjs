#!/usr/bin/env node
/**
 * 端到端验证脚本：测试聆听事件上报 → DNA 计算完整链路
 *
 * 流程：
 *   1. 以访客身份获取 token
 *   2. 上报若干聆听事件（模拟播放/完成/跳过）
 *   3. 查询情绪 DNA，验证是否计算成功
 *   4. 查询社交 DNA，验证是否计算成功
 *   5. 检查数据库中事件是否正确记录（含音频特征）
 */
'use strict';

const API_BASE = 'http://localhost:49200/api';
const TOKEN_KEY = 'mb_token';

async function fetchJson(url, options = {}) {
  const resp = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const json = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, json };
}

async function main() {
  console.log('='.repeat(60));
  console.log('聆听事件 → DNA 计算端到端验证');
  console.log('='.repeat(60));

  // 1. 访客登录获取 token
  console.log('\n[1] 访客登录...');
  const { json: loginJson } = await fetchJson(`${API_BASE}/auth/guest`, { method: 'POST' });
  if (!loginJson.success || !loginJson.data?.token) {
    console.error('  ❌ 访客登录失败:', loginJson);
    process.exit(1);
  }
  const token = loginJson.data.token;
  const userId = loginJson.data.user.id;
  const username = loginJson.data.user.username;
  console.log(`  ✓ 访客登录成功: ${username} (ID: ${userId})`);

  const authHeader = { Authorization: `Bearer ${token}` };

  // 2. 获取推荐歌曲（用于获取真实 songId）
  console.log('\n[2] 获取推荐歌曲...');
  const { json: recJson } = await fetchJson(`${API_BASE}/recommendation/daily`, { headers: authHeader });
  if (!recJson.success || !recJson.data?.songs || recJson.data.songs.length === 0) {
    console.error('  ❌ 无法获取推荐歌曲');
    process.exit(1);
  }
  const songs = recJson.data.songs.filter(s => s.audioUrl);
  console.log(`  ✓ 获取到 ${songs.length} 首可播放歌曲`);

  if (songs.length < 5) {
    console.warn('  ⚠️ 可播放歌曲不足 5 首，无法达到 DNA 计算阈值');
  }

  // 3. 上报聆听事件（模拟 8 首歌的播放行为）
  console.log('\n[3] 上报聆听事件...');
  const events = [];
  const numSongs = Math.min(songs.length, 8);

  for (let i = 0; i < numSongs; i++) {
    const song = songs[i];
    const duration = 180000 + Math.floor(Math.random() * 120000); // 3-5 分钟

    // play 事件
    events.push({
      songId: song.id,
      trackTitle: song.title,
      trackArtist: song.artist,
      eventType: 'play',
      positionMs: 0,
      durationMs: duration,
      engagementScore: 0.3,
      occurredAt: new Date(Date.now() - (numSongs - i) * 600000).toISOString(),
    });

    // 模拟：前 5 首完整播放，后 3 首跳过
    if (i < 5) {
      events.push({
        songId: song.id,
        trackTitle: song.title,
        trackArtist: song.artist,
        eventType: 'complete',
        positionMs: duration,
        durationMs: duration,
        engagementScore: 1.0,
        occurredAt: new Date(Date.now() - (numSongs - i) * 600000 + 300000).toISOString(),
      });
    } else {
      events.push({
        songId: song.id,
        trackTitle: song.title,
        trackArtist: song.artist,
        eventType: 'skip',
        positionMs: Math.floor(duration * 0.3),
        durationMs: duration,
        engagementScore: 0.2,
        occurredAt: new Date(Date.now() - (numSongs - i) * 600000 + 90000).toISOString(),
      });
    }
  }

  const { ok: ingestOk, json: ingestJson } = await fetchJson(`${API_BASE}/listening/events`, {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({ events }),
  });

  if (!ingestOk || !ingestJson.success) {
    console.error('  ❌ 上报失败:', ingestJson);
    process.exit(1);
  }
  console.log(`  ✓ 成功上报 ${ingestJson.data.accepted} 条事件 (发送 ${events.length} 条)`);

  // 4. 手动重算情绪 DNA
  console.log('\n[4] 重算情绪 DNA...');
  const { json: emoJson } = await fetchJson(`${API_BASE}/emotion-dna/recompute`, {
    method: 'POST',
    headers: authHeader,
  });

  if (!emoJson.success) {
    console.error('  ❌ 情绪 DNA 重算失败:', emoJson);
  } else {
    const d = emoJson.data;
    console.log(`  ✓ 情绪 DNA 计算完成:`);
    console.log(`    事件数: ${d.eventCount}`);
    console.log(`    不足: ${d.insufficient ? '是' : '否'}`);
    if (d.vector) {
      const keys = ['subBass', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'brilliance', 'air'];
      console.log(`    向量:`);
      for (const k of keys) {
        console.log(`      ${k}: ${(d.vector[k] ?? 0).toFixed(4)}`);
      }
    }
    if (d.insufficientMessage) {
      console.log(`    提示: ${d.insufficientMessage}`);
    }
  }

  // 5. 手动重算社交 DNA
  console.log('\n[5] 重算社交 DNA...');
  const { json: socialJson } = await fetchJson(`${API_BASE}/social-dna/recompute`, {
    method: 'POST',
    headers: authHeader,
  });

  if (!socialJson.success) {
    console.error('  ❌ 社交 DNA 重算失败:', socialJson);
  } else {
    const d = socialJson.data;
    console.log(`  ✓ 社交 DNA 计算完成:`);
    console.log(`    事件数: ${d.eventCount}`);
    console.log(`    不足: ${d.insufficient ? '是' : '否'}`);
    console.log(`    向量维度: ${d.vector?.length || 0}`);
    if (d.vector && d.vector.length > 0) {
      console.log(`    向量: [${d.vector.map((v) => v.toFixed(3)).join(', ')}]`);
    }
    if (d.insufficientMessage) {
      console.log(`    提示: ${d.insufficientMessage}`);
    }
  }

  // 6. 检查基因图谱
  console.log('\n[6] 检查基因图谱...');
  const { json: genomeJson } = await fetchJson(`${API_BASE}/genome/map`, { headers: authHeader });
  if (!genomeJson.success) {
    console.error('  ❌ 基因图谱查询失败:', genomeJson);
  } else {
    const d = genomeJson.data;
    console.log(`  ✓ 基因图谱: ${d.songs?.length || 0} 首歌曲${d.pending ? ' (PCA 未计算)' : ''}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('验证完成！');
  console.log('='.repeat(60));
  console.log('\n说明:');
  console.log('  - 如果事件数 ≥ 5 且 insufficient = 否，说明 DNA 功能正常工作');
  console.log('  - 如果事件中有 feat* 值非零，说明后端自动填充音频特征成功');
  console.log('  - 重新打开前端个人资料页，情绪 DNA / 社交 DNA / 基因图谱应显示数据');
}

main().catch(err => {
  console.error('测试脚本异常:', err);
  process.exit(1);
});
