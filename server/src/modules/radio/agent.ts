/**
 * LangChain Agent - 个人电台智能推荐
 * 使用 @langchain/langgraph/prebuilt 的 createReactAgent
 *
 * 性能优化：
 * - LLM 实例和工具实例按 userId 缓存，避免每次调用重建
 * - 从 agent 结果的 ToolMessage 中直接提取歌曲，移除 generatePlaylist 重复调用
 * - 精简系统提示词，减少 token 消耗
 * - 聊天历史限制为最近 10 条
 */

import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { createLLM } from '../../lib/llm-provider';
import { PrismaClient } from '@prisma/client';
import { computeDynamicWeights } from '../recommendation/config';
import { weightedSample } from './radio-diversity';
import { createQueryUserHistoryTool } from './tools/queryUserHistory';
import { createQueryUserDNATool } from './tools/queryUserDNA';
import { createQuerySongLibraryTool } from './tools/querySongLibrary';
import { createSearchExternalTool } from './tools/searchExternal';
import { createGeneratePlaylistTool } from './tools/generatePlaylist';

const SYSTEM_PROMPT = `你是"音乐盒子电台DJ"，一个专业的音乐推荐助手。

## 能力
- queryUserHistory：查询用户听歌历史（最近播放、播放最多）
- queryUserDNA：查询用户情绪DNA、社交DNA、每日推荐
- querySongLibrary：从曲库搜索歌曲（支持风格/情绪/场景/歌手/歌名，返回标签与热度）
- searchExternal：曲库没有时，从外部平台搜索新歌（自动写入曲库）
- generatePlaylist：生成最终推荐列表

## 推荐流程（务必遵循）
1. 先调用 queryUserHistory 和 queryUserDNA 了解用户口味与当前状态
2. 根据用户需求，用 querySongLibrary 按风格/情绪/场景多轮检索候选
3. 若曲库无匹配，用 searchExternal 补充新歌
4. 综合筛选：优先选择与用户情绪/风格匹配、热度高、且风格多样的歌曲
5. 最终必须调用 generatePlaylist 输出 5-10 首带推荐理由的列表

## 主题一致性（核心要求）
- generatePlaylist 必须传入 theme 参数：从你的回答中提炼出的主题/情绪/风格关键词（如"轻松""夜晚""欢快""摇滚"）
- 你输出的文字回答与传入的 songIds 必须围绕同一主题，绝不允许"回答聊A主题、歌单却推B主题"
- 若用户需求模糊，先确定一个明确主题，再围绕该主题回答并选歌
- 推荐的每首歌都应能对应上回答中提到的情绪或场景

## 推荐原则
- 优先推荐曲库已有且可播放的歌曲
- 结合用户情绪DNA、社交DNA、听歌历史综合判断
- 避免风格单一：同一歌单尽量覆盖不同风格/情绪
- 具体需求（歌名/歌手）直接检索；模糊需求（心情/场景）先查DNA再按标签推荐
- 每首推荐理由要具体（结合用户口味或当前情绪，而非泛泛而谈）

用中文交流，语气亲切。`;

// ── 缓存：LLM 实例和工具实例按 userId 复用 ──
const agentCache = new Map<number, { agent: any; tools: any[] }>();

/** 清空 Agent 缓存（切换 LLM Provider 后调用，使下次请求使用新模型） */
export function clearRadioAgentCache() {
  agentCache.clear();
}

export async function createRadioAgent(prisma: PrismaClient, userId: number) {
  if (agentCache.has(userId)) {
    return agentCache.get(userId)!;
  }

  const llm = createLLM();
  const tools = [
    createQueryUserHistoryTool(prisma, userId),
    createQueryUserDNATool(prisma, userId),
    createQuerySongLibraryTool(prisma),
    createSearchExternalTool(prisma),
    createGeneratePlaylistTool(prisma, userId),
  ];

  const { createReactAgent } = require('@langchain/langgraph/prebuilt');
  const { SystemMessage } = require('@langchain/core/messages');

  const agent = createReactAgent({
    llm,
    tools,
    messageModifier: new SystemMessage(SYSTEM_PROMPT),
  });

  const cached = { agent, tools };
  agentCache.set(userId, cached);
  return cached;
}

