// web/src/components/StageLyrics.tsx
// 沉浸舞台 · 滚动歌词（Mineradio 式歌词舞台，自研实现）
// 形态：连续滚动列表 + 当前行居中辉光 + 节拍脉动 + 点击跳转 + 滚轮浏览回弹
// 与粒子舞台同步：低音推动整列呼吸，节拍点亮当前行辉光
import React, { useRef, useState, useCallback, useEffect } from 'react';
import type { AudioFeatures } from '../hooks/useAudioAnalyser';
import type { LyricLine } from '../../../shared/types';
import './StageLyrics.css';

const ZERO_FEATURES: AudioFeatures = {
  subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0,
  presence: 0, brilliance: 0, air: 0,
  warmth: 0.6, brightness: 0.3, sharpness: 0,
  smoothness: 0.7, density: 0, spectralCentroid: 0,
  energy: 0, beat: 0, beatStrength: 0,
};

/** 歌词行槽位高度（与 StageLyrics.css 的 --line-h 保持一致） */
const LINE_H = 68;
/** 滚轮浏览停止后自动回弹到当前播放行 */
const REBOUND_DELAY = 5000;

interface StageLyricsProps {
  lyrics: LyricLine[];
  currentIndex: number;
  isPlaying: boolean;
  onSeek: (timeMs: number) => void;
  getFeatures: () => AudioFeatures;
}

export const StageLyrics: React.FC<StageLyricsProps> = ({
  lyrics, currentIndex, isPlaying, onSeek, getFeatures,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  // 浏览模式：滚轮/触摸浏览时 selectedIndex 偏离 currentIndex
  const [selectedIndex, setSelectedIndex] = useState(currentIndex);
  const isBrowsingRef = useRef(false);
  const reboundTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWheelRef = useRef(0);

  // rAF 循环读取的焦点行（避免重挂 effect）
  const focusRef = useRef(currentIndex);
  useEffect(() => {
    focusRef.current = isBrowsingRef.current ? selectedIndex : currentIndex;
  }, [selectedIndex, currentIndex]);

  // 换歌时列表瞬移到目标位置（不做长距离飞行）
  const snapRef = useRef(true);
  useEffect(() => {
    snapRef.current = true;
  }, [lyrics]);

  // ── 主循环：弹簧滚动 + 音频脉动 ──
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let cur = 0; // 当前 translateY（焦点行位于列表中心）
    let energy = 0;
    let beatPulse = 0;

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const target = -(focusRef.current * LINE_H + LINE_H / 2);
      if (snapRef.current) {
        cur = target;
        snapRef.current = false;
      } else {
        cur += (target - cur) * Math.min(1, dt * 7);
      }

      const f = isPlayingRef.current ? getFeatures() : ZERO_FEATURES;
      energy += (f.energy - energy) * Math.min(1, dt * 5);
      // 节拍上升沿 → 点亮，随后衰减
      if (isPlayingRef.current && f.beat > 0.88) {
        beatPulse = Math.min(1, 0.55 + f.beatStrength * 0.45);
      }
      beatPulse = Math.max(0, beatPulse - dt * 2.4);

      if (listRef.current) {
        listRef.current.style.transform =
          `translateY(${cur.toFixed(2)}px) scale(${(1 + energy * 0.016).toFixed(4)})`;
      }
      if (wrapRef.current) {
        wrapRef.current.style.setProperty('--pulse', beatPulse.toFixed(3));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [getFeatures]);

  // ── 浏览回弹 ──
  const resetRebound = useCallback(() => {
    if (reboundTimerRef.current) clearTimeout(reboundTimerRef.current);
    reboundTimerRef.current = setTimeout(() => {
      isBrowsingRef.current = false;
      setSelectedIndex(currentIndex);
    }, REBOUND_DELAY);
  }, [currentIndex]);

  useEffect(() => () => {
    if (reboundTimerRef.current) clearTimeout(reboundTimerRef.current);
  }, []);

  // ── 滚轮浏览（原生监听，可 preventDefault）──
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      const now = performance.now();
      const dt = now - lastWheelRef.current;
      lastWheelRef.current = now;
      const steps = dt < 80 ? 3 : dt < 200 ? 2 : 1;
      isBrowsingRef.current = true;
      setSelectedIndex(prev =>
        Math.max(0, Math.min(lyrics.length - 1, prev + dir * steps)),
      );
      resetRebound();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [lyrics.length, resetRebound]);

  // ── 点击歌词行 → 跳转播放 ──
  const handleClick = useCallback((idx: number) => {
    const line = lyrics[idx];
    if (!line || line.time < 0) return;
    onSeek(line.time);
    isBrowsingRef.current = false;
    if (reboundTimerRef.current) {
      clearTimeout(reboundTimerRef.current);
      reboundTimerRef.current = null;
    }
    setSelectedIndex(idx);
  }, [lyrics, onSeek]);

  // ── 触摸滑动浏览 ──
  const touchYRef = useRef<number | null>(null);
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchYRef.current = e.touches[0].clientY;
  }, []);
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchYRef.current === null) return;
    const dy = e.touches[0].clientY - touchYRef.current;
    if (Math.abs(dy) > 40) {
      isBrowsingRef.current = true;
      const dir = dy > 0 ? 1 : -1;
      setSelectedIndex(prev =>
        Math.max(0, Math.min(lyrics.length - 1, prev + dir)),
      );
      touchYRef.current = e.touches[0].clientY;
      resetRebound();
    }
  }, [lyrics.length, resetRebound]);
  const onTouchEnd = useCallback(() => { touchYRef.current = null; }, []);

  if (!lyrics.length) {
    return (
      <div className="stage-lyrics" ref={wrapRef}>
        <div className="stage-lyrics-empty">♪ 纯音乐 · 尽情享受</div>
      </div>
    );
  }

  const isBrowsing = isBrowsingRef.current || selectedIndex !== currentIndex;
  const focus = isBrowsing ? selectedIndex : currentIndex;

  return (
    <div
      className={`stage-lyrics${isBrowsing ? ' browsing' : ''}`}
      ref={wrapRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="stage-lyrics-list" ref={listRef}>
        {lyrics.map((line, idx) => {
          const d = Math.abs(idx - focus);
          const isActive = !isBrowsing && idx === currentIndex;
          const isSelected = isBrowsing && idx === selectedIndex;
          // 距离衰减：透明度 / 虚化 / 缩放
          const opacity = Math.max(0.1, 1 - d * 0.16);
          const blur = d > 2 ? Math.min(3, (d - 2) * 0.7) : 0;
          const scale = 1 - Math.min(0.22, d * 0.04);
          const cls = isActive ? 'active' : isSelected ? 'selected' : '';
          return (
            <div
              key={idx}
              className={`stage-lyric-line ${cls}`}
              data-index={idx}
              style={{
                opacity,
                filter: blur > 0 ? `blur(${blur}px)` : undefined,
                transform: `scale(${scale.toFixed(3)})`,
              }}
              onClick={() => handleClick(idx)}
            >
              <span className="stage-lyric-text">{line.text || '♪'}</span>
            </div>
          );
        })}
      </div>
      {isBrowsing && (
        <div className="stage-lyrics-hint">浏览中 · 点击歌词行跳转</div>
      )}
    </div>
  );
};
