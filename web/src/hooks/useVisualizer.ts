// web/src/hooks/useVisualizer.ts - 音频频谱可视化（粒子点阵，直接读取 AnalyserNode）
import { useRef, useState, useCallback, useEffect } from 'react';

// ===== 粒子点阵相关类型 =====
interface Particle {
  x: number;
  y: number;
  ox: number;           // 原始x位置（漂移基准）
  oy: number;           // 原始y位置（漂移基准）
  col: number;
  row: number;
  baseSize: number;
  scale: number;
  velocity: number;
  stripSide: 'left' | 'right';
  phase: number;        // 随机相位偏移
  twinkleSpeed: number; // 闪烁速度（每个粒子不同）
  twinklePhase: number; // 闪烁相位
  driftAmp: number;     // 漂移幅度
  driftSpeed: number;   // 漂移速度
  alpha: number;        // 当前透明度（独立于scale）
  alphaVel: number;     // 透明度变化速度
}

interface NeighborPair {
  a: number;
  b: number;
}

export function useVisualizer(
  getAnalyserNode: () => AnalyserNode | null,
  color: string
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isActive, setIsActive] = useState(false);
  const rafRef = useRef<number | null>(null);
  const smoothRef = useRef<number[]>([]);
  const colorRef = useRef(color);
  colorRef.current = color;
  const idleTickRef = useRef(0);
  // 切歌防闪烁：记录无音频帧数，添加宽限期
  const noAudioFrameCountRef = useRef(0);
  const lastValidSmoothRef = useRef<number[]>([]);
  const GRACE_PERIOD_FRAMES = 60; // 增加到约1秒宽限期（60fps），给切歌更多缓冲时间

  // 粒子点阵专用 refs
  const particlesRef = useRef<Particle[]>([]);
  const neighborsRef = useRef<NeighborPair[]>([]);
  const gridKeyRef = useRef('');
  const gridInfoRef = useRef({ rowCount: 0, colCount: 0 });
  // 频率历史缓冲（用于多向波浪传播）
  const historyRef = useRef<number[][]>([]);
  const HISTORY_SIZE = 25;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) { rafRef.current = requestAnimationFrame(draw); return; }
    const ctx = canvas.getContext('2d');
    if (!ctx) { rafRef.current = requestAnimationFrame(draw); return; }

    // 确保 canvas 尺寸正确 - 使用更健壮的检查
    const parent = canvas.parentElement;
    const targetWidth = parent ? parent.clientWidth : window.innerWidth;
    const targetHeight = parent ? parent.clientHeight : (window.innerHeight - 170);
    
    // 只在尺寸变化时更新，避免频繁重设
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      // 尺寸变化时重置粒子网格
      if (targetWidth > 0 && targetHeight > 0) {
        generateHexGrid(targetWidth, targetHeight);
      }
    }

    const analyser = getAnalyserNode();
    const barCount = 64;

    // 平滑缓冲
    if (smoothRef.current.length !== barCount) {
      smoothRef.current = new Array(barCount).fill(0);
    }
    const smooth = smoothRef.current;

    // 读取频率数据；analyser 存在但数据全零（暂停/结束/切歌/挂起）时回退待机动画
    let hasAudio = false;
    if (analyser) {
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyser.getByteFrequencyData(dataArray);

      const sampleCount = Math.min(dataArray.length, 128);
      
      // 使用均方根(RMS)检测音频信号，比简单求和更稳定
      let rms = 0;
      for (let i = 0; i < sampleCount; i++) {
        const normalized = dataArray[i] / 255;
        rms += normalized * normalized;
      }
      rms = Math.sqrt(rms / sampleCount);
      
      // 使用更稳定的阈值判断是否有音频
      const AUDIO_THRESHOLD = 0.015; // 降低阈值，更敏感地检测音频
      hasAudio = rms > AUDIO_THRESHOLD;

      if (hasAudio) {
        // 重置无音频帧计数器和待机状态
        noAudioFrameCountRef.current = 0;
        
        // 平滑系数：上升快，下降慢，减少抖动
        const SMOOTH_UP = 0.45;   // 上升响应速度
        const SMOOTH_DOWN = 0.88; // 下降响应速度（更平滑）
        
        for (let i = 0; i < barCount; i++) {
          const ratio = i / barCount;
          const idx = Math.floor(Math.pow(ratio, 1.4) * sampleCount);
          const raw = dataArray[idx] || 0;
          const target = raw / 255;
          
          // 非对称平滑：快速响应峰值，缓慢回落
          if (target > smooth[i]) {
            smooth[i] = smooth[i] * (1 - SMOOTH_UP) + target * SMOOTH_UP;
          } else {
            smooth[i] = smooth[i] * SMOOTH_DOWN + target * (1 - SMOOTH_DOWN);
          }
        }
        
        // 保存有效的平滑数据
        lastValidSmoothRef.current = [...smooth];
      } else {
        // 无音频帧，递增计数器
        noAudioFrameCountRef.current++;
      }
    } else {
      // 没有 analyser，递增计数器（但限制最大值，防止溢出）
      noAudioFrameCountRef.current = Math.min(noAudioFrameCountRef.current + 1, GRACE_PERIOD_FRAMES * 2);
    }

    // 切歌防闪烁：在宽限期内保持最后有效的可视化状态
    const inGracePeriod = noAudioFrameCountRef.current < GRACE_PERIOD_FRAMES;
    
    if (!hasAudio && inGracePeriod && lastValidSmoothRef.current.length > 0) {
      // 在宽限期内，使用最后有效的数据，但逐渐衰减
      const decay = 1 - (noAudioFrameCountRef.current / GRACE_PERIOD_FRAMES);
      for (let i = 0; i < barCount; i++) {
        const lastValid = lastValidSmoothRef.current[i] || 0;
        smooth[i] = lastValid * decay;
      }
      // 继续使用正常绘制逻辑，不切换到待机动画
    } else if (!hasAudio) {
      // 待机动画：微光星空 + 呼吸 + 色彩流动
      const tick = idleTickRef.current;
      for (let i = 0; i < barCount; i++) {
        // 双层波叠加：整体呼吸 + 局部起伏
        const wave1 = Math.sin(tick * 0.8 + i * 0.3) * 0.5 + 0.5;
        const wave2 = Math.sin(tick * 0.5 + i * 0.15) * 0.5 + 0.5;
        // 微光星空：低调但明显可见（0.08-0.26）
        const target = 0.08 + wave1 * 0.12 + wave2 * 0.06;
        smooth[i] = smooth[i] * 0.9 + target * 0.1;
      }
    }

    // 始终推进 tick（用于呼吸效果）
    idleTickRef.current += 0.016;

    // 推入频率历史缓冲（用于粒子点阵的波浪传播）
    historyRef.current.push([...smooth]);
    if (historyRef.current.length > HISTORY_SIZE) {
      historyRef.current.shift();
    }

    const w = canvas.width;
    const h = canvas.height;

    // 解析颜色
    const hex = colorRef.current.replace('#', '');
    const cr = parseInt(hex.substring(0, 2), 16) || 251;
    const cg = parseInt(hex.substring(2, 4), 16) || 191;
    const cb = parseInt(hex.substring(4, 6), 16) || 36;

    drawParticles(ctx, smooth, w, h, cr, cg, cb);

    rafRef.current = requestAnimationFrame(draw);
  }, [getAnalyserNode]);

  // ===== 粒子点阵（左右竖条 + 六边形蜂巢 + 脉动呼吸 + 蓝紫色 + 光晕 + 星座连线 + 拖尾） =====

  // 生成左右两侧竖条蜂巢网格（固定粒子参数，保证预览/网页一致）
  function generateHexGrid(w: number, h: number) {
    // 固定粒子尺寸与竖条宽度，不随窗口宽度变化，避免比例失调
    const size = 5;                                    // 固定粒子半径
    const stripWidth = 200;                            // 固定每侧竖条宽度
    const stripCols = Math.max(6, Math.min(18, Math.floor(stripWidth / (size * 1.6))));
    const rowSpacing = size * 1.5;
    const hexWidth = Math.sqrt(3) * size;
    const colSpacing = hexWidth;
    const rowCount = Math.max(6, Math.floor((h - size) / rowSpacing));

    const particles: Particle[] = [];

    for (let side = 0; side < 2; side++) {
      const sideX = side === 0
        ? stripWidth * 0.5           // 左侧：居中于左竖条
        : w - stripWidth * 0.5;      // 右侧：居中于右竖条
      const stripSide: 'left' | 'right' = side === 0 ? 'left' : 'right';

      for (let row = 0; row < rowCount; row++) {
        for (let col = 0; col < stripCols; col++) {
          // 奇数行偏移半个 colSpacing
          const offsetX = (row % 2) * (colSpacing / 2);
          const x = sideX - (stripCols - 1) * colSpacing / 2 + col * colSpacing + offsetX;
          const y = size + row * rowSpacing;
          particles.push({
            x, y, ox: x, oy: y, col, row,
            baseSize: size * 0.72,
            scale: 0.3,
            velocity: 0,
            stripSide,
            phase: Math.random() * Math.PI * 2,
            twinkleSpeed: 0.3 + Math.random() * 0.7,   // 每个粒子闪烁速度不同
            twinklePhase: Math.random() * Math.PI * 2,
            driftAmp: 4 + Math.random() * 6,            // 漂移幅度4-10px
            driftSpeed: 0.25 + Math.random() * 0.5,    // 漂移速度
            alpha: 0.3,
            alphaVel: 0,
          });
        }
      }
    }

    // 预计算相邻粒子对（用于星座连线）
    const neighbors: NeighborPair[] = [];
    const maxDistSq = (colSpacing * 1.3) ** 2;
    for (let i = 0; i < particles.length; i++) {
      // 只在同侧粒子之间连线
      for (let j = i + 1; j < particles.length; j++) {
        if (particles[i].stripSide !== particles[j].stripSide) continue;
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        if (dx * dx + dy * dy < maxDistSq) {
          neighbors.push({ a: i, b: j });
        }
      }
    }

    particlesRef.current = particles;
    neighborsRef.current = neighbors;
    gridInfoRef.current = { rowCount, colCount: stripCols };
  }

  // 绘制单个六边形（pointy-top）
  function drawHexagon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2; // 顶点朝上
      const px = x + size * Math.cos(angle);
      const py = y + size * Math.sin(angle);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function drawParticles(
    ctx: CanvasRenderingContext2D, smooth: number[],
    w: number, h: number, cr: number, cg: number, cb: number
  ) {
    const barCount = smooth.length;

    // 尺寸变化时重新生成蜂巢网格
    const gridKey = `${w}x${h}`;
    if (gridKeyRef.current !== gridKey) {
      gridKeyRef.current = gridKey;
      generateHexGrid(w, h);
    }

    const particles = particlesRef.current;
    if (particles.length === 0) return;

    const { rowCount } = gridInfoRef.current;
    const breath = idleTickRef.current;
    const history = historyRef.current;

    // 蓝紫色调色板（与封面色混搭）
    // [封面色] -> 蓝 -> 靛 -> 紫 -> 淡紫 -> 极淡紫
    const palette = [
      [cr, cg, cb],
      [59, 130, 246],   // #3B82F6 blue
      [99, 102, 241],   // #6366F1 indigo
      [139, 92, 246],   // #8B5CF6 purple
      [167, 139, 250],  // #A78BFA light purple
      [196, 181, 253],  // #C4B5FD very light
    ];
    const paletteLen = palette.length;

    // 拖尾残影：用 destination-out 淡化上一帧（保持画布透明）
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    // 更新物理 + 绘制粒子
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];

      // ===== 纵向频率映射：底行=低频，顶行=高频 =====
      const rowRatio = rowCount > 1 ? p.row / (rowCount - 1) : 0;
      const freqIdx = Math.min(barCount - 1, Math.floor(rowRatio * barCount));

      // ===== 波浪传播：从两侧向中间扩散 =====
      // 左侧粒子向右传播，右侧粒子向左传播
      const distFromEdge = p.stripSide === 'left'
        ? (w / 2 - p.x) / (w / 2)    // 左侧：越靠近中心越延迟
        : (p.x - w / 2) / (w / 2);   // 右侧：越靠近中心越延迟
      const delaySteps = Math.max(0, distFromEdge) * 8;

      // 从历史缓冲读取延迟的频率值（带插值）
      let freqVal: number;
      if (history.length > 1) {
        const delayFloor = Math.floor(delaySteps);
        const delayFrac = delaySteps - delayFloor;
        const idx1 = Math.max(0, history.length - 1 - delayFloor);
        const idx2 = Math.max(0, history.length - 1 - delayFloor - 1);
        const val1 = history[idx1]?.[freqIdx] ?? 0;
        const val2 = history[idx2]?.[freqIdx] ?? 0;
        freqVal = val1 * (1 - delayFrac) + val2 * delayFrac;
      } else {
        freqVal = smooth[freqIdx] || 0;
      }

      // ===== 星空闪烁律动（稳定性优化） =====
      // 1. 频率驱动大小：使用更平滑的弹性物理
      const targetScale = 0.08 + freqVal * 1.15;
      // 更强的阻尼，减少振荡
      p.velocity += (targetScale - p.scale) * 0.12;
      p.velocity *= 0.78; // 增加阻尼
      p.scale += p.velocity;
      // 限制scale范围，防止异常值
      p.scale = Math.max(0.05, Math.min(1.8, p.scale));

      // 2. 闪烁：更平滑的正弦周期，减少偶发强闪的突兀感
      const twinkle = Math.sin(breath * p.twinkleSpeed + p.twinklePhase) * 0.5 + 0.5;
      // 降低强闪阈值和强度，减少闪烁感
      const spark = freqVal > 0.55 && Math.sin(breath * 3 + p.phase * 5) > 0.92 ? 0.35 : 0;

      // 3. 透明度独立变化：更平滑的过渡
      const targetAlpha = 0.02 + freqVal * 0.75 + twinkle * 0.2 + spark * 1.0;
      // 更强的阻尼，减少透明度抖动
      p.alphaVel += (targetAlpha - p.alpha) * 0.1;
      p.alphaVel *= 0.82;
      p.alpha += p.alphaVel;
      // 限制alpha范围
      p.alpha = Math.max(0.01, Math.min(1.2, p.alpha));

      // 4. 漂移：幅度5-10px（初始化已设置）
      p.x = p.ox + Math.sin(breath * p.driftSpeed + p.phase) * p.driftAmp;
      p.y = p.oy + Math.cos(breath * p.driftSpeed * 0.7 + p.phase) * p.driftAmp * 0.6;

      // ===== 蓝紫混搭渐变色 + 色彩流动 =====
      const intensity = Math.min(1.2, Math.max(0, p.scale));
      const baseColorT = rowRatio * (0.35 + Math.min(1, intensity) * 0.65);
      // 缓慢色彩流动：待机和播放时都有，低频时更明显
      const flowOffset = Math.sin(breath * 0.15 + p.row * 0.3 + p.phase * 0.5) * 0.08;
      const colorT = Math.max(0, Math.min(0.95, baseColorT + flowOffset));

      // 从调色板插值取色
      const scaled = colorT * (paletteLen - 1);
      const pIdx = Math.floor(scaled);
      const pFrac = scaled - pIdx;
      const pIdx2 = Math.min(paletteLen - 1, pIdx + 1);
      const ca = palette[pIdx];
      const ccb = palette[pIdx2];
      const r2 = Math.round(ca[0] + (ccb[0] - ca[0]) * pFrac);
      const g2 = Math.round(ca[1] + (ccb[1] - ca[1]) * pFrac);
      const b2 = Math.round(ca[2] + (ccb[2] - ca[2]) * pFrac);
      const alpha = Math.min(1, p.alpha);

      const drawSize = p.baseSize * Math.max(0.12, Math.min(1.6, p.scale));

      // 光晕辉光（闪烁时更亮，适度加强）
      if (intensity > 0.12 || spark > 0) {
        ctx.shadowColor = `rgba(${r2}, ${g2}, ${b2}, 1)`;
        ctx.shadowBlur = 4 + intensity * 28 + spark * 20;
      } else {
        ctx.shadowBlur = 0;
      }

      drawHexagon(ctx, p.x, p.y, drawSize);
      ctx.fillStyle = `rgba(${r2}, ${g2}, ${b2}, ${alpha})`;
      ctx.fill();
    }

    ctx.shadowBlur = 0;

    // 星座连线：相邻亮粒子之间画淡蓝紫线
    const neighbors = neighborsRef.current;
    for (let k = 0; k < neighbors.length; k++) {
      const pair = neighbors[k];
      const pa = particles[pair.a];
      const pb = particles[pair.b];
      const avgScale = (pa.scale + pb.scale) / 2;
      if (avgScale > 0.38) {
        const lineAlpha = Math.min(0.6, (avgScale - 0.38) * 1.0);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.strokeStyle = `rgba(180, 190, 255, ${lineAlpha})`;
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
    }
  }

  // isActive 变化时启动/停止绘制循环
  useEffect(() => {
    if (isActive) {
      // 启动动画循环
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(draw);
      }
    } else {
      // 停止动画循环并清理画布
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      // 清理画布内容，防止残留显示导致闪烁
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
      // 重置状态
      smoothRef.current = [];
      lastValidSmoothRef.current = [];
      noAudioFrameCountRef.current = 0;
      idleTickRef.current = 0;
      historyRef.current = [];
    }
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isActive, draw]);

  const toggle = useCallback(() => {
    setIsActive(prev => !prev);
  }, []);

  // 窗口大小变化时更新 canvas 尺寸
  useEffect(() => {
    const updateSize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const parent = canvas.parentElement;
      const newWidth = parent ? parent.clientWidth : window.innerWidth;
      const newHeight = parent ? parent.clientHeight : (window.innerHeight - 170);
      
      // 只在尺寸变化时更新
      if (canvas.width !== newWidth || canvas.height !== newHeight) {
        canvas.width = newWidth;
        canvas.height = newHeight;
        // 重新生成粒子网格
        if (newWidth > 0 && newHeight > 0) {
          generateHexGrid(newWidth, newHeight);
        }
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [isActive]);

  return { canvasRef, isActive, toggle };
}
