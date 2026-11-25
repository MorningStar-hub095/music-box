import { useRef, useEffect, useCallback } from 'react';
import { listeningApi, ListeningEventInput, API_BASE } from '../services/api';

/**
 * 聆听事件追踪 Hook (2026-08-09 新增)
 *
 * 职责：
 *   1. 当曲目切换时，若上一首未播完则上报 'skip' 事件，并上报新曲 'play' 事件
 *   2. 暴露 markComplete() 供 App 在歌曲自然播完时调用
 *   3. 暴露 markFavorite() 供 App 在收藏时调用
 *   4. 事件先入批量队列，定时（15 秒）或页面卸载时统一 flush
 *
 * 设计考量：
 *   - 不依赖音频特征：后端 ingest 端点会自动从 SongFeature 表回填 feat* 字段
 *   - 参与度打分策略：
 *       play → 0.3 (基础)
 *       complete → 1.0 (高参与度)
 *       skip → 基于播放比例 (0.1 ~ 0.5)
 *       favorite → 1.0
 */

const FLUSH_INTERVAL = 15_000; // 15 秒批量上报
const MAX_QUEUE_SIZE = 20;     // 队列上限，超过立即 flush

interface TrackInfo {
  id: string;
  title?: string;
  artist?: string;
}

export function useListeningTracker(
  currentTrack: TrackInfo | undefined | null,
  isPlaying: boolean,
  position: number,
  duration: number,
) {
  // 事件批量队列
  const queueRef = useRef<ListeningEventInput[]>([]);
  // 上一首曲目信息（用于检测切歌时是否需要发送 skip）
  const prevTrackRef = useRef<TrackInfo | null>(null);
  // 上一首是否已标记 complete（避免 complete + skip 重复发送）
  const completedRef = useRef(false);
  // 上一首的播放位置/时长（用于计算 skip 时的 engagementScore）
  const prevPositionRef = useRef(0);
  const prevDurationRef = useRef(0);
  // flush 定时器
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** 将事件加入队列，队列满时自动 flush */
  const enqueue = useCallback((event: ListeningEventInput) => {
    queueRef.current.push(event);
    if (queueRef.current.length >= MAX_QUEUE_SIZE) {
      flush();
    }
  }, []);

  /** 批量发送队列中的事件 */
  const flush = useCallback(async () => {
    if (queueRef.current.length === 0) return;
    const events = queueRef.current.splice(0);
    try {
      await listeningApi.ingest(events);
      console.log(`[ListeningTracker] 上报 ${events.length} 条聆听事件成功`);
    } catch (err) {
      // 发送失败：将事件放回队列头部，下次重试
      console.warn('[ListeningTracker] 上报失败，事件将重试:', err);
      queueRef.current.unshift(...events);
    }
  }, []);

  /** 曲目切换时发送 skip（上一首未播完）和 play（新曲）事件 */
  useEffect(() => {
    if (!currentTrack) return;

    // 上一首存在且未播完 → 发送 skip 事件
    if (prevTrackRef.current && !completedRef.current) {
      const prevDuration = prevDurationRef.current || duration;
      const prevPosition = prevPositionRef.current || position;
      // 根据播放比例计算 engagementScore（0.1 ~ 0.5）
      const ratio = prevDuration > 0 ? Math.min(prevPosition / prevDuration, 1) : 0;
      const engagementScore = Math.max(0.1, Math.min(0.5, ratio * 0.5));

      enqueue({
        songId: prevTrackRef.current.id,
        trackTitle: prevTrackRef.current.title,
        trackArtist: prevTrackRef.current.artist,
        eventType: 'skip',
        positionMs: Math.round(prevPosition),
        durationMs: Math.round(prevDuration),
        engagementScore,
      });
    }

    // 发送新曲的 play 事件
    enqueue({
      songId: currentTrack.id,
      trackTitle: currentTrack.title,
      trackArtist: currentTrack.artist,
      eventType: 'play',
      positionMs: 0,
      durationMs: Math.round(duration),
      engagementScore: 0.3,
    });

    // 重置状态
    prevTrackRef.current = currentTrack;
    completedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id]);

  /** 持续记录当前播放位置，供切歌时计算 skip 的 engagementScore */
  useEffect(() => {
    if (currentTrack && isPlaying) {
      prevPositionRef.current = position;
      prevDurationRef.current = duration;
    }
  }, [position, duration, isPlaying, currentTrack]);

  /** 标记当前曲目自然播完，发送 complete 事件 */
  const markComplete = useCallback(() => {
    const track = prevTrackRef.current || currentTrack;
    if (!track || completedRef.current) return;
    completedRef.current = true;

    enqueue({
      songId: track.id,
      trackTitle: track.title,
      trackArtist: track.artist,
      eventType: 'complete',
      positionMs: Math.round(duration),
      durationMs: Math.round(duration),
      engagementScore: 1.0,
    });
  }, [currentTrack, duration, enqueue]);

  /** 标记收藏，发送 favorite 事件 */
  const markFavorite = useCallback((songId: string, title?: string, artist?: string) => {
    enqueue({
      songId,
      trackTitle: title,
      trackArtist: artist,
      eventType: 'favorite',
      engagementScore: 1.0,
    });
  }, [enqueue]);

  /** 定时 flush + 页面卸载时 flush */
  useEffect(() => {
    flushTimerRef.current = setInterval(flush, FLUSH_INTERVAL);

    // 页面卸载时用 sendBeacon 尽力上报
    const handleUnload = () => {
      if (queueRef.current.length === 0) return;
      const url = `${API_BASE}/listening/events`;
      const body = JSON.stringify({ events: queueRef.current });
      try {
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      } catch {
        // sendBeacon 不可用时忽略
      }
    };
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
      window.removeEventListener('beforeunload', handleUnload);
      // 组件卸载时最后 flush 一次
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { markComplete, markFavorite, flush };
}
