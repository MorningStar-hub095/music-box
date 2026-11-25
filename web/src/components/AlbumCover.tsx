// web/src/components/AlbumCover.tsx
// 专辑封面组件 — 圆形+3D翻转+渐变默认封面
import React, { useState } from 'react';
import { MusicIcon } from './Icons';
import { resolveCoverUrl } from '../services/cover'; // 2026-11-20 封面代理修复
import './AlbumCover.css';

interface AlbumCoverProps {
  albumCover?: string;
  title: string;
  artist: string;
  isPlaying: boolean;
  isLoading?: boolean;
  coverColor: string;
  trackId: string;
  onDoubleClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export const AlbumCover: React.FC<AlbumCoverProps> = ({
  albumCover,
  title,
  artist,
  isPlaying,
  isLoading = false,
  coverColor = '#6366F1',
  trackId,
  onDoubleClick,
}) => {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const showDefault = !albumCover || imgError;

  return (
    <div className="album-cover-wrap" onDoubleClick={onDoubleClick}>
      {/* 外层：3D 翻转（trackId 变化时触发） */}
      <div key={trackId} className="album-cover-flip">
        {/* 内层：播放时悬浮动画 */}
        <div className={`album-cover-float${isPlaying ? ' playing' : ''}`}>
          <div
            className="album-cover-circle"
            style={{ '--cover-color': coverColor } as React.CSSProperties}
          >
            {/* 真实封面图 */}
            {!showDefault && (
              <img
                /* [2026-11-20 封面代理修复] 旧实现（直连外链被网易云防盗链 403）：src={albumCover} */
                src={resolveCoverUrl(albumCover)}
                alt={title}
                className={`album-cover-img${imgLoaded ? ' loaded' : ''}`}
                referrerPolicy="no-referrer"
                crossOrigin="anonymous"
                onLoad={() => setImgLoaded(true)}
                onError={() => setImgError(true)}
              />
            )}

            {/* 默认封面：渐变 + 歌名首字 + 音符图标 */}
            {showDefault && (
              <div className="album-cover-default">
                <MusicIcon size={56} className="default-music-icon" />
                <span className="default-letter">{title.charAt(0)}</span>
                <span className="default-artist">{artist}</span>
              </div>
            )}

            {/* 加载中 */}
            {isLoading && <div className="album-cover-loading" />}

            {/* 外光环 */}
            <div
              className={`album-cover-ring${isPlaying ? ' playing' : ''}`}
              style={{ '--cover-color': coverColor } as React.CSSProperties}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
