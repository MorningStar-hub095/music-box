// web/src/sonic/stage-presets.ts
// 沉浸舞台 · 视觉预设系统 — 自研实现
// 每套预设 = 独立的镜头语言 + 粒子规则 + 色彩体系（非简单换肤）
// 参考"节奏驱动电影镜头"的体验形态，全部代码为本项目原创

export type ParticleFormation = 'sphere' | 'river' | 'ring' | 'cloud';

export interface StageCamera {
  /** 初始环绕半径 */
  radius: number;
  /** 基础环绕速度（rad/s，能量会加速） */
  orbitSpeed: number;
  /** 推拉幅度（随音频能量呼吸） */
  dollyAmp: number;
  /** 推拉速度 */
  dollySpeed: number;
  /** 竖直呼吸幅度 */
  breatheAmp: number;
  /** 节拍震动幅度 */
  shakeAmp: number;
  /** 相机基础高度 */
  lift: number;
  /** 视场角 */
  fov: number;
}

export interface StagePreset {
  key: string;
  label: string;
  description: string;
  /** 粒子初始分布形态 */
  formation: ParticleFormation;
  /** 粒子数量（极简预设刻意少，兼顾低端机） */
  particleCount: number;
  /** 粒子基础尺寸 */
  particleSize: number;
  /** 湍流强度 */
  turbulence: number;
  /** 环绕流场强度（绕 Y 轴旋转流） */
  swirl: number;
  /** 缓慢漂移强度 */
  drift: number;
  /** 节拍爆发力（粒子向外迸散） */
  burst: number;
  /** 主色 / 辅色 / 节拍高光色 / 底色（0-1 线性 RGB） */
  colorA: [number, number, number];
  colorB: [number, number, number];
  peakColor: [number, number, number];
  background: [number, number, number];
  /** 泛光强度 */
  glow: number;
  camera: StageCamera;
}

export const STAGE_PRESETS: Record<string, StagePreset> = {
  'nebula-flow': {
    key: 'nebula-flow',
    label: '星云流光',
    description: '紫粉色星云球状聚合，镜头环绕呼吸，适合流行与 R&B',
    formation: 'sphere',
    particleCount: 1800,
    particleSize: 0.9,
    turbulence: 1.0,
    swirl: 0.35,
    drift: 0.5,
    burst: 1.0,
    colorA: [0.45, 0.15, 1.0],
    colorB: [1.0, 0.3, 0.75],
    peakColor: [1.0, 0.85, 0.35],
    background: [0.012, 0.008, 0.03],
    glow: 1.25,
    camera: {
      radius: 26, orbitSpeed: 0.12, dollyAmp: 0.22, dollySpeed: 0.5,
      breatheAmp: 2.2, shakeAmp: 0.6, lift: 6, fov: 62,
    },
  },
  'star-river': {
    key: 'star-river',
    label: '星河',
    description: '深邃银河盘面缓缓流转，镜头低空掠行，适合电子与氛围',
    formation: 'river',
    particleCount: 2400,
    particleSize: 0.7,
    turbulence: 0.45,
    swirl: 0.9,
    drift: 0.25,
    burst: 0.6,
    colorA: [0.15, 0.45, 1.0],
    colorB: [0.75, 0.9, 1.0],
    peakColor: [1.0, 0.55, 0.2],
    background: [0.004, 0.008, 0.024],
    glow: 1.1,
    camera: {
      radius: 34, orbitSpeed: 0.08, dollyAmp: 0.3, dollySpeed: 0.35,
      breatheAmp: 1.4, shakeAmp: 0.35, lift: 9, fov: 58,
    },
  },
  'planet-orbit': {
    key: 'planet-orbit',
    label: '星球轨道',
    description: '金色天体环带环绕，镜头大幅推拉环绕，适合史诗与摇滚',
    formation: 'ring',
    particleCount: 2000,
    particleSize: 1.0,
    turbulence: 0.6,
    swirl: 0.55,
    drift: 0.35,
    burst: 1.3,
    colorA: [1.0, 0.62, 0.12],
    colorB: [0.95, 0.3, 0.1],
    peakColor: [1.0, 0.95, 0.6],
    background: [0.02, 0.012, 0.005],
    glow: 1.4,
    camera: {
      radius: 30, orbitSpeed: 0.16, dollyAmp: 0.38, dollySpeed: 0.6,
      breatheAmp: 2.8, shakeAmp: 0.9, lift: 4, fov: 66,
    },
  },
  'zen-minimal': {
    key: 'zen-minimal',
    label: '禅境极简',
    description: '黑白微尘缓浮，镜头近乎静止，低端设备与专注场景首选',
    formation: 'cloud',
    particleCount: 450,
    particleSize: 0.6,
    turbulence: 0.2,
    swirl: 0.06,
    drift: 0.8,
    burst: 0.3,
    colorA: [0.85, 0.85, 0.88],
    colorB: [0.4, 0.4, 0.45],
    peakColor: [1.0, 1.0, 1.0],
    background: [0.01, 0.01, 0.012],
    glow: 0.8,
    camera: {
      radius: 24, orbitSpeed: 0.04, dollyAmp: 0.08, dollySpeed: 0.25,
      breatheAmp: 0.8, shakeAmp: 0.12, lift: 5, fov: 55,
    },
  },
};