export async function chatWithAgent(
  prisma: PrismaClient,
  userId: number,
  input: string,
  chatHistory: { role: string; content: string }[],
) {
  const { agent, tools } = await createRadioAgent(prisma, userId);

  // 只取最近 10 条历史，减少 token 消耗
  const recentHistory = chatHistory.slice(-10);
  const history = recentHistory.map(msg =>
    msg.role === 'user'
      ? new HumanMessage(msg.content)
      : new AIMessage(msg.content),
  );

  // 带超时的 Agent 调用（超时时间通过 LLM_TIMEOUT 环境变量配置，单位秒）
  const AGENT_TIMEOUT = parseInt(process.env.LLM_TIMEOUT || '110', 10) * 1000;
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('AI 推理超时，请稍后重试')), AGENT_TIMEOUT);
  });

  const agentPromise = agent.invoke({
    messages: [
      ...history,
      new HumanMessage(input),
    ],
  }, { recursionLimit: 50 }); // 默认 25 步，增加到 50 避免多轮检索时过早停止（2026-08-17）

  const result = await Promise.race([agentPromise, timeoutPromise]) as any;

  // 从 agent 结果中提取歌曲：优先从 ToolMessage 的 content 中解析
  let recommendedSongs: any[] = [];
  let output = '';

  if (result.messages && result.messages.length > 0) {
    const lastMessage = result.messages[result.messages.length - 1];
    output = typeof lastMessage.content === 'string' ? lastMessage.content : '';

    // 从 ToolMessage 中提取 generatePlaylist 的返回结果（避免重复调用工具）
    for (const msg of result.messages) {
      if (msg.constructor?.name === 'ToolMessage' || (msg as any)._getType?.() === 'tool') {
        const content = typeof msg.content === 'string' ? msg.content : '';
        try {
          const parsed = JSON.parse(content);
          if (parsed.success && parsed.songs) {
            recommendedSongs = parsed.songs;
          }
        } catch {}
      }
    }

    // 兜底：如果 ToolMessage 提取失败，从 tool_calls 参数中直接查询数据库
    if (recommendedSongs.length === 0) {
      for (const msg of result.messages) {
        if ('tool_calls' in msg && Array.isArray((msg as any).tool_calls)) {
          for (const call of (msg as any).tool_calls) {
            if (call.name === 'generatePlaylist' && call.args?.songIds) {
              try {
                const songs = await prisma.song.findMany({
                  where: { id: { in: call.args.songIds }, playable: true },
                  select: { id: true, title: true, artist: true, duration: true },
                });
                if (songs.length > 0) {
                  recommendedSongs = call.args.songIds
                    .map((id: string) => songs.find((s: any) => s.id === id))
                    .filter(Boolean);
                }
              } catch {}
            }
          }
        }
      }
    }
  }

  // 兜底：本地模型（如 Ollama qwen2.5）工具调用可能不稳定，导致未产出歌单。
  // 此时根据用户输入检索曲库，保证一定返回可播放歌单，而非仅文字回答。
  if (recommendedSongs.length === 0) {
    recommendedSongs = await fallbackRecommend(prisma, input);
    if (recommendedSongs.length > 0 && !output.trim()) {
      output = '为你推荐以下歌曲，可直接点击播放：';
    }
  }

  return {
    output,
    songs: recommendedSongs,
  };
}

/**
 * 兜底推荐：从用户输入提取主题/情绪/场景关键词，按标签检索曲库；无匹配则回退热门可播放歌曲。
 * 仅当 LLM 未正确调用 generatePlaylist 时触发。
 */
const THEME_KEYWORDS = [
  '轻松', '放松', '欢快', '开心', '愉快', '悲伤', '伤感', '难过', '安静', '平静',
  '激昂', '热血', '浪漫', '治愈', '夜晚', '深夜', '运动', '工作', '学习', '专注',
  '睡眠', '睡觉', '通勤', '开车', '清晨', '雨天', '怀旧', '思念', '孤单', '甜蜜',
  '摇滚', '民谣', '电子', '古典', '爵士', '流行', '嘻哈', '说唱',
];

function extractTheme(input: string): string[] {
  const found: string[] = [];
  for (const kw of THEME_KEYWORDS) {
    if (input.includes(kw) && !found.includes(kw)) found.push(kw);
  }
  return found;
}

