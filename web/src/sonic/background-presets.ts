// web/src/sonic/background-presets.ts
// 背景板注册表：最终定稿仅保留「深空星河」
// 全部自研，未参考任何第三方源码。

export type BackgroundPresetId = 'nebula';

export interface BackgroundPresetDef {
  id: BackgroundPresetId;
  name: string;
  tagline: string;
  camera: { fov: number; position: [number, number, number]; near: number; far: number };
}

export const BACKGROUND_PRESETS: BackgroundPresetDef[] = [
  {
    id: 'nebula',
    name: '深空星河',
    tagline: '置身银河 · 双臂星流 · 星核呼吸',
    camera: { fov: 55, position: [0, 20, 74], near: 0.1, far: 400 },
  },
];

export function getBackgroundPreset(id: string): BackgroundPresetDef {
  return BACKGROUND_PRESETS.find((p) => p.id === id) ?? BACKGROUND_PRESETS[0];
}

export const BG_STORAGE_KEY = 'mb_bg_preset';
