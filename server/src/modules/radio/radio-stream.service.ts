/**
 * RadioStream Service - 全自动 AI 电台（LLM 驱动 + 持续生成）
 *
 * 架构：生产者-消费者
 *   - 后台 LLM 持续预生成歌单批次（生产者），存入就绪队列 readyBatches
 *   - 前端通过 start / next / refresh 消费就绪批次（消费者）
 *   - 点击即返回已就绪的 LLM 结果（秒开）；LLM 未就绪时用轻量热门兜底
 *
 * 持续生成：无固定批次上限，只要会话激活且队列未满就持续补货。
 * 性能：限制就绪队列长度、单用户同时只跑一个 LLM 任务、候选池限量。
 */

import { PrismaClient } from '@prisma/client';
import { generateSongsWithLLM } from './agent';
import { weightedSample, shuffle } from './radio-diversity';
import { RecommendationService } from '../recommendation/recommendation.service';

// ── 流式状态（内存，key 为 userId）──
interface StreamState {
  userId: number;
  sessionId: number | null;
  playedSongIds: Set<string>;       // 已播放/已返回歌曲（去重）
  playedTitles: string[];           // 已播标题（用于提示词避免重复）
  readyBatches: any[][];            // 已就绪的 LLM 歌单批次队列
  generating: boolean;              // 后台 LLM 是否在生成
  active: boolean;                  // 会话是否激活（决定是否持续补货）
}

const streams = new Map<number, StreamState>();

const BATCH_SIZE = 10;           // 每批目标数量
const MAX_READY_BATCHES = 3;     // 就绪队列上限（性能，避免无限堆积）
const MAX_GENERATE_ATTEMPTS = 3; // 单次补货链最多生成批数（避免 LLM 失败时紧循环）

// 探索比例（心动模式）：每批中探索歌曲的占比，其余为个性化推荐（每日推荐）。
// 初始值可用环境变量 RADIO_EXPLORATION_RATIO 覆盖（0~1）；运行时可通过 setExplorationRatio 调整。
let explorationRatio = (() => {
  const v = parseFloat(process.env.RADIO_EXPLORATION_RATIO || '0.3');
  if (isNaN(v)) return 0.3;
  return Math.min(1, Math.max(0, v));
})();

/** 获取当前探索比例（0~1） */
export function getExplorationRatio(): number {
  return explorationRatio;
}

/** 设置探索比例（自动夹取到 0~1），返回生效值 */
export function setExplorationRatio(value: number): number {
  const n = Number(value);
  if (!isNaN(n)) explorationRatio = Math.min(1, Math.max(0, n));
  return explorationRatio;
}

/** 清洗歌曲为前端需要的精简结构 */
function toSongView(song: any) {
  return { id: song.id, title: song.title, artist: song.artist, duration: song.duration };
}

export class RadioStreamService {
  constructor(private prisma: PrismaClient) {}

  /** 预热：后台开始为指定用户预生成歌单（前端登录后调用，不阻塞） */
  async warmup(userId: number): Promise<{ queued: boolean }> {
    const state = this.getState(userId);
    state.active = true;
    this.topUpChain(state);
    return { queued: true };
  }

  /** 启动自动电台：返回已就绪歌单（秒开），后台持续生成 */
  async start(userId: number) {
    const state = this.getState(userId);
    state.active = true;
    if (state.sessionId == null) {
      const session = await this.prisma.radioSession.create({ data: { userId, title: '自动电台' } });
      state.sessionId = Number(session.id);
    }
    this.topUpChain(state);
    const songs = this.drainBatch(state) ?? await this.fallbackSongs(state, BATCH_SIZE);
    return { sessionId: String(state.sessionId), songs };
  }

  /** 下一批（自动预取）：LLM 优先，兜底 */
  async next(userId: number, sessionId: number) {
    const state = this.getState(userId);
    this.topUpChain(state);
    const songs = this.drainBatch(state) ?? await this.fallbackSongs(state, BATCH_SIZE);
    return { songs };
  }

  /** 换一批（手动刷新）：生成全新一批（避免重复） */
  async refresh(userId: number, sessionId: number) {
    const state = this.getState(userId);
    state.active = true;
    this.topUpChain(state, true);
    const songs = this.drainBatch(state) ?? await this.fallbackSongs(state, BATCH_SIZE);
    return { songs };
  }

  /** 播放反馈（跳过/完成），用于去重 */
  async feedback(userId: number, sessionId: number, songId: string) {
    const state = this.getState(userId);
    state.playedSongIds.add(songId);
    return { success: true };
  }

  // ── 内部 ──