async function fallbackRecommend(prisma: PrismaClient, input: string): Promise<any[]> {
  // 1. 提取主题/情绪关键词，按 moods/scenes 标签检索（捕捉"轻松""夜晚"等语义）
  const themes = extractTheme(input);
  if (themes.length > 0) {
    const byTag = await prisma.song.findMany({
      where: {
        playable: true,
        archived: false,
        OR: [
          { moods: { some: { mood: { name: { in: themes } } } } },
          { scenes: { some: { scene: { name: { in: themes } } } } },
          { genres: { some: { genre: { name: { in: themes } } } } },
        ],
      },
      orderBy: { hotScore: 'desc' },
      take: 10,
      select: { id: true, title: true, artist: true, duration: true },
    });
    if (byTag.length > 0) return byTag;
  }

  // 2. 标题/歌手模糊匹配
  const keyword = input.slice(0, 30);
  const matched = await prisma.song.findMany({
    where: {
      playable: true,
      archived: false,
      OR: [
        { title: { contains: keyword } },
        { artist: { contains: keyword } },
      ],
    },
    orderBy: { hotScore: 'desc' },
    take: 10,
    select: { id: true, title: true, artist: true, duration: true },
  });

  if (matched.length > 0) return matched;

  // 3. 热门兜底
  return prisma.song.findMany({
    where: { playable: true, archived: false },
    orderBy: { hotScore: 'desc' },
    take: 10,
    select: { id: true, title: true, artist: true, duration: true },
  });
}

/**
 * 直接 LLM 选歌（单次调用，比多步 Agent 更快更稳定）
 *
 * 用于自动电台的持续生成：后端预取候选池与用户偏好，交给 LLM 一次性选出
 * 相关且多样的歌曲，避免 LangGraph 多步 Agent 在本地模型上过慢导致超时。
 */
