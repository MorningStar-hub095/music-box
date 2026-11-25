// web/src/components/PlaylistShelf.tsx
// 3D 立体歌单架 — CSS 3D coverflow：封面卡片悬浮成架，拖拽/滚轮滑动，点击切歌单
// 相比 WebGL 贴图方案：无跨域纹理问题、CPU/GPU 占用低、文字始终清晰

import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { PlaylistItem } from '../hooks/usePlaylistManager';
import { XIcon } from './Icons';
import { resolveCoverUrl } from '../services/cover'; // 2026-11-20 封面代理修复
import './PlaylistShelf.css';

interface PlaylistShelfProps {
  visible: boolean;
  onClose: () => void;
  playlists: PlaylistItem[];
  /** 歌单内首个可播放歌曲的封面查找 */
  resolveCover: (playlist: PlaylistItem) => { cover: string | null; color: string };
  currentPlaylistId: string | null;
  onSwitch: (playlistId: string) => void;
  /** 获取歌单歌曲数 */
  getTrackCount: (playlist: PlaylistItem) => number;
}

const VISIBLE_RANGE = 4; // 中心两侧各渲染几张
const STEP_X = 240;      // 相邻卡片水平间距
const STEP_Z = 170;      // 越远越靠后
const ANGLE = 38;        // 侧卡旋转角

export const PlaylistShelf: React.FC<PlaylistShelfProps> = ({
  visible, onClose, playlists, resolveCover, currentPlaylistId, onSwitch, getTrackCount,
}) => {
  // 初始定位到当前歌单
  const initialIdx = Math.max(0, playlists.findIndex(p => p.id === currentPlaylistId));
  const [center, setCenter] = useState(initialIdx);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startCenter: number } | null>(null);
  const shelfRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible) {
      setCenter(Math.max(0, playlists.findIndex(p => p.id === currentPlaylistId)));
    }
  }, [visible, playlists, currentPlaylistId]);

  // ESC 关闭
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  const clamp = useCallback((v: number) =>
    Math.min(playlists.length - 1, Math.max(0, v)), [playlists.length]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    setDragging(true);
    dragRef.current = { startX: e.clientX, startCenter: center };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [center]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    // 阻尼：拖拽距离按比例映射到卡位，手感更"重"
    setCenter(clamp(dragRef.current.startCenter - dx / STEP_X * 0.85));
  }, [clamp]);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
    // 吸附到最近整数位
    setCenter(c => clamp(Math.round(c)));
  }, [clamp]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
    setCenter(c => clamp(Math.round(c + Math.sign(delta))));
  }, [clamp]);

  const handleCardClick = useCallback((id: string, index: number) => {
    if (dragging) return;
    if (Math.abs(index - center) > 0.4) {
      setCenter(index); // 点侧卡 → 转到该卡
    } else {
      onSwitch(id);      // 点中心卡 → 切换歌单
      onClose();
    }
  }, [center, dragging, onSwitch, onClose]);

  if (!visible) return null;

  return (
    <div className="shelf-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <button className="shelf-close" onClick={onClose} title="关闭歌单架 (ESC)">
        <XIcon size={18} />
      </button>
      <div className="shelf-title">我的歌单架</div>
      <div className="shelf-subtitle">拖拽或滚轮滑动 · 点击中心卡片切换歌单</div>

      <div
        ref={shelfRef}
        className={`shelf-stage${dragging ? ' dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
      >
        <div className="shelf-inner">
          {playlists.map((p, i) => {
            const offset = i - center;
            if (Math.abs(offset) > VISIBLE_RANGE) return null;
            const { cover, color } = resolveCover(p);
            const isCenter = Math.abs(offset) < 0.5;
            return (
              <div
                key={p.id}
                className={`shelf-card${isCenter ? ' center' : ''}${p.id === currentPlaylistId ? ' current' : ''}`}
                style={{
                  transform: `translateX(${offset * STEP_X}px) translateZ(${-Math.abs(offset) * STEP_Z}px) rotateY(${-offset * ANGLE}deg)`,
                  zIndex: 100 - Math.round(Math.abs(offset) * 10),
                }}
                onClick={() => handleCardClick(p.id, i)}
              >
                <div className="shelf-card-cover" style={{ background: `linear-gradient(135deg, ${color}, var(--color-bg-card, #1a1a2e))` }}>
                  {/* [2026-11-20 封面代理修复] 旧实现（直连外链被网易云防盗链 403）：<img src={cover} ... /> */}
                  {resolveCoverUrl(cover)
                    ? <img src={resolveCoverUrl(cover)} alt={p.name} loading="lazy" draggable={false} referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    : <span className="shelf-card-note">♪</span>}
                </div>
                <div className="shelf-card-name" title={p.name}>{p.name}</div>
                <div className="shelf-card-count">{getTrackCount(p)} 首</div>
                {p.id === currentPlaylistId && <div className="shelf-card-badge">当前</div>}
              </div>
            );
          })}
        </div>
        {/* 架面反光 */}
        <div className="shelf-floor" />
      </div>

      <div className="shelf-hint">
        {playlists[Math.round(center)]?.name || ''}
      </div>
    </div>
  );
};
