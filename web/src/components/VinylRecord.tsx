// web/src/components/VinylRecord.tsx
// 黑胶唱片组件 — 现代磨砂风格，播放时旋转，中心显示专辑封面
import React from 'react';
import { MusicIcon } from './Icons';
import { resolveCoverUrl } from '../services/cover'; // 2026-11-20 封面代理修复
import './VinylRecord.css';

interface VinylRecordProps {
  /** 专辑封面图片URL */
  albumCover?: string;
  /** 歌曲标题（用于alt文本） */
  title: string;
  /** 是否正在播放 */
  isPlaying: boolean;
  /** 是否正在加载 */
  isLoading?: boolean;
  /** 封面颜色（用于渐变背景） */
  coverColor?: string;
  /** 双击回调 */
  onDoubleClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export const VinylRecord: React.FC<VinylRecordProps> = ({
  albumCover,
  title,
  isPlaying,
  isLoading = false,
  coverColor = '#1a1a2e',
  onDoubleClick,
}) => {
  return (
    <div className={`vinyl-container${isPlaying ? ' playing' : ''}`}>
      {/* 唱片主体 */}
      <div
        className="vinyl-disc"
        onDoubleClick={onDoubleClick}
        title="双击左右区域快退/快进"
      >
        {/* 纹路纹理层 */}
        <div className="vinyl-grooves" aria-hidden="true" />

        {/* 边缘光晕 */}
        <div className="vinyl-glow" aria-hidden="true" />

        {/* 中心封面区域 */}
        <div
          className="vinyl-center"
          style={{
            background: albumCover
              ? 'transparent'
              : `linear-gradient(135deg, ${coverColor} 0%, #1a1a2e 100%)`,
          }}
        >
          {albumCover ? (
            <img
              /* [2026-11-20 封面代理修复] 旧实现（直连外链被网易云防盗链 403）：src={albumCover} */
              src={resolveCoverUrl(albumCover)}
              alt={title}
              className="vinyl-cover-img"
              referrerPolicy="no-referrer"
              crossOrigin="anonymous"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
              }}
            />
          ) : (
            <div className="vinyl-icon">
              <MusicIcon size={24} />
            </div>
          )}
        </div>

        {/* 中心孔 */}
        <div className="vinyl-hole" aria-hidden="true" />

        {/* 加载指示器 */}
        {isLoading && <div className="vinyl-loading" />}
      </div>
    </div>
  );
};