export const STAGE_PRESET_KEYS = Object.keys(STAGE_PRESETS);

// ── 用户存档 ──────────────────────────────────────────────
// 每个存档 = 预设 key + 用户微调参数，可导出 JSON 分享

export interface StageSlot {
  presetKey: string;
  /** 泛光微调 0.5-2 */
  glowScale: number;
  /** 粒子密度微调 0.3-1.5 */
  densityScale: number;
  savedAt: number;
  label?: string;
}

const SLOTS_STORAGE_KEY = 'mb_stage_slots';
const CURRENT_STORAGE_KEY = 'mb_stage_preset';
export const STAGE_SLOT_COUNT = 4;

export function loadStageSlots(): (StageSlot | null)[] {
  try {
    const raw = localStorage.getItem(SLOTS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.from({ length: STAGE_SLOT_COUNT }, (_, i) =>
      arr[i] && typeof arr[i].presetKey === 'string' ? (arr[i] as StageSlot) : null
    );
  } catch {
    return Array.from({ length: STAGE_SLOT_COUNT }, () => null);
  }
}

export function saveStageSlots(slots: (StageSlot | null)[]): void {
  try {
    localStorage.setItem(SLOTS_STORAGE_KEY, JSON.stringify(slots));
  } catch { /* 存储已满等情况忽略 */ }
}

export function loadCurrentPresetKey(): string {
  const key = localStorage.getItem(CURRENT_STORAGE_KEY);
  return key && STAGE_PRESETS[key] ? key : 'nebula-flow';
}

export function saveCurrentPresetKey(key: string): void {
  try { localStorage.setItem(CURRENT_STORAGE_KEY, key); } catch { /* ignore */ }
}

/** 导出单个存档为可分享 JSON 字符串 */
export function exportSlot(slot: StageSlot): string {
  return JSON.stringify({ magic: 'musicbox-stage', version: 1, slot }, null, 2);
}

/** 导入 JSON 文本 → 存档（严格校验，防注入脏数据） */
export function importSlot(text: string): StageSlot | null {
  try {
    const obj = JSON.parse(text);
    if (obj?.magic !== 'musicbox-stage' || !obj.slot) return null;
    const s = obj.slot;
    if (typeof s.presetKey !== 'string' || !STAGE_PRESETS[s.presetKey]) return null;
    const clamp = (v: unknown, lo: number, hi: number, dflt: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
    return {
      presetKey: s.presetKey,
      glowScale: clamp(s.glowScale, 0.5, 2, 1),
      densityScale: clamp(s.densityScale, 0.3, 1.5, 1),
      savedAt: Date.now(),
      label: typeof s.label === 'string' ? s.label.slice(0, 30) : undefined,
    };
  } catch {
    return null;
  }
}

/** 长内容（DJ/播客）判定阈值：20 分钟 */
export const LONG_CONTENT_THRESHOLD_MS = 20 * 60 * 1000;
