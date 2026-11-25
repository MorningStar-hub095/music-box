// web/src/hooks/useStagePreset.ts
// 沉浸舞台预设状态管理：当前预设 + 4 个用户存档槽 + 导出/导入

import { useState, useCallback, useEffect } from 'react';
import {
  STAGE_PRESETS, StagePreset, StageSlot, STAGE_SLOT_COUNT,
  loadStageSlots, saveStageSlots, loadCurrentPresetKey, saveCurrentPresetKey,
  exportSlot, importSlot,
} from '../sonic/stage-presets';

export function useStagePreset() {
  const [presetKey, setPresetKeyState] = useState<string>(() => loadCurrentPresetKey());
  const [slots, setSlotsState] = useState<(StageSlot | null)[]>(() => loadStageSlots());
  // 存档微调参数（切换预设/应用存档时重置）
  const [glowScale, setGlowScale] = useState(1);
  const [densityScale, setDensityScale] = useState(1);

  const preset: StagePreset = STAGE_PRESETS[presetKey] || STAGE_PRESETS['nebula-flow'];

  const setPresetKey = useCallback((key: string) => {
    if (!STAGE_PRESETS[key]) return;
    setPresetKeyState(key);
    saveCurrentPresetKey(key);
    // 切换预设时重置微调，保证所见即预设
    setGlowScale(1);
    setDensityScale(1);
  }, []);

  const saveToSlot = useCallback((index: number, label?: string) => {
    if (index < 0 || index >= STAGE_SLOT_COUNT) return;
    setSlotsState(prev => {
      const next = [...prev];
      next[index] = { presetKey, glowScale, densityScale, savedAt: Date.now(), label };
      saveStageSlots(next);
      return next;
    });
  }, [presetKey, glowScale, densityScale]);

  const applySlot = useCallback((index: number) => {
    const slot = slots[index];
    if (!slot || !STAGE_PRESETS[slot.presetKey]) return;
    setPresetKeyState(slot.presetKey);
    saveCurrentPresetKey(slot.presetKey);
    setGlowScale(slot.glowScale);
    setDensityScale(slot.densityScale);
  }, [slots]);

  const clearSlot = useCallback((index: number) => {
    setSlotsState(prev => {
      const next = [...prev];
      next[index] = null;
      saveStageSlots(next);
      return next;
    });
  }, []);

  const exportCurrent = useCallback((): string => exportSlot({
    presetKey, glowScale, densityScale, savedAt: Date.now(),
  }), [presetKey, glowScale, densityScale]);

  const importFromText = useCallback((text: string): boolean => {
    const slot = importSlot(text);
    if (!slot) return false;
    setPresetKeyState(slot.presetKey);
    saveCurrentPresetKey(slot.presetKey);
    setGlowScale(slot.glowScale);
    setDensityScale(slot.densityScale);
    return true;
  }, []);

  // 密度与粒子数联动：通过 CSS 变量无，直接由调用方把 densityScale 传给 StageScene
  useEffect(() => { /* slots 已在初始化时载入 */ }, []);

  return {
    preset, presetKey, setPresetKey,
    slots, saveToSlot, applySlot, clearSlot,
    glowScale, setGlowScale,
    densityScale, setDensityScale,
    exportCurrent, importFromText,
  };
}
