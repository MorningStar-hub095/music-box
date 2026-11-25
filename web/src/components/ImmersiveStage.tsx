// web/src/components/ImmersiveStage.tsx
// 沉浸播放态 · 全屏舞台：粒子视觉 + 发光歌词 + 电影镜头合一
// ESC 退出；DJ/播客等长内容自动切换舒缓视觉节奏（长内容模式）

import React, { useEffect, useState, useCallback } from 'react';
import { StageScene } from '../sonic/StageScene';
import { STAGE_PRESETS, LONG_CONTENT_THRESHOLD_MS } from '../sonic/stage-presets';
import { useStagePreset } from '../hooks/useStagePreset';
import type { AudioFeatures } from '../hooks/useAudioAnalyser';
import type { LyricLine } from '../../../shared/types';
import { StageLyrics } from './StageLyrics';
import { PlayIcon, PauseIcon, SkipBackIcon, SkipForwardIcon, XIcon } from './Icons';
import { resolveCoverUrl } from '../services/cover'; // 2026-11-20 封面代理修复
import './ImmersiveStage.css';

const formatTime = (ms: number): string => {
  if (!ms || ms < 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const mm = Math.floor(total / 60).toString().padStart(2, '0');
  const ss = (total % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
};

const toCssRgb = (c: [number, number, number]) =>
  `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

interface ImmersiveStageProps {
  visible: boolean;
  onClose: () => void;
  trackTitle: string;
  trackArtist: string;
  /** 专辑封面 URL：化作场景环境光晕（Mineradio 式封面氛围光） */
  coverUrl?: string | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  onSeek: (ms: number) => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  getFeatures: () => AudioFeatures;
  lyrics: LyricLine[];
  lyricIndex: number;
  onLyricSeek: (ms: number) => void;
}

export const ImmersiveStage: React.FC<ImmersiveStageProps> = ({
  visible, onClose, trackTitle, trackArtist, coverUrl,
  isPlaying, position, duration, onSeek, onTogglePlay, onPrev, onNext,
  getFeatures, lyrics, lyricIndex, onLyricSeek,
}) => {
  const {
    preset, presetKey, setPresetKey,
    slots, saveToSlot, applySlot, clearSlot,
    glowScale, setGlowScale, densityScale, setDensityScale,
    exportCurrent, importFromText,
  } = useStagePreset();
  const [showConsole, setShowConsole] = useState(false);
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [longContent, setLongContent] = useState(false);

  // 2026-11-20 封面代理修复：外链封面改走服务端代理，避免网易云防盗链 403
  const stageCover = resolveCoverUrl(coverUrl);

  // 长内容判定：时长超过阈值（DJ 混音/播客）→ 切换舒缓视觉节奏
  useEffect(() => {
    setLongContent(duration > LONG_CONTENT_THRESHOLD_MS);
  }, [duration]);

  // ESC 退出 + body 类标记（用于提升歌词层级）
  useEffect(() => {
    if (!visible) return;
    document.body.classList.add('immersive-stage-active');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); }
      else if (e.key === ' ') {
        const t = e.target as HTMLElement;
        if (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') { e.preventDefault(); onTogglePlay(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('immersive-stage-active');
      window.removeEventListener('keydown', onKey);
    };
  }, [visible, onClose, onTogglePlay]);

  const handleExport = useCallback(() => {
    const json = exportCurrent();
    navigator.clipboard?.writeText(json).then(
      () => setImportMsg('已复制到剪贴板，可直接发给朋友'),
      () => setImportMsg('复制失败，请手动选择文本'),
    );
  }, [exportCurrent]);

  const handleImport = useCallback(() => {
    if (!importText.trim()) return;
    if (importFromText(importText)) {
      setImportMsg('导入成功');
      setImportText('');
    } else {
      setImportMsg('导入失败：内容不是有效的舞台配置');
    }
  }, [importText, importFromText]);

  // 提示自动消失
  useEffect(() => {
    if (!importMsg) return;
    const t = setTimeout(() => setImportMsg(null), 3000);
    return () => clearTimeout(t);
  }, [importMsg]);

  if (!visible) return null;

  return (
    <div
      className="immersive-stage"
      style={{
        background: `radial-gradient(ellipse at 50% 40%, ${toCssRgb(preset.background.map((v, i) => (i === 0 ? v : v * 1.6)) as [number, number, number])} 0%, ${toCssRgb(preset.background)} 70%)`,
      }}
      onDoubleClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* 封面环境光晕：专辑封面化作场景氛围光（Mineradio 式） */}
      {stageCover && (
        <div className={`stage-ambient-cover${isPlaying ? ' playing' : ''}`} aria-hidden>
          {/* [2026-11-20 封面代理修复] 旧实现（直连外链被网易云防盗链 403）：<img src={coverUrl} alt="" /> */}
          <img src={stageCover} alt="" referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        </div>
      )}

      {/* 粒子舞台（R3F） */}
      <StageScene
        preset={preset}
        getFeatures={getFeatures}
        isPlaying={isPlaying}
        longContent={longContent}
        densityScale={densityScale}
      />

      {/* 电影质感层：暗角 + 胶片颗粒 */}
      <div className="stage-vignette" aria-hidden />
      <div className="stage-grain" aria-hidden />

      {/* 滚动歌词舞台（Mineradio 式：连续滚动 + 当前行辉光 + 节拍脉动） */}
      <StageLyrics
        lyrics={lyrics}
        currentIndex={lyricIndex}
        isPlaying={isPlaying}
        onSeek={onLyricSeek}
        getFeatures={getFeatures}
      />

      {/* 顶部：封面唱片 + 曲目信息 + 徽标 */}
      <div className="stage-top">
        <div className="stage-track-info">
          {stageCover && (
            <div className={`stage-cover-disc${isPlaying ? ' playing' : ''}`} aria-hidden>
              {/* [2026-11-20 封面代理修复] 旧实现（直连外链被网易云防盗链 403）：<img src={coverUrl} alt="" /> */}
              <img key={trackTitle} src={stageCover} alt="" referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            </div>
          )}
          <div className="stage-track-meta">
            <span className="stage-track-title">{trackTitle}</span>
            <span className="stage-track-artist">{trackArtist}</span>
          </div>
        </div>
        <div className="stage-top-right">
          {longContent && <span className="stage-badge">长内容模式 · 视觉已放缓</span>}
          <span className="stage-badge preset-badge">{preset.label}</span>
          <button className="stage-exit" onClick={onClose} title="退出沉浸舞台 (ESC)">
            <XIcon size={16} />
          </button>
        </div>
      </div>

      {/* 底部控制台 */}
      <div className="stage-bottom">
        <div className="stage-progress-row">
          <span className="stage-time">{formatTime(position)}</span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={position}
            step={1000}
            className="stage-slider"
            style={{ '--p': `${duration ? Math.min(100, (position / duration) * 100) : 0}%` } as React.CSSProperties}
            onChange={(e) => onSeek(Number(e.target.value))}
          />
          <span className="stage-time">{formatTime(duration)}</span>
        </div>
        <div className="stage-controls">
          <button className="stage-ctrl" onClick={onPrev} title="上一首">
            <SkipBackIcon size={18} />
          </button>
          <button
            className={`stage-play${isPlaying ? ' playing' : ''}`}
            onClick={onTogglePlay}
            title={isPlaying ? '暂停' : '播放'}
          >
            {isPlaying ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
          </button>
          <button className="stage-ctrl" onClick={onNext} title="下一首">
            <SkipForwardIcon size={18} />
          </button>
          <div className="stage-controls-spacer" />
          <button
            className={`stage-console-btn${showConsole ? ' active' : ''}`}
            onClick={() => setShowConsole(v => !v)}
            title="视觉控制台"
          >
            DIY
          </button>
        </div>
      </div>

      {/* 视觉控制台（DIY 抽屉） */}
      {showConsole && (
        <div className="stage-console">
          <div className="stage-console-title">视觉预设</div>
          <div className="stage-preset-grid">
            {Object.values(STAGE_PRESETS).map(p => (
              <button
                key={p.key}
                className={`stage-preset-card${p.key === presetKey ? ' active' : ''}`}
                onClick={() => setPresetKey(p.key)}
                title={p.description}
              >
                <span
                  className="stage-preset-swatch"
                  style={{ background: `linear-gradient(135deg, ${toCssRgb(p.colorA)}, ${toCssRgb(p.colorB)})` }}
                />
                <span>{p.label}</span>
              </button>
            ))}
          </div>

          <div className="stage-console-title">参数微调</div>
          <label className="stage-slider-row">
            <span>泛光</span>
            <input type="range" min={0.5} max={2} step={0.05} value={glowScale}
              onChange={e => setGlowScale(Number(e.target.value))} />
            <em>{glowScale.toFixed(2)}</em>
          </label>
          <label className="stage-slider-row">
            <span>密度</span>
            <input type="range" min={0.3} max={1.5} step={0.05} value={densityScale}
              onChange={e => setDensityScale(Number(e.target.value))} />
            <em>{densityScale.toFixed(2)}</em>
          </label>

          <div className="stage-console-title">存档槽</div>
          <div className="stage-slot-row">
            {slots.map((slot, i) => (
              <div key={i} className={`stage-slot${slot ? ' filled' : ''}`}>
                <button className="stage-slot-apply" onClick={() => slot ? applySlot(i) : saveToSlot(i)}
                  title={slot ? `应用：${slot.label || STAGE_PRESETS[slot.presetKey]?.label}` : '保存当前配置到此槽位'}>
                  {slot ? (slot.label || STAGE_PRESETS[slot.presetKey]?.label || `存档${i + 1}`) : `存入 ${i + 1}`}
                </button>
                {slot && (
                  <button className="stage-slot-clear" onClick={() => clearSlot(i)} title="清空此槽位">×</button>
                )}
              </div>
            ))}
          </div>

          <div className="stage-console-title">配置分享</div>
          <div className="stage-share-row">
            <button className="stage-share-btn" onClick={handleExport}>导出（复制）</button>
            <textarea
              className="stage-import-area"
              placeholder="粘贴朋友的舞台配置 JSON..."
              value={importText}
              onChange={e => setImportText(e.target.value)}
              rows={2}
            />
            <button className="stage-share-btn" onClick={handleImport}>导入</button>
          </div>
          {importMsg && <div className="stage-import-msg">{importMsg}</div>}
          <div className="stage-console-hint">ESC 退出 · 空格 播放/暂停 · 双击空白处退出</div>
        </div>
      )}
    </div>
  );
};
