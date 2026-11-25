// mini-app/src/hooks/useMiniAudioAnalyser.ts
// 小程序音频分析 Hook
// H5 环境：通过 Web Audio API 接入真实 FFT
// 其他环境：基于播放进度的伪节拍模拟
import { useRef, useState, useEffect, useCallback } from 'react';
import Taro from '@tarojs/taro';

export interface MiniAudioFeatures {
  subBass: number;
  bass: number;
  lowMid: number;
  mid: number;
  highMid: number;
  presence: number;
  brilliance: number;
  air: number;
  energy: number;
  beat: number;
  beatStrength: number;
}

const INITIAL: MiniAudioFeatures = {
  subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0,
  presence: 0, brilliance: 0, air: 0,
  energy: 0, beat: 0, beatStrength: 0,
};

const BANDS: Record<string, [number, number]> = {
  subBass: [0, 4],
  bass: [5, 12],
  lowMid: [13, 24],
  mid: [25, 45],
  highMid: [46, 81],
  presence: [82, 120],
  brilliance: [121, 180],
  air: [181, 255],
};

function avgRange(data: Uint8Array, s: number, e: number): number {
  let sum = 0;
  const n = e - s + 1;
  for (let i = s; i <= e && i < data.length; i++) sum += data[i];
  return sum / n / 255;
}

