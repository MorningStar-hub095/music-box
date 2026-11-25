// web/src/hooks/useAudioAnalyser.ts
// FFT 音频分析 Hook — 从音频元素提取频段数据和音色特征
// 分析逻辑由外部在 useFrame 中调用 updateFeatures() 驱动，避免双循环不同步
import { useRef, useState, useEffect, useCallback } from 'react';

export interface AudioFeatures {
  subBass: number;
  bass: number;
  lowMid: number;
  mid: number;
  highMid: number;
  presence: number;
  brilliance: number;
  air: number;
  warmth: number;
  brightness: number;
  sharpness: number;
  smoothness: number;
  density: number;
  spectralCentroid: number;
  energy: number;
  beat: number;
  beatStrength: number;
}

const INITIAL_FEATURES: AudioFeatures = {
  subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0,
  presence: 0, brilliance: 0, air: 0,
  warmth: 0, brightness: 0, sharpness: 0, smoothness: 0,
  density: 0, spectralCentroid: 0, energy: 0,
  beat: 0, beatStrength: 0,
};

const BAND_RANGES: Record<string, [number, number]> = {
  subBass: [0, 4],
  bass: [5, 12],
  lowMid: [13, 24],
  mid: [25, 45],
  highMid: [46, 81],
  presence: [82, 120],
  brilliance: [121, 180],
  air: [181, 255],
};

export const BASS_TRIGGER_RANGE: [number, number] = [0, 12];
export const METEOR_TRIGGER_RANGE: [number, number] = [92, 340];

function avgRange(data: Uint8Array, start: number, end: number): number {
  let sum = 0;
  const count = end - start + 1;
  for (let i = start; i <= end && i < data.length; i++) {
    sum += data[i];
  }
  return sum / count / 255;
}

