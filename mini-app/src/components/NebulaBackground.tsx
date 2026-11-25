// mini-app/src/components/NebulaBackground.tsx
// 小程序粒子星云背景 — Canvas 2D 实现，柔和版
import React, { useRef, useEffect, useCallback } from 'react';
import { CanvasContext } from '@tarojs/taro';
import { useMiniAudioAnalyser } from '../hooks/useMiniAudioAnalyser';

const PARTICLE_COUNT = 300; // 小程序端降低粒子数
const CANVAS_SIZE = 750; // 设计稿宽度

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  baseX: number; baseY: number; baseZ: number;
  size: number;
  color: string;
}

export const NebulaBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasContext | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animRef = useRef<number>(0);
  const beatPulseRef = useRef(0);
  const beatActiveRef = useRef(false);
  const lastBeatRef = useRef(0);

  // 获取音频特征
  const { features } = useMiniAudioAnalyser();

  // 初始化粒子
  useEffect(() => {
    const particles: Particle[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 80 + Math.random() * 180;
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta) * 0.6;
      const z = r * Math.cos(phi);
      particles.push({
        x, y, z, vx: 0, vy: 0, vz: 0,
        baseX: x, baseY: y, baseZ: z,
        size: 1 + Math.random() * 2,
        color: `hsl(${210 + Math.random() * 30}, 70%, ${30 + Math.random() * 20}%)`,
      });
    }
    particlesRef.current = particles;
  }, []);

  // 初始化 Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctxRef.current = ctx;
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
  }, []);

  // 绘制循环
  useEffect(() => {
    let time = 0;
    const draw = () => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      time += 0.016;

      // 获取音频数据
      const f = features;
      const energy = f.energy * 0.6; // 降低敏感度

      // 节拍检测
      const beatRising = f.beat > 0.85 && !beatActiveRef.current;
      beatActiveRef.current = f.beat > 0.4;
      if (beatRising) beatPulseRef.current = 0.8;
      beatPulseRef.current = Math.max(0, beatPulseRef.current - 0.03);
      const beat = beatPulseRef.current;

      // 清空背景
      ctx.fillStyle = '#010206';
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // 绘制粒子
      const particles = particlesRef.current;
      const centerX = CANVAS_SIZE / 2;
      const centerY = CANVAS_SIZE / 2;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // 呼吸缩放
        const breathScale = 1 + energy * 0.15 + beat * 0.08;
        const targetX = p.baseX * breathScale;
        const targetY = p.baseY * breathScale;
        const targetZ = p.baseZ * breathScale;

        // 节拍爆发力
        if (beatRising) {
          const dist = Math.sqrt(p.baseX ** 2 + p.baseY ** 2 + p.baseZ ** 2) || 1;
          const force = f.beatStrength * 0.12;
          p.vx += (p.baseX / dist) * force;
          p.vy += (p.baseY / dist) * force;
          p.vz += (p.baseZ / dist) * force;
        }

        // 流动噪声
        const flowX = Math.sin(time * 0.3 + p.baseZ * 0.08) * 0.02 * energy;
        const flowY = Math.cos(time * 0.2 + p.baseX * 0.08) * 0.02 * energy;
        const flowZ = Math.sin(time * 0.25 + p.baseY * 0.08) * 0.02 * energy;

        // 弹簧力
        p.vx += (targetX - p.x) * 0.02 + flowX;
        p.vy += (targetY - p.y) * 0.02 + flowY;
        p.vz += (targetZ - p.z) * 0.02 + flowZ;

        // 阻尼
        p.vx *= 0.95;
        p.vy *= 0.95;
        p.vz *= 0.95;

        p.x += p.vx;
        p.y += p.vy;
        p.z += p.vz;

        // 3D 投影到 2D
        const scale = 400 / (400 + p.z);
        const projX = centerX + p.x * scale;
        const projY = centerY + p.y * scale;
        const projSize = p.size * scale;

        // 颜色计算
        const distFromCenter = Math.sqrt(p.x ** 2 + p.y ** 2 + p.z ** 2);
        const normalizedDist = Math.min(1, distFromCenter / 200);

        // 基础颜色：中心冷蓝，边缘暖蓝
        const hue = 210 + normalizedDist * 20 + beat * 15;
        const lightness = 30 + energy * 20 + beat * 15;
        const alpha = 0.5 + energy * 0.2 + beat * 0.2;

        ctx.beginPath();
        ctx.arc(projX, projY, projSize, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, 70%, ${lightness}%, ${alpha})`;
        ctx.fill();

        // 节拍时添加光晕
        if (beat > 0.3) {
          ctx.beginPath();
          ctx.arc(projX, projY, projSize * 2, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${hue + 20}, 80%, ${lightness + 20}%, ${beat * 0.3})`;
          ctx.fill();
        }
      }

      // 绘制中心光球
      const centerSize = 15 + beat * 10 + energy * 8;
      const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, centerSize);
      gradient.addColorStop(0, `hsla(220, 80%, 60%, ${0.6 + beat * 0.3})`);
      gradient.addColorStop(0.5, `hsla(210, 70%, 40%, ${0.3 + beat * 0.2})`);
      gradient.addColorStop(1, 'hsla(210, 60%, 20%, 0)');
      ctx.beginPath();
      ctx.arc(centerX, centerY, centerSize, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [features]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: -1,
      }}
    />
  );
};
