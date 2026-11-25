// web/src/sonic/themes.ts
// 音域回响 · Sonic Topography — 10 套色彩主题
// 颜色值为 0-1 线性 RGB，与原始 GLSL 着色器 uniform 一致

export interface SonicTheme {
  name: string;
  label: string;
  baseColor1: [number, number, number];
  baseColor2: [number, number, number];
  coolCore: [number, number, number];
  coolEdge: [number, number, number];
  warmCore: [number, number, number];
  warmEdge: [number, number, number];
  rippleColor: [number, number, number];
  peakColor: [number, number, number];
  glowIntensity: number;
}

export const SONIC_THEMES: Record<string, SonicTheme> = {
  nocturnal: {
    name: 'nocturnal',
    label: '靛蓝紫',
    baseColor1: [0.008, 0.012, 0.035],
    baseColor2: [0.02, 0.035, 0.09],
    coolCore: [0.45, 0.15, 1.0],
    coolEdge: [0.2, 0.05, 0.55],
    warmCore: [0.75, 0.3, 1.0],
    warmEdge: [0.55, 0.15, 0.85],
    rippleColor: [0.6, 0.25, 1.0],
    peakColor: [1.0, 0.6, 0.1],
    glowIntensity: 1.2,
  },
  'ocean-deep': {
    name: 'ocean-deep',
    label: '深海蓝',
    baseColor1: [0.005, 0.012, 0.035],
    baseColor2: [0.008, 0.025, 0.075],
    coolCore: [0.05, 0.35, 1.0],
    coolEdge: [0.02, 0.12, 0.45],
    warmCore: [0.2, 0.65, 1.0],
    warmEdge: [0.08, 0.45, 0.9],
    rippleColor: [0.15, 0.6, 1.0],
    peakColor: [1.0, 0.8, 0.15],
    glowIntensity: 1.3,
  },
  'arctic-aurora': {
    name: 'arctic-aurora',
    label: '冰蓝',
    baseColor1: [0.005, 0.02, 0.03],
    baseColor2: [0.015, 0.04, 0.07],
    coolCore: [0.05, 0.85, 0.95],
    coolEdge: [0.02, 0.4, 0.6],
    warmCore: [0.25, 1.0, 0.9],
    warmEdge: [0.08, 0.7, 0.7],
    rippleColor: [0.15, 0.95, 0.95],
    peakColor: [1.0, 0.3, 0.4],
    glowIntensity: 1.45,
  },
  'cyber-forest': {
    name: 'cyber-forest',
    label: '翡翠绿',
    baseColor1: [0.005, 0.025, 0.008],
    baseColor2: [0.015, 0.055, 0.022],
    coolCore: [0.05, 0.95, 0.4],
    coolEdge: [0.02, 0.45, 0.2],
    warmCore: [0.45, 1.0, 0.35],
    warmEdge: [0.2, 0.7, 0.25],
    rippleColor: [0.35, 1.0, 0.45],
    peakColor: [1.0, 0.25, 0.55],
    glowIntensity: 1.5,
  },
  'golden-hour': {
    name: 'golden-hour',
    label: '暖金黄',
    baseColor1: [0.025, 0.02, 0.008],
    baseColor2: [0.055, 0.04, 0.015],
    coolCore: [0.95, 0.7, 0.1],
    coolEdge: [0.6, 0.35, 0.03],
    warmCore: [1.0, 0.95, 0.45],
    warmEdge: [0.9, 0.75, 0.2],
    rippleColor: [1.0, 0.9, 0.3],
    peakColor: [0.25, 0.55, 1.0],
    glowIntensity: 1.4,
  },
  'ember-fire': {
    name: 'ember-fire',
    label: '琥珀橙',
    baseColor1: [0.03, 0.012, 0.003],
    baseColor2: [0.06, 0.022, 0.008],
    coolCore: [1.0, 0.5, 0.05],
    coolEdge: [0.7, 0.2, 0.02],
    warmCore: [1.0, 0.82, 0.2],
    warmEdge: [0.95, 0.6, 0.08],
    rippleColor: [1.0, 0.7, 0.15],
    peakColor: [0.15, 0.45, 1.0],
    glowIntensity: 1.7,
  },
  'crimson-sunset': {
    name: 'crimson-sunset',
    label: '血红',
    baseColor1: [0.03, 0.005, 0.008],
    baseColor2: [0.065, 0.012, 0.018],
    coolCore: [1.0, 0.1, 0.12],
    coolEdge: [0.7, 0.02, 0.08],
    warmCore: [1.0, 0.4, 0.25],
    warmEdge: [0.9, 0.15, 0.12],
    rippleColor: [1.0, 0.2, 0.15],
    peakColor: [0.15, 0.95, 0.75],
    glowIntensity: 1.6,
  },
  'coral-mirage': {
    name: 'coral-mirage',
    label: '珊瑚粉',
    baseColor1: [0.025, 0.008, 0.012],
    baseColor2: [0.055, 0.018, 0.028],
    coolCore: [1.0, 0.3, 0.35],
    coolEdge: [0.75, 0.1, 0.2],
    warmCore: [1.0, 0.6, 0.6],
    warmEdge: [0.95, 0.35, 0.4],
    rippleColor: [1.0, 0.45, 0.45],
    peakColor: [0.15, 0.75, 1.0],
    glowIntensity: 1.5,
  },
  'neon-tokyo': {
    name: 'neon-tokyo',
    label: '霓虹紫粉',
    baseColor1: [0.015, 0.005, 0.03],
    baseColor2: [0.04, 0.012, 0.08],
    coolCore: [1.0, 0.1, 0.7],
    coolEdge: [0.6, 0.03, 0.9],
    warmCore: [1.0, 0.3, 0.9],
    warmEdge: [0.85, 0.12, 0.75],
    rippleColor: [1.0, 0.25, 0.8],
    peakColor: [1.0, 1.0, 0.2],
    glowIntensity: 1.8,
  },
  'minimal-monochrome': {
    name: 'minimal-monochrome',
    label: '极简黑白',
    baseColor1: [0.015, 0.015, 0.015],
    baseColor2: [0.05, 0.05, 0.05],
    coolCore: [0.85, 0.85, 0.85],
    coolEdge: [0.35, 0.35, 0.35],
    warmCore: [1.0, 1.0, 1.0],
    warmEdge: [0.65, 0.65, 0.65],
    rippleColor: [1.0, 1.0, 1.0],
    peakColor: [1.0, 1.0, 1.0],
    glowIntensity: 0.9,
  },
};