export function useAudioAnalyser(getAudioElement: () => HTMLAudioElement | null) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const freqDataRef = useRef<Uint8Array>(new Uint8Array(128));
  const prevFeaturesRef = useRef<AudioFeatures>({ ...INITIAL_FEATURES });
  const smoothedRef = useRef<AudioFeatures>({ ...INITIAL_FEATURES });
  const fluxHistoryRef = useRef<number[]>([]);
  const bassHistoryRef = useRef<number[]>([]);
  const beatPulseRef = useRef(0);
  const beatCooldownRef = useRef(0);
  const featuresRef = useRef<AudioFeatures>({ ...INITIAL_FEATURES });
  const zeroFrameCountRef = useRef(0);
  const simTimeRef = useRef(0);
  const lastValidDataRef = useRef<Uint8Array | null>(null);
  const [isAnalysing, setIsAnalysing] = useState(false);

  const getFrequencyData = useCallback((): Uint8Array => freqDataRef.current, []);

  // 初始化音频分析 - 增强版本，处理频繁切歌场景
  const initAnalyser = useCallback(() => {
    const audio = getAudioElement();
    if (!audio) return false;

    // 检查现有连接是否有效
    if (audioCtxRef.current && sourceRef.current && analyserRef.current) {
      const ctx = audioCtxRef.current;
      // 确保 AudioContext 处于运行状态
      if (ctx.state === 'suspended') {
        ctx.resume().then(() => {
          console.log('[AudioAnalyser] AudioContext 已恢复');
        });
      }
      // 验证分析器是否仍在工作
      if (ctx.state === 'running') {
        return true;
      }
    }

    // 清理旧连接（如果有）
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch (e) {}
    }
    if (analyserRef.current) {
      try { analyserRef.current.disconnect(); } catch (e) {}
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      try { audioCtxRef.current.close(); } catch (e) {}
    }

    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;

      const source = ctx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(ctx.destination);

      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      sourceRef.current = source;
      freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
      setIsAnalysing(true);
      console.log('[AudioAnalyser] 初始化成功');
      return true;
    } catch (err) {
      console.error('[AudioAnalyser] 初始化失败:', err);
      return false;
    }
  }, [getAudioElement]);

  // ★ 核心分析函数：由外部 useFrame 调用，不再用独立 rAF 循环
  const updateFeatures = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return featuresRef.current;

    // 确保 AudioContext 运行
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }

    analyser.getByteFrequencyData(freqDataRef.current as Uint8Array<ArrayBuffer>);
    const data = freqDataRef.current;

    // 检测全零
    let hasData = false;
    for (let i = 0; i < data.length; i++) {
      if (data[i] > 0) { hasData = true; break; }
    }

    if (hasData) {
      lastValidDataRef.current = new Uint8Array(data);
      zeroFrameCountRef.current = 0;
    } else {
      zeroFrameCountRef.current++;
      if (lastValidDataRef.current && zeroFrameCountRef.current < 60) {
        const decay = 1 - zeroFrameCountRef.current / 60;
        for (let i = 0; i < data.length; i++) {
          data[i] = Math.floor(lastValidDataRef.current[i] * decay);
        }
      } else if (zeroFrameCountRef.current >= 60) {
        simTimeRef.current += 0.016;
        const beatPhase = (simTimeRef.current * 2) % 1;
        const beatRaw = Math.exp(-beatPhase * 6);
        for (let i = 0; i < data.length; i++) {
          const freq = i / data.length;
          const val = beatRaw * (1 - freq) * 180 + Math.sin(simTimeRef.current * 3 + i * 0.3) * 30 + Math.random() * 20;
          data[i] = Math.max(0, Math.min(255, val));
        }
      }
    }

    // 计算频段
    const subBass = avgRange(data, ...BAND_RANGES.subBass);
    const bass = avgRange(data, ...BAND_RANGES.bass);
    const lowMid = avgRange(data, ...BAND_RANGES.lowMid);
    const mid = avgRange(data, ...BAND_RANGES.mid);
    const highMid = avgRange(data, ...BAND_RANGES.highMid);
    const presence = avgRange(data, ...BAND_RANGES.presence);
    const brilliance = avgRange(data, ...BAND_RANGES.brilliance);
    const air = avgRange(data, ...BAND_RANGES.air);

    const totalEnergy = subBass + bass + lowMid + mid + highMid + presence + brilliance + air;
    const energy = totalEnergy / 8;

    const lowEnergy = subBass + bass + lowMid + mid;
    const highEnergy = presence + brilliance + air;
    const warmth = totalEnergy > 0.001 ? lowEnergy / totalEnergy : 0;
    const brightness = totalEnergy > 0.001 ? highEnergy / totalEnergy : 0;

    const prevBright = prevFeaturesRef.current.brightness;
    const sharpness = Math.max(0, brightness - prevBright) * 10;

    const prevEnergy = prevFeaturesRef.current.energy;
    const flux = Math.max(0, energy - prevEnergy);
    const fluxHistory = fluxHistoryRef.current;
    fluxHistory.push(flux);
    if (fluxHistory.length > 40) fluxHistory.shift();

    const avgFlux = fluxHistory.reduce((a, b) => a + b, 0) / fluxHistory.length;
    const smoothness = Math.max(0, 1 - avgFlux * 2);

    const bands = [subBass, bass, lowMid, mid, highMid, presence, brilliance, air];
    const density = bands.filter(b => b > energy * 1.5).length / 8;

    let centroidSum = 0, ampSum = 0;
    for (let i = 0; i < data.length; i++) {
      centroidSum += i * data[i];
      ampSum += data[i];
    }
    const spectralCentroid = ampSum > 0 ? centroidSum / ampSum / data.length : 0;

    // 节拍检测
    const bassEnergy = subBass * 0.6 + bass * 0.4;
    const bassHistory = bassHistoryRef.current;
    bassHistory.push(bassEnergy);
    if (bassHistory.length > 35) bassHistory.shift();

    let beatStrength = 0;
    if (beatCooldownRef.current <= 0 && bassHistory.length >= 10) {
      const mean = bassHistory.reduce((a, b) => a + b, 0) / bassHistory.length;
      const variance = bassHistory.reduce((a, b) => a + (b - mean) ** 2, 0) / bassHistory.length;
      const std = Math.sqrt(variance);
      const threshold = Math.max(0.06, mean + std * 1.0);
      const prevBass = bassHistory[bassHistory.length - 2] || 0;
      if (bassEnergy > threshold && bassEnergy > prevBass * 1.08) {
        beatStrength = Math.min(1, (bassEnergy - threshold) / Math.max(0.1, threshold) + 0.4);
        beatPulseRef.current = 1;
        beatCooldownRef.current = 7;
      }
    }
    if (beatCooldownRef.current > 0) beatCooldownRef.current--;
    beatPulseRef.current = Math.max(0, beatPulseRef.current - 0.06);
    const beat = beatPulseRef.current;

    const target: AudioFeatures = {
      subBass, bass, lowMid, mid, highMid, presence, brilliance, air,
      warmth, brightness, sharpness, smoothness, density, spectralCentroid, energy,
      beat, beatStrength,
    };

    const rate = energy > 0.02 ? 0.4 : 0.12;
    const alpha = 1 - Math.pow(1 - rate, 1.0);
    const smoothed = smoothedRef.current;
    const result: AudioFeatures = { ...INITIAL_FEATURES };
    (Object.keys(target) as Array<keyof AudioFeatures>).forEach(key => {
      if (key === 'beat' || key === 'beatStrength') {
        result[key] = target[key];
      } else {
        result[key] = smoothed[key] + (target[key] - smoothed[key]) * alpha;
      }
    });
    smoothedRef.current = result;
    prevFeaturesRef.current = target;
    featuresRef.current = result;

    return result;
  }, []);

  // 获取最新特征
  const getFeatures = useCallback((): AudioFeatures => featuresRef.current, []);

  // 清理
  useEffect(() => {
    return () => {
      if (sourceRef.current) sourceRef.current.disconnect();
      if (analyserRef.current) analyserRef.current.disconnect();
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
    };
  }, []);

  // 获取 AnalyserNode 供外部直接读取
  const getAnalyserNode = useCallback((): AnalyserNode | null => analyserRef.current, []);

  return { initAnalyser, getFrequencyData, getFeatures, updateFeatures, isAnalysing, getAnalyserNode };
}