  private getState(userId: number): StreamState {
    let state = streams.get(userId);
    if (!state) {
      state = {
        userId, sessionId: null,
        playedSongIds: new Set(), playedTitles: [],
        readyBatches: [], generating: false, active: false,
      };
      streams.set(userId, state);
    }
    return state;
  }

  /** 从就绪队列取一批（先进先出），并标记已播放 */
  private drainBatch(state: StreamState): any[] | null {
    if (state.readyBatches.length === 0) return null;
    const batch = state.readyBatches.shift()!;
    this.markPlayed(state, batch);
    return batch;
  }

  private markPlayed(state: StreamState, songs: any[]) {
    for (const s of songs) {
      state.playedSongIds.add(s.id);
      if (s.title) state.playedTitles.push(s.title);
    }
  }

  /** 后台补货链：持续生成直到队列满或达到本轮上限 */
  private topUpChain(state: StreamState, refresh = false): void {
    if (!state.active) return;
    if (state.generating) return; // 已有生成任务在跑，交给它继续
    void (async () => {
      let attempts = 0;
      while (state.active && state.readyBatches.length < MAX_READY_BATCHES && attempts < MAX_GENERATE_ATTEMPTS) {
        await this.generateOnce(state, refresh);
        refresh = false; // 仅首次使用 refresh 语义
        attempts++;
      }
    })().catch(err => {
      console.warn('[RadioStream] 后台生成失败:', err instanceof Error ? err.message : err);
    });
  }

  /** 执行一次 LLM 选歌，结果入队 */
  private async generateOnce(state: StreamState, refresh: boolean) {
    state.generating = true;
    try {
      const songs = await generateSongsWithLLM(
        this.prisma,
        state.userId,
        state.playedSongIds,
        state.playedTitles,
        refresh,
      );
      const fresh = (songs || []).map(toSongView).filter(s => !state.playedSongIds.has(s.id)).slice(0, BATCH_SIZE);
      if (fresh.length > 0) state.readyBatches.push(fresh);
    } finally {
      state.generating = false;
    }
  }

  /** 轻量兜底：个性化推荐（每日推荐）+ 热门池（心动模式探索），按 EXPLORATION_RATIO 控制比例，随机采样保证每次略有不同 */
  private async fallbackSongs(state: StreamState, k: number): Promise<any[]> {
    const personalized = await this.personalizedSongs(state);

    // 明确控制探索比例：exploreCount 首来自热门池（探索），其余来自个性化（每日推荐）
    const exploreCount = Math.round(k * explorationRatio);
    const keepCount = Math.min(personalized.length, k - exploreCount);

    // 个性化部分：随机取 keepCount 首（每日推荐优先）
    const keep = shuffle(personalized, Math.random).slice(0, keepCount);

    // 探索部分：热门池加权随机采样（排除已播 + 已选的个性化歌曲）
    const exclude = new Set([...state.playedSongIds, ...keep.map((s: any) => s.id)]);
    const pool = await this.prisma.song.findMany({
      where: { playable: true, archived: false, id: { notIn: [...exclude] } },
      orderBy: { hotScore: 'desc' },
      take: 100,
      select: { id: true, title: true, artist: true, duration: true, hotScore: true },
    });
    const explore = weightedSample(pool, k - keep.length, Math.random, (s: any) => 1 + Math.max(0, Number(s.hotScore) || 0))
      .map(({ id, title, artist, duration }: any) => ({ id, title, artist, duration }));

    // 合并后洗牌，使个性化与探索交错，且每次顺序不同
    const songs = shuffle([...keep, ...explore], Math.random).slice(0, k);
    this.markPlayed(state, songs);
    return songs;
  }

  /** 调用个性化推荐引擎（每日推荐）作为秒开首选，带超时保护；失败/超时返回空数组 */
  private async personalizedSongs(state: StreamState, timeoutMs = 3000): Promise<any[]> {
    try {
      const recService = new RecommendationService();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<any[]>((resolve) => {
        timer = setTimeout(() => resolve([]), timeoutMs);
      });
      const result = await Promise.race([
        recService.generateForUser(state.userId)
          .then((recSongs: any[]) =>
            (recSongs || [])
              .filter((s: any) => s && s.id && !state.playedSongIds.has(s.id))
              .map((s: any) => ({ id: s.id, title: s.title, artist: s.artist, duration: s.duration })),
          )
          .catch(() => []),
        timeout,
      ]);
      if (timer) clearTimeout(timer);
      return result;
    } catch (err) {
      console.warn('[RadioStream] 个性化推荐失败，回退热门随机:', err instanceof Error ? err.message : err);
      return [];
    }
  }
}
