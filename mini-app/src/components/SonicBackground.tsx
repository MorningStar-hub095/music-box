// mini-app/src/components/SonicBackground.tsx
// 音域回响伪 3D 柱网格背景 — Canvas 2D 实现 + 真实/伪音频驱动
import React, { useEffect, useRef, useState } from 'react';
import { Canvas } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { MINI_THEMES, MINI_THEME_KEYS } from '../sonic/themes';
import type { MiniAudioFeatures } from '../hooks/useMiniAudioAnalyser';

const GRID = 32;
const CELL = 10;

function noise2D(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1;
}
function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const a = noise2D(ix, iy), b = noise2D(ix + 1, iy);
  const c = noise2D(ix, iy + 1), d = noise2D(ix + 1, iy + 1);
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
}
function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function lerpColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`;
}

interface Ripple { x: number; z: number; time: number; strength: number; }

interface SonicBackgroundProps {
  isPlaying: boolean;
  features: MiniAudioFeatures;
}

export const SonicBackground: React.FC<SonicBackgroundProps> = ({ isPlaying, features }) => {
  const canvasRef = useRef<any>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);
  const themeIdxRef = useRef(0);
  const [themeLabel, setThemeLabel] = useState(MINI_THEMES[MINI_THEME_KEYS[0]].label);

  // 用 ref 存储最新 features 和 isPlaying，避免重建动画循环
  const featuresRef = useRef(features);
  featuresRef.current = features;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  // 波纹系统
  const ripplesRef = useRef<Ripple[]>([]);
  const beatActiveRef = useRef(false);

  // 主题轮询
  useEffect(() => {
    const timer = setInterval(() => {
      themeIdxRef.current = (themeIdxRef.current + 1) % MINI_THEME_KEYS.length;
      setThemeLabel(MINI_THEMES[MINI_THEME_KEYS[themeIdxRef.current]].label);
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sysInfo = Taro.getSystemInfoSync();
    const dpr = sysInfo.pixelRatio || 1;
    const w = sysInfo.windowWidth;
    const h = sysInfo.windowHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const centerX = w / 2;
    const centerY = h * 0.62;
    const isoCos = Math.cos(Math.PI / 6);
    const isoSin = Math.sin(Math.PI / 6);
    const halfGrid = GRID / 2;

    function project(gx: number, gz: number, height: number) {
      const dx = (gx - halfGrid) * CELL;
      const dz = (gz - halfGrid) * CELL;
      return { x: centerX + (dx - dz) * isoCos, y: centerY + (dx + dz) * isoSin - height };
    }

    function draw() {
      const time = timeRef.current;
      const theme = MINI_THEMES[MINI_THEME_KEYS[themeIdxRef.current]];
      const playing = isPlayingRef.current;
      const f = featuresRef.current;
      const beat = f.beat;
      const beatStr = f.beatStrength;

      // --- 节拍边沿检测 → 触发波纹 ---
      const beatRising = beat > 0.9 && !beatActiveRef.current;
      beatActiveRef.current = beat > 0.5;
      if (playing && beatRising) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 10 + Math.random() * 40;
        ripplesRef.current.push({
          x: Math.cos(angle) * radius,
          z: Math.sin(angle) * radius,
          time: time,
          strength: Math.min(beatStr * 8 + 2, 8),
        });
        if (ripplesRef.current.length > 8) ripplesRef.current.shift();
      }

      // 背景（透明，让背景图可见）
      ctx.clearRect(0, 0, w, h);

      // 渐变叠层（节拍时变亮，半透明）
      const bgBrightness = 1 + beat * 0.3;
      const grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, w * 0.7);
      grad.addColorStop(0, lerpColor(theme.baseColor1, theme.coolCore, 0.15 * bgBrightness));
      grad.addColorStop(1, theme.baseColor1);
      ctx.globalAlpha = 0.7; // 半透明，让背景图透出
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;

      // --- 节拍呼吸：整体微缩放 ---
      const breathScale = 1 + beat * 0.04;

      // --- 生成高度图（真实频段驱动）---
      const heights: number[] = new Array(GRID * GRID);
      for (let gz = 0; gz < GRID; gz++) {
        for (let gx = 0; gx < GRID; gx++) {
          const idx = gz * GRID + gx;
          const cx = (gx - halfGrid) * CELL;
          const cz = (gz - halfGrid) * CELL;
          const dist = Math.sqrt(cx * cx + cz * cz);
          const maxDist = halfGrid * CELL * 0.85;
          const falloff = Math.max(0, 1 - dist / maxDist);

          // 闲置波浪
          const n1 = smoothNoise(gx * 0.08 + time * 0.12, gz * 0.08);
          const n2 = smoothNoise(gx * 0.06, gz * 0.06 + time * 0.08);
          const wave = (n1 * 0.6 + n2 * 0.4) * 0.5 + 0.5;
          let bh = wave * 18 * falloff;

          if (playing) {
            // 真实频段映射：中心 subBass/bass，中间 lowMid/mid，边缘 highMid/presence
            const centerBoost = Math.max(0, 1 - dist / (maxDist * 0.35));
            const midBoost = Math.max(0, 1 - Math.abs(dist - maxDist * 0.4) / (maxDist * 0.3));
            const edgeBoost = Math.max(0, 1 - Math.abs(dist - maxDist * 0.7) / (maxDist * 0.3));

            // 节拍驱动的低频冲击（中心区域剧烈起伏）
            const bassHit = (f.subBass * 35 + f.bass * 25) * centerBoost * (1 + beat * 0.5);
            const midFlow = (f.lowMid * 15 + f.mid * 12) * midBoost;
            const edgeSparkle = (f.highMid * 10 + f.presence * 8) * edgeBoost;

            // 随机闪烁高柱（高频驱动）
            const rnd = noise2D(gx, gz + time * 3);
            const sparkle = rnd > 0.85 ? f.brilliance * 20 + f.air * 15 : 0;

            bh += bassHit + midFlow + edgeSparkle + sparkle;
          }

          heights[idx] = bh * falloff * breathScale;
        }
      }

      // --- 绘制波纹（在柱子下方的地面投影）---
      for (const r of ripplesRef.current) {
        const age = time - r.time;
        if (age > 2.5) continue;
        const radius = age * 50; // 扩散速度
        const alpha = Math.max(0, 1 - age / 2.5) * r.strength / 8;
        const pos = project(halfGrid + r.x / CELL, halfGrid + r.z / CELL, 0);
        ctx.strokeStyle = lerpColor(theme.baseColor1, theme.rippleColor, alpha);
        ctx.lineWidth = 2;
        ctx.globalAlpha = alpha * 0.6;
        ctx.beginPath();
        ctx.ellipse(pos.x, pos.y, radius * isoCos, radius * isoSin, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // --- 按深度排序绘制柱子 ---
      ctx.globalAlpha = 0.8; // 轻微透明，让背景图透出
      for (let gz = GRID - 1; gz >= 0; gz--) {
        for (let gx = GRID - 1; gx >= 0; gx--) {
          const idx = gz * GRID + gx;
          const height = heights[idx];
          if (height < 0.5) continue;

          const cx = (gx - halfGrid) * CELL;
          const cz = (gz - halfGrid) * CELL;
          const dist = Math.sqrt(cx * cx + cz * cz);
          const distFade = Math.max(0.15, 1 - dist / (halfGrid * CELL * 0.9));

          const basePos = project(gx, gz, 0);
          const topPos = project(gx, gz, height);
          const barW = CELL * isoCos * 0.9;
          const barD = CELL * isoSin * 0.9;

          const elevRatio = Math.min(1, height / 35);

          // 颜色：高度 + 节拍脉冲
          let color = lerpColor(theme.baseColor2, theme.coolCore, elevRatio * distFade);
          if (playing && elevRatio > 0.4) {
            const warmT = (elevRatio - 0.4) * 0.8;
            color = lerpColor(color, theme.warmCore, warmT);
          }
          // 节拍时高柱闪现 peakColor
          if (beat > 0.3 && elevRatio > 0.5) {
            color = lerpColor(color, theme.peakColor, beat * 0.4 * elevRatio);
          }

          // 左侧面
          ctx.fillStyle = lerpColor(theme.baseColor1, color, 0.5 * distFade);
          ctx.beginPath();
          ctx.moveTo(basePos.x - barW, basePos.y);
          ctx.lineTo(basePos.x, basePos.y + barD * 2);
          ctx.lineTo(basePos.x, topPos.y + barD * 2);
          ctx.lineTo(topPos.x - barW, topPos.y);
          ctx.closePath();
          ctx.fill();

          // 右侧面
          ctx.fillStyle = lerpColor(theme.baseColor1, color, 0.7 * distFade);
          ctx.beginPath();
          ctx.moveTo(basePos.x, basePos.y + barD * 2);
          ctx.lineTo(basePos.x + barW, basePos.y);
          ctx.lineTo(topPos.x + barW, topPos.y);
          ctx.lineTo(topPos.x, topPos.y + barD * 2);
          ctx.closePath();
          ctx.fill();

          // 顶面（节拍时增亮）
          let topColor = color;
          if (beat > 0.2) {
            topColor = lerpColor(color, '#ffffff', beat * 0.25 * elevRatio);
          }
          ctx.fillStyle = topColor;
          ctx.beginPath();
          ctx.moveTo(topPos.x, topPos.y);
          ctx.lineTo(topPos.x + barW, topPos.y + barD);
          ctx.lineTo(topPos.x, topPos.y + barD * 2);
          ctx.lineTo(topPos.x - barW, topPos.y + barD);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1; // 恢复透明度

      timeRef.current += 0.016;
      animRef.current = canvas.requestAnimationFrame ? canvas.requestAnimationFrame(draw) : (setTimeout(draw, 16) as any);
    }

    draw();
    return () => {
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        clearTimeout(animRef.current as any);
      }
    };
  }, []);

  return (
    <>
      <Canvas
        ref={canvasRef}
        type="2d"
        id="sonic-bg"
        style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 0, pointerEvents: 'none' }}
      />
      <text style={{ position: 'fixed', bottom: '60px', right: '8px', fontSize: '9px', color: 'rgba(255,255,255,0.25)', zIndex: 1, pointerEvents: 'none' }}>
        {themeLabel}
      </text>
    </>
  );
};
