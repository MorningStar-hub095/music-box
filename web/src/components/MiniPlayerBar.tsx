import React, { useRef } from 'react';
import { Track } from '@/types';
import { PlayIcon, PauseIcon, SkipBackIcon, SkipForwardIcon, HeartIcon } from './Icons';
import { resolveCoverUrl } from '../services/cover'; // 2026-11-20 封面代理修复
import './MiniPlayerBar.css';

const formatTime = (ms: number): string => {
  if (!ms || ms < 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const mm = Math.floor(total / 60).toString().padStart(2, '0');
  const ss = (total % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
};

export interface MiniPlayerBarProps {
  track: Track;
  isPlaying: boolean;
  position: number;
  duration: number;
  fav: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleFavorite: () => void;
  onSeek: (ms: number) => void;
  onEnterStage: () => void;
}

/** 首页态悬浮玻璃迷你播放条（播放态由 ImmersiveStage 承担） */
export const MiniPlayerBar: React.FC<MiniPlayerBarProps> = ({
  track,
  isPlaying,
  position,
  duration,
  fav,
  onTogglePlay,
  onPrev,
  onNext,
  onToggleFavorite,
  onSeek,
  onEnterStage,
}) => {
  const barRef = useRef<HTMLDivElement>(null);
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  };

  return (
    <div className="mini-bar" ref={barRef}>
      {/* 顶部细进度线 */}
      <div className="mini-bar-progress" onClick={handleProgressClick} title="点击跳转进度">
        <div className="mini-bar-progress-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="mini-bar-track" onDoubleClick={onEnterStage} title="双击进入沉浸舞台">
        <div
          className={`mini-bar-cover${isPlaying ? ' playing' : ''}`}
          style={{ background: `linear-gradient(135deg, ${track.coverColor} 0%, #0F1228 130%)` }}
        >
          {/* [2026-11-20 封面代理修复] 旧实现（直连外链被网易云防盗链 403，且无 onError 兜底）：
              {track.albumCover ? <img src={track.albumCover} alt="" /> : <span>♪</span>} */}
          {resolveCoverUrl(track.albumCover) ? (
            <img
              key={track.id}
              src={resolveCoverUrl(track.albumCover)}
              alt=""
              referrerPolicy="no-referrer"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : <span>♪</span>}
        </div>
        <div className="mini-bar-info">
          <span className="mini-bar-title">{track.title}</span>
          <span className="mini-bar-artist">{track.artist} · {formatTime(position)}/{formatTime(duration)}</span>
        </div>
      </div>

      <div className="mini-bar-controls">
        <button className="mini-bar-btn" onClick={onPrev} title="上一首"><SkipBackIcon size={15} /></button>
        <button className="mini-bar-btn mini-bar-play" onClick={onTogglePlay} title={isPlaying ? '暂停' : '播放'}>
          {isPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
        </button>
        <button className="mini-bar-btn" onClick={onNext} title="下一首"><SkipForwardIcon size={15} /></button>
      </div>

      <div className="mini-bar-actions">
        <button
          className={`mini-bar-btn${fav ? ' fav' : ''}`}
          onClick={onToggleFavorite}
          title="收藏"
        >
          <HeartIcon size={15} fill={fav ? 'currentColor' : 'none'} />
        </button>
        <button className="mini-bar-btn mini-bar-stage" onClick={onEnterStage} title="沉浸舞台 (F)">
          🎬
        </button>
      </div>
    </div>
  );
};