export function useMiniAudioAnalyser() {
  const audioCtxRef = useRef<any>(null);
  const analyserRef = useRef<any>(null);
  const sourceRef = useRef<any>(null);
  const freqDataRef = useRef<Uint8Array>(new Uint8Array(128));
  const rafRef = useRef<number>(0);
  const bassHistRef = useRef<number[]>([]);
  const beatPulseRef = useRef(0);
  const beatCooldownRef = useRef(0);
  const smoothedRef = useRef<MiniAudioFeatures>({ ...INITIAL });
  const pseudoTimeRef = useRef(0);
  const isPlayingRef = useRef(false);

  const [features, setFeatures] = useState<MiniAudioFeatures>({ ...INITIAL });
  const [isAnalysing, setIsAnalysing] = useState(false);

  // H5 环境下接入 Web Audio API
  const initAnalyser = useCallback(() => {
    if (process.env.TARO_ENV !== 'h5') {
      setIsAnalysing(true);
      return true;
    }
    // H5：尝试从 DOM 获取 audio 元素
    if (audioCtxRef.current && sourceRef.current) {
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
      return true;
    }
    try {
      const audios = document.getElementsByTagName('audio');
      const audioEl = audios[0];
      if (!audioEl) {
        setIsAnalysing(true); // 回退到伪节拍
        return true;
      }
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.65;
      const source = ctx.createMediaElementSource(audioEl);
      source.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      sourceRef.current = source;
      freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
      setIsAnalysing(true);
      return true;
    } catch (err) {
      console.warn('[MiniAudioAnalyser] H5 FFT 初始化失败，回退伪节拍:', err);
      setIsAnalysing(true);
      return true;
    }
  }, []);

  // 设置播放状态（供外部同步）
  const setPlaying = useCallback((playing: boolean) => {
    isPlayingRef.current = playing;
  }, []);

  useEffect(() => {
    if (!isAnalysing) return;
    const isH5 = process.env.TARO_ENV === 'h5' && analyserRef.current;

    const tick = () => {
      const playing = isPlayingRef.current;

      if (isH5) {
        // --- 真实 FFT 分析 ---
        const analyser = analyserRef.current;
        analyser.getByteFrequencyData(freqDataRef.current);
        const data = freqDataRef.current;

        const subBass = avgRange(data, ...BANDS.subBass);
        const bass = avgRange(data, ...BANDS.bass);
        const lowMid = avgRange(data, ...BANDS.lowMid);
        const mid = avgRange(data, ...BANDS.mid);
        const highMid = avgRange(data, ...BANDS.highMid);
        const presence = avgRange(data, ...BANDS.presence);
        const brilliance = avgRange(data, ...BANDS.brilliance);
        const air = avgRange(data, ...BANDS.air);
        const energy = (subBass + bass + lowMid + mid + highMid + presence + brilliance + air) / 8;

        // 节拍检测
        const bassEnergy = subBass * 0.6 + bass * 0.4;
        const hist = bassHistRef.current;
        hist.push(bassEnergy);
        if (hist.length > 35) hist.shift();

        let beatStrength = 0;
        if (beatCooldownRef.current <= 0 && hist.length >= 10) {
          const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
          const variance = hist.reduce((a, b) => a + (b - mean) ** 2, 0) / hist.length;
          const std = Math.sqrt(variance);
          const threshold = Math.max(0.06, mean + std * 1.0);
          const prevBass = hist[hist.length - 2] || 0;
          if (bassEnergy > threshold && bassEnergy > prevBass * 1.08) {
            beatStrength = Math.min(1, (bassEnergy - threshold) / Math.max(0.1, threshold) + 0.4);
            beatPulseRef.current = 1;
            beatCooldownRef.current = 7;
          }
        }
        if (beatCooldownRef.current > 0) beatCooldownRef.current--;
        beatPulseRef.current = Math.max(0, beatPulseRef.current - 0.06);
        const beat = beatPulseRef.current;

        const target: MiniAudioFeatures = {
          subBass, bass, lowMid, mid, highMid, presence, brilliance, air,
          energy, beat, beatStrength,
        };

        // 平滑（跟手）
        const rate = energy > 0.02 ? 0.4 : 0.12;
        const alpha = 1 - Math.pow(1 - rate, 1);
        const sm = smoothedRef.current;
        const result: MiniAudioFeatures = { ...INITIAL };
        (Object.keys(target) as Array<keyof MiniAudioFeatures>).forEach(k => {
          if (k === 'beat' || k === 'beatStrength') {
            result[k] = target[k];
          } else {
            result[k] = sm[k] + (target[k] - sm[k]) * alpha;
          }
        });
        smoothedRef.current = result;
        setFeatures(result);
      } else {
        // --- 伪节拍模拟（非 H5 环境）---
        pseudoTimeRef.current += 0.016;
        const t = pseudoTimeRef.current;

        if (playing) {
          // 模拟 BPM ~120 (2 beats/sec)
          const beatPhase = (t * 2) % 1;
          const beatRaw = Math.exp(-beatPhase * 6);
          const beat = playing ? beatRaw : 0;

          // 模拟频段：低频跟节拍，中频缓变，高频随机闪烁
          const subBass = playing ? beat * 0.7 : 0;
          const bass = playing ? beat * 0.5 + Math.sin(t * 0.5) * 0.1 : 0;
          const lowMid = playing ? Math.sin(t * 0.8) * 0.2 + 0.15 : 0;
          const mid = playing ? Math.sin(t * 1.2) * 0.15 + 0.1 : 0;
          const highMid = playing ? Math.random() * 0.2 + Math.sin(t * 2) * 0.1 : 0;
          const presence = playing ? Math.random() * 0.15 : 0;
          const brilliance = playing ? Math.random() * 0.1 : 0;
          const air = playing ? Math.random() * 0.08 : 0;
          const energy = (subBass + bass + lowMid + mid + highMid + presence + brilliance + air) / 8;

          // 节拍上升沿
          let beatStrength = 0;
          if (beatPhase < 0.05 && beatCooldownRef.current <= 0) {
            beatStrength = 0.5 + Math.random() * 0.4;
            beatCooldownRef.current = 30;
          }
          if (beatCooldownRef.current > 0) beatCooldownRef.current--;

          const target: MiniAudioFeatures = {
            subBass: Math.max(0, subBass), bass: Math.max(0, bass),
            lowMid: Math.max(0, lowMid), mid: Math.max(0, mid),
            highMid: Math.max(0, highMid), presence: Math.max(0, presence),
            brilliance: Math.max(0, brilliance), air: Math.max(0, air),
            energy: Math.max(0, energy), beat, beatStrength,
          };

          const rate = 0.4;
          const alpha = 1 - Math.pow(1 - rate, 1);
          const sm = smoothedRef.current;
          const result: MiniAudioFeatures = { ...INITIAL };
          (Object.keys(target) as Array<keyof MiniAudioFeatures>).forEach(k => {
            if (k === 'beat' || k === 'beatStrength') {
              result[k] = target[k];
            } else {
              result[k] = sm[k] + (target[k] - sm[k]) * alpha;
            }
          });
          smoothedRef.current = result;
          setFeatures(result);
        } else {
          // 闲置：缓慢衰减到 0
          const sm = smoothedRef.current;
          const result: MiniAudioFeatures = { ...INITIAL };
          (Object.keys(sm) as Array<keyof MiniAudioFeatures>).forEach(k => {
            result[k] = sm[k] * 0.95;
          });
          smoothedRef.current = result;
          setFeatures(result);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isAnalysing]);

  // 清理
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (sourceRef.current) sourceRef.current.disconnect();
      if (analyserRef.current) analyserRef.current.disconnect();
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
    };
  }, []);

  return { features, initAnalyser, setPlaying, isAnalysing };
}
