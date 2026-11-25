// mini-app/src/hooks/useTheme.ts - 主题切换 Hook（小程序版，用 Taro Storage）
import { useState, useCallback } from 'react';
import Taro from '@tarojs/taro';
import { ThemeMode, Preset, PRESETS } from '../../../shared/theme-presets';

const STORAGE_KEY_MODE = 'mb_theme_mode';
const STORAGE_KEY_PRESET = 'mb_theme_preset';

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    try {
      const v = Taro.getStorageSync(STORAGE_KEY_MODE);
      return v || 'dark';
    } catch {
      return 'dark';
    }
  });

  const [preset, setPresetState] = useState<Preset>(() => {
    try {
      const v = Taro.getStorageSync(STORAGE_KEY_PRESET);
      return v || 'galaxy';
    } catch {
      return 'galaxy';
    }
  });

  const colors = PRESETS[preset][mode];

  const toggleMode = useCallback(() => {
    setMode(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      Taro.setStorageSync(STORAGE_KEY_MODE, next);
      return next;
    });
  }, []);

  const setPreset = useCallback((p: Preset) => {
    setPresetState(p);
    Taro.setStorageSync(STORAGE_KEY_PRESET, p);
  }, []);

  return { mode, setMode, toggleMode, preset, setPreset, colors };
}