export async function generateSongsWithLLM(
  prisma: PrismaClient,
  userId: number,
  playedSongIds: Set<string>,
  playedTitles: string[],
  refresh: boolean,
): Promise<any[]> {
  const llm = createLLM();
  const { SystemMessage, HumanMessage } = require('@langchain/core/messages');

  // 1. 用户近期偏好（歌手频次）+ 收藏歌曲 + 反馈与数据量
  const [recent, favoriteEvents, feedbacks, playEventCount] = await Promise.all([
    prisma.listeningEvent.findMany({
      where: { userId, songId: { not: null } },
      orderBy: { occurredAt: 'desc' },
      take: 80,
      select: { trackArtist: true },
    }),
    prisma.listeningEvent.findMany({
      where: { userId, eventType: 'favorite', songId: { not: null } },
      orderBy: { occurredAt: 'desc' },
      take: 100,
      select: { songId: true },
    }),
    prisma.recommendationFeedback.findMany({
      where: { userId, createdAt: { gte: new Date(Date.now() - 30 * 86400 * 1000) } },
      select: { feedback: true },
    }),
    prisma.listeningEvent.count({
      where: { userId, eventType: { in: ['play', 'complete'] } },
    }),
  ]);
  const favoriteIds = [...new Set(favoriteEvents.map(e => e.songId).filter(Boolean))] as string[];

  // 复用每日推荐的动态权重与反馈统计逻辑
  const dynamicWeights = computeDynamicWeights(playEventCount, feedbacks);
  const likes = feedbacks.filter(f => f.feedback === 'like').length;
  const dislikes = feedbacks.filter(f => f.feedback === 'dislike').length;
  const dislikeRate = likes + dislikes > 0 ? dislikes / (likes + dislikes) : 0;

  // 推荐策略提示（根据动态权重与反馈生成）
  let strategyHint = '';
  if (dynamicWeights.collaborative < 0.1) {
    // 冷启动：协同过滤被大幅降权，说明用户数据不足
    strategyHint = '用户听歌记录较少，请以热门、风格多样的歌曲为主，个人化参考为辅。';
  } else if (dislikeRate > 0.5) {
    strategyHint = '用户近期对部分推荐不满意，请保守推荐其历史明确喜欢的风格，减少冒险。';
  } else {
    strategyHint = '用户有稳定偏好，请结合其听歌历史深度个性化，并适当探索新风格。';
  }
  const artistCount = new Map<string, number>();
  for (const r of recent) {
    const a = r.trackArtist;
    if (!a) continue;
    artistCount.set(a, (artistCount.get(a) || 0) + 1);
  }
  const topArtists = [...artistCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([a]) => a)
    .join('、');

  // 2. 候选池（可播放歌曲 + 标签，排除已播）+ 收藏歌曲
  const [candidatePool, favoriteSongs] = await Promise.all([
    prisma.song.findMany({
      where: { playable: true, archived: false, id: { notIn: [...playedSongIds] } },
      orderBy: { hotScore: 'desc' },
      take: 300,
      select: {
        id: true, title: true, artist: true, hotScore: true,
        genres: { select: { genre: { select: { name: true } } } },
        moods: { select: { mood: { select: { name: true } } } },
      },
    }),
    favoriteIds.length > 0
      ? prisma.song.findMany({
          where: { id: { in: favoriteIds, notIn: [...playedSongIds] }, playable: true, archived: false },
          select: {
            id: true, title: true, artist: true,
            genres: { select: { genre: { select: { name: true } } } },
            moods: { select: { mood: { select: { name: true } } } },
          },
        })
      : Promise.resolve([] as any[]),
  ]);

  // 修复：原实现固定取 hotScore 降序前 150 首，候选池每次一致导致推荐雷同。
  // 改为加权随机采样 150 首（热门权重高 + 探索性），让每次生成略有不同（心动模式）。
  const candidates = weightedSample(
    candidatePool,
    150,
    Math.random,
    (s: any) => 1 + Math.max(0, Number(s.hotScore) || 0),
  );
  if (candidates.length === 0 && favoriteSongs.length === 0) return [];

  // 合并候选池：收藏歌曲排前面，确保 LLM 优先看到并选择
  const candidateIds = new Set(candidates.map(c => c.id));
  const allCandidates = [
    ...favoriteSongs.filter(s => !candidateIds.has(s.id)),
    ...candidates,
  ];

  const candidateLines = allCandidates.map((c, i) => {
    const tags = [
      ...c.genres.map((g: any) => g.genre.name),
      ...c.moods.map((m: any) => m.mood.name),
    ].slice(0, 4).join('/');
    return `${i + 1}. ${c.id} | ${c.title} | ${c.artist} | ${tags}`;
  }).join('\n');

  const playedHint = playedTitles.length > 0
    ? `\n已播放歌曲（请勿重复）：${playedTitles.slice(-30).join('、')}`
    : '';
  const favoriteHint = favoriteSongs.length > 0
    ? `\n用户收藏的歌曲（应优先推荐，建议从中至少选 3 首）：${favoriteSongs.map(s => `${s.title} - ${s.artist}`).join('、')}`
    : '';

  const prompt = `你是音乐电台 DJ。请从下面的候选歌曲中，为用户选出 10 首相关且风格多样的歌曲。
推荐策略：${strategyHint}
用户近期偏好歌手：${topArtists || '未知'}${favoriteHint}${playedHint}

候选歌曲（id | 标题 | 歌手 | 标签）：
${candidateLines}

请只返回 JSON 字符串数组，不要输出任何其他文字。示例：["id1","id2","id3"]`;

  // 单次 LLM 调用（带超时，避免挂起）
  const LLM_TIMEOUT = 90_000;
  const response: any = await Promise.race([
    llm.invoke([
      new SystemMessage(prompt),
      new HumanMessage(refresh ? '请换一批全新的歌曲，与之前尽量不同' : '请推荐下一批歌曲'),
    ]),
    new Promise((_, reject) => setTimeout(() => reject(new Error('LLM 选歌超时')), LLM_TIMEOUT)),
  ]);

  const text = typeof response.content === 'string' ? response.content : '';
  const match = text.match(/\[[^\]]*\]/);
  if (!match) return [];

  try {
    const ids = JSON.parse(match[0]) as string[];
    const picked: any[] = [];
    for (const id of ids) {
      if (picked.length >= 10) break; // 最多 10 首（避免 LLM 返回过多）
      const c = allCandidates.find(x => x.id === id);
      if (c) picked.push({ id: c.id, title: c.title, artist: c.artist });
    }
    return picked;
  } catch {
    return [];
  }
}
