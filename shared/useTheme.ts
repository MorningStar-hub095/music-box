// shared/useTheme.ts - 主题切换 Hook（Web 版，用 localStorage）
import { useState, useCallback, useEffect } from 'react';
import { ThemeMode, Preset, PRESETS, ThemeColors } from './theme-presets';

const STORAGE_KEY_MODE = 'mb_theme_mode';
const STORAGE_KEY_PRESET = 'mb_theme_preset';

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) as T : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/** 将 #RRGGBB 颜色变暗 percent% (0-100) */
function darken(hex: string, percent: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const r = Math.max(0, Math.floor(((num >> 16) & 0xff) * (1 - percent / 100)));
  const g = Math.max(0, Math.floor(((num >> 8) & 0xff) * (1 - percent / 100)));
  const b = Math.max(0, Math.floor((num & 0xff) * (1 - percent / 100)));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

/** 提取 #RRGGBB 的 "r, g, b" 字符串 */
function hexToRgb(hex: string, fallback = '99, 102, 241'): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return fallback;
  const num = parseInt(m[1], 16);
  return `${(num >> 16) & 0xff}, ${(num >> 8) & 0xff}, ${num & 0xff}`;
}

/** 根据基础颜色派生全套 CSS 变量 */
function deriveVars(colors: ThemeColors, mode: ThemeMode) {
  const primaryRgb = hexToRgb(colors.primary, '99, 102, 241');
  const surfaceRgb = hexToRgb(colors.surface, '15, 18, 40');
  const primaryDark = darken(colors.primary, 15);

  // 根据模式调整透明度
  const isDark = mode === 'dark';
  const glassOpacity = isDark ? 0.4 : 0.6;
  const glassHoverOpacity = isDark ? 0.6 : 0.8;
  const borderOpacity = isDark ? 0.06 : 0.12;
  const borderHoverOpacity = isDark ? 0.12 : 0.2;
  
  // 文字颜色：深色模式用白色系，浅色模式用黑色系
  const textTertiaryColor = isDark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.45)';

  return {
    // 主色系
    '--color-primary': colors.primary,
    '--color-primary-light': colors.primaryLight,
    '--color-primary-dark': primaryDark,
    '--color-primary-glow': colors.primaryGlow,
    '--color-primary-soft': `rgba(${primaryRgb}, 0.12)`,
    // 背景
    '--color-bg-page': colors.background,
    '--color-bg-card': colors.surface,
    '--color-bg-hover': `rgba(${surfaceRgb}, ${isDark ? 0.8 : 0.5})`,
    // 文字
    '--color-text-primary': colors.textPrimary,
    '--color-text-secondary': colors.textSecondary,
    '--color-text-tertiary': textTertiaryColor,
    // 边框
    '--color-border': `rgba(${surfaceRgb}, ${isDark ? 0.3 : 0.15})`,
    '--color-divider': `rgba(${surfaceRgb}, ${isDark ? 0.2 : 0.1})`,
    // 点缀
    '--color-highlight': colors.highlight,
    '--color-favorite': '#F472B6',
    // 玻璃星云
    '--glass-bg': `rgba(${surfaceRgb}, ${glassOpacity})`,
    '--glass-bg-hover': `rgba(${surfaceRgb}, ${glassHoverOpacity})`,
    '--glass-border': `rgba(255, 255, 255, ${borderOpacity})`,
    '--glass-border-hover': `rgba(255, 255, 255, ${borderHoverOpacity})`,
    '--glass-shadow': `0 8px 32px rgba(0, 0, 0, ${isDark ? 0.4 : 0.15})`,
    // 星轨歌词
    '--star-active-color': colors.highlight,
    '--star-active-glow': `0 0 20px rgba(${primaryRgb}, 0.4), 0 0 40px rgba(${primaryRgb}, 0.15)`,
    '--star-near-color': colors.textSecondary,
    '--star-far-color': `rgba(${surfaceRgb}, ${isDark ? 0.5 : 0.4})`,
  };
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => loadFromStorage(STORAGE_KEY_MODE, 'dark'));
  const [preset, setPresetState] = useState<Preset>(() => loadFromStorage(STORAGE_KEY_PRESET, 'galaxy'));

  const colors = PRESETS[preset][mode];

  useEffect(() => {
    const root = document.documentElement;
    const vars = deriveVars(colors, mode);
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
    root.setAttribute('data-theme', mode);
    root.setAttribute('data-preset', preset);
  }, [colors, mode, preset]);

  const toggleMode = useCallback(() => {
    setMode(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      saveToStorage(STORAGE_KEY_MODE, next);
      return next;
    });
  }, []);

  const setPreset = useCallback((p: Preset) => {
    setPresetState(p);
    saveToStorage(STORAGE_KEY_PRESET, p);
  }, []);

  return { mode, setMode, toggleMode, preset, setPreset, colors };
}
