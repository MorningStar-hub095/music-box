import { useEffect, useState, useCallback, useRef } from 'react';
import { recommendationApi, RecommendedSong } from '../services/api';
import { resolveCoverUrl } from '../services/cover'; // 2026-11-20 封面代理修复
import './DailyRecommendation.css';

// 骨架屏卡片数量
const SKELETON_COUNT = 6;

function SkeletonScreen() {
  return (
    <div className="daily-skeleton">
      <div className="daily-skeleton-header">
        <div className="daily-skeleton-title" />
        <div className="daily-skeleton-date" />
      </div>
      <div className="daily-skeleton-grid">
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <div
            className="daily-skeleton-card"
            key={i}
            style={{ animation: `daily-pulse 1.8s ease-in-out infinite ${i * 0.1}s` }}
          >
            <div className="daily-skeleton-rank" />
            <div className="daily-skeleton-cover" />
            <div className="daily-skeleton-info">
              <div className="daily-skeleton-name" />
              <div className="daily-skeleton-artist" />
            </div>
            <div className="daily-skeleton-actions">
              <div className="daily-skeleton-btn" />
              <div className="daily-skeleton-btn" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 格式化秒数为 mm:ss */
function formatTime(sec: number): string {
  if (!sec || !isFinite(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/** 封面：用 <img> 加载以支持 referrerPolicy="no-referrer"（规避网易云图片防盗链），加载失败时回退渐变 */
function DailyCover({ albumCover, coverColor, children }: {
  albumCover?: string;
  coverColor?: string;
  children?: React.ReactNode;
}) {
  const [imgError, setImgError] = useState(false);
  // 2026-11-20 封面代理修复：解析后的代理地址（本地路径原样、空值 undefined）
  const coverSrc = resolveCoverUrl(albumCover);
  const showImg = !!coverSrc && !imgError;
  return (
    <div
      className="daily-cover"
      style={{
        background: `linear-gradient(135deg, ${
          coverColor || 'var(--color-primary)'
        } 0%, var(--color-bg-card) 100%)`,
      }}
    >
      {showImg && (
        <img
          className="daily-cover-img"
          /* [2026-11-20 封面代理修复] 旧实现（直连外链被网易云防盗链 403）：src={albumCover} */
          src={resolveCoverUrl(albumCover)}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setImgError(true)}
        />
      )}
      {!showImg && <span className="daily-cover-icon">♪</span>}
      {children}
    </div>
  );
}

/** 从父组件传入的播放器状态 */
export interface PlayerState {
  currentTrackId: string | null;
  isPlaying: boolean;
  position: number; // 毫秒
  duration: number; // 毫秒
  seek: (ms: number) => void; // 跳转到指定位置（毫秒）
}

interface DailyRecommendationProps {
  onPlaySong?: (song: RecommendedSong, allSongs: RecommendedSong[]) => void;
  playerState?: PlayerState;
}

export default function DailyRecommendation({ onPlaySong, playerState }: DailyRecommendationProps) {
  const [songs, setSongs] = useState<RecommendedSong[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [dislikingId, setDislikingId] = useState<string | null>(null);
  // A2: 音频预加载缓存
  const preloadCache = useRef<Map<string, HTMLAudioElement>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await recommendationApi.getDaily();
      setSongs(data.songs || []);
      setGeneratedAt(data.generatedAt || null);
    } catch (e) {
      console.error('[DailyRecommendation] 加载推荐失败', e);
      setError(e instanceof Error ? e.message : '加载推荐失败');
      setSongs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 从 playerState 派生当前播放状态
  const playingId = playerState?.currentTrackId ?? null;
  const isPlaying = playerState?.isPlaying ?? false;
  const currentPos = playerState ? playerState.position / 1000 : 0; // 转为秒
  const totalDur = playerState ? playerState.duration / 1000 : 0;
  const progress = totalDur > 0 ? currentPos / totalDur : 0;

  const handlePlay = useCallback((song: RecommendedSong) => {
    if (!song.audioUrl) return;
    onPlaySong?.(song, songs);
  }, [onPlaySong, songs]);

  const handleFeedback = useCallback(async (songId: string, feedback: 'like' | 'dislike', e: React.MouseEvent) => {
    e.stopPropagation(); // 阻止冒泡到卡片点击
    try {
      if (feedback === 'dislike') {
        setDislikingId(songId);
      }
      await recommendationApi.feedback(songId, feedback);
      if (feedback === 'dislike') {
        await load();
      } else {
        setLikedIds(prev => {
          const next = new Set(prev);
          next.add(songId);
          return next;
        });
      }
    } catch (e) {
      console.error('[DailyRecommendation] 反馈失败', e);
      setError(e instanceof Error ? e.message : '反馈失败');
    } finally {
      setDislikingId(null);
    }
  }, [load]);

  // 进度条点击跳转（使用 playerState.seek 而非 document.querySelector）
  const handleProgressClick = useCallback((e: React.MouseEvent, songId: string) => {
    e.stopPropagation();
    if (playingId !== songId || !isPlaying || !playerState?.seek) return;
    if (!totalDur || totalDur <= 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    // seek 接受毫秒，totalDur 是秒，需要转换
    playerState.seek(ratio * totalDur * 1000);
  }, [playingId, isPlaying, playerState, totalDur]);

  // A2: Hover 预加载音频
  const handleMouseEnter = useCallback((song: RecommendedSong) => {
    if (!song.audioUrl || preloadCache.current.has(song.id)) return;
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = song.audioUrl;
    preloadCache.current.set(song.id, audio);
  }, []);

  const handleMouseLeave = useCallback((songId: string) => {
    const cached = preloadCache.current.get(songId);
    if (cached) {
      cached.pause();
      cached.removeAttribute('src');
      cached.load();
      preloadCache.current.delete(songId);
    }
  }, []);

  // 清理预加载缓存
  useEffect(() => {
    return () => {
      preloadCache.current.forEach(audio => { audio.pause(); audio.src = ''; });
      preloadCache.current.clear();
    };
  }, []);

  if (loading) {
    return <SkeletonScreen />;
  }

  return (
    <div className="daily-rec">
      <header className="daily-header">
        <h3 className="daily-title">今日为你 · {songs.length} 首</h3>
        {generatedAt && (
          <p className="daily-date">
            生成于 {new Date(generatedAt).toLocaleDateString('zh-CN')}
          </p>
        )}
      </header>

      {error && (
        <div className="daily-error">
          <span className="daily-error-icon">!</span>
          <p className="daily-error-text">{error}</p>
          <button className="daily-retry-btn" onClick={load}>重试</button>
        </div>
      )}

      {!error && songs.length === 0 ? (
        <div className="daily-empty">
          <span className="daily-empty-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#17C3B2" strokeWidth="1.5">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </span>
          <p>暂无推荐</p>
          <span className="daily-empty-hint">多听几首歌后再来看看吧</span>
        </div>
      ) : (
        !error && (
          <div className="daily-grid">
            {songs.map((s, i) => {
              const isCurrentTrack = playingId === s.id;
              const canPlay = s.playable !== false && !!s.audioUrl;
              return (
                <div
                  className={`daily-card${isCurrentTrack ? ' daily-card--playing' : ''}${canPlay ? ' daily-card--clickable' : ''}`}
                  key={s.id}
                  style={{ animationDelay: `${i * 0.06}s` }}
                  onClick={() => canPlay && handlePlay(s)}
                  onMouseEnter={() => canPlay && handleMouseEnter(s)}
                  onMouseLeave={() => handleMouseLeave(s.id)}
                >
                  <span className={`daily-rank${i < 3 ? ` daily-rank-${i + 1}` : ''}`}>
                    #{i + 1}
                  </span>
                  <DailyCover albumCover={s.albumCover} coverColor={s.coverColor}>
                    {/* 播放/暂停图标覆盖层 */}
                    {(canPlay || isCurrentTrack) && (
                      <div className="daily-play-overlay">
                        {isCurrentTrack && isPlaying ? (
                          <svg className="daily-play-icon" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="4" width="4" height="16" rx="1" />
                            <rect x="14" y="4" width="4" height="16" rx="1" />
                          </svg>
                        ) : (
                          <svg className="daily-play-icon" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        )}
                      </div>
                    )}
                  </DailyCover>
                  <div className="daily-info">
                    <span className="daily-name">{s.title}</span>
                    <span className="daily-artist">{s.artist}</span>
                    {/* 进度条：当前曲目播放或暂停时都显示 */}
                    {isCurrentTrack && totalDur > 0 && (
                      <div className="daily-progress-wrap">
                        <div
                          className="daily-progress-bar"
                          onClick={(e) => handleProgressClick(e, s.id)}
                        >
                          <div
                            className="daily-progress-fill"
                            style={{ width: `${progress * 100}%` }}
                          />
                        </div>
                        <span className="daily-progress-time">
                          {formatTime(currentPos)} / {formatTime(totalDur)}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="daily-actions">
                    <button
                      className={`daily-btn like${likedIds.has(s.id) ? ' liked' : ''}`}
                      onClick={(e) => handleFeedback(s.id, 'like', e)}
                      aria-label="喜欢"
                    >
                      👍
                    </button>
                    <button
                      className={`daily-btn dislike${dislikingId === s.id ? ' liking' : ''}`}
                      onClick={(e) => handleFeedback(s.id, 'dislike', e)}
                      aria-label="不喜欢"
                      disabled={dislikingId === s.id}
                    >
                      👎
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