export const SONIC_THEME_KEYS = Object.keys(SONIC_THEMES);

// 每套主题的音频特征签名：[warmth, brightness, energy]
// warmth: 0=冷色, 1=暖色
// brightness: 0=低沉, 1=明亮
// energy: 0=舒缓, 1=激烈
interface ThemeSignature {
  warmth: number;
  brightness: number;
  energy: number;
}

const THEME_SIGNATURES: Record<string, ThemeSignature> = {
  'nocturnal':        { warmth: 0.3, brightness: 0.4, energy: 0.5 },  // 靛蓝紫 — 中性
  'ocean-deep':       { warmth: 0.2, brightness: 0.3, energy: 0.4 },  // 深海蓝 — 冷静
  'arctic-aurora':    { warmth: 0.2, brightness: 0.7, energy: 0.6 },  // 冰蓝 — 清亮
  'cyber-forest':    { warmth: 0.4, brightness: 0.6, energy: 0.7 },  // 翡翠绿 — 活力
  'golden-hour':     { warmth: 0.8, brightness: 0.7, energy: 0.5 },  // 暖金黄 — 温暖
  'ember-fire':      { warmth: 0.9, brightness: 0.6, energy: 0.9 },  // 琥珀橙 — 热烈
  'crimson-sunset':  { warmth: 0.8, brightness: 0.4, energy: 0.8 },  // 血红 — 激情
  'coral-mirage':    { warmth: 0.7, brightness: 0.6, energy: 0.5 },  // 珊瑚粉 — 柔美
  'neon-tokyo':      { warmth: 0.5, brightness: 0.8, energy: 0.9 },  // 霓虹紫粉 — 电音
  'minimal-monochrome': { warmth: 0.5, brightness: 0.5, energy: 0.3 }, // 极简黑白 — 低key
};

// 根据 UI 主题预设匹配对应的 Sonic 主题
export const PRESET_TO_SONIC: Record<string, string> = {
  galaxy: 'nocturnal',
  nebula: 'coral-mirage',
  aurora: 'cyber-forest',
  cyberpunk: 'neon-tokyo',
  minimal: 'minimal-monochrome',
  neumorphism: 'minimal-monochrome',
};

// 根据音频特征智能匹配最佳主题
export function matchTheme(features: { warmth: number; brightness: number; energy: number }): string {
  let bestKey = 'nocturnal';
  let bestScore = Infinity;

  for (const key of SONIC_THEME_KEYS) {
    const sig = THEME_SIGNATURES[key];
    // 计算欧氏距离（越小越匹配）
    const dw = (sig.warmth - features.warmth) * 1.2;
    const db = (sig.brightness - features.brightness) * 1.0;
    const de = (sig.energy - features.energy) * 0.8;
    const dist = dw * dw + db * db + de * de;
    if (dist < bestScore) {
      bestScore = dist;
      bestKey = key;
    }
  }
  return bestKey;
}
