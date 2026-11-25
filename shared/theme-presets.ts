// shared/theme-presets.ts - 主题色预设定义
export type ThemeMode = 'dark' | 'light';
export type Preset = 'galaxy' | 'nebula' | 'aurora' | 'cyberpunk' | 'minimal' | 'neumorphism';

export interface ThemeColors {
  primary: string;
  primaryLight: string;
  primaryGlow: string;
  surface: string;
  background: string;
  textPrimary: string;
  textSecondary: string;
  highlight: string;
}

export const PRESETS: Record<Preset, { dark: ThemeColors; light: ThemeColors }> = {
  galaxy: {
    dark: {
      primary: '#6366F1',
      primaryLight: '#818CF8',
      primaryGlow: 'rgba(99, 102, 241, 0.4)',
      surface: '#0F1228',
      background: '#080B1A',
      textPrimary: '#F8FAFC',
      textSecondary: '#94A3B8',
      highlight: '#FBBF24',
    },
    light: {
      primary: '#6366F1',
      primaryLight: '#818CF8',
      primaryGlow: 'rgba(99, 102, 241, 0.3)',
      surface: '#F0F0FF',
      background: '#FFFFFF',
      textPrimary: '#1A1D3A',
      textSecondary: 'rgba(26, 29, 58, 0.6)',
      highlight: '#D97706',
    },
  },
  nebula: {
    dark: {
      primary: '#EC4899',
      primaryLight: '#F472B6',
      primaryGlow: 'rgba(236, 72, 153, 0.4)',
      surface: '#2D1B2D',
      background: '#1A0F1A',
      textPrimary: '#FDF2F8',
      textSecondary: '#C4B5C4',
      highlight: '#FBBF24',
    },
    light: {
      primary: '#EC4899',
      primaryLight: '#F472B6',
      primaryGlow: 'rgba(236, 72, 153, 0.3)',
      surface: '#FFF0F5',
      background: '#FFFFFF',
      textPrimary: '#1A0F1A',
      textSecondary: 'rgba(26, 15, 26, 0.6)',
      highlight: '#D97706',
    },
  },
  aurora: {
    dark: {
      primary: '#10B981',
      primaryLight: '#34D399',
      primaryGlow: 'rgba(16, 185, 129, 0.4)',
      surface: '#0F2820',
      background: '#08170F',
      textPrimary: '#F0FDF4',
      textSecondary: '#9CA3AF',
      highlight: '#FBBF24',
    },
    light: {
      primary: '#10B981',
      primaryLight: '#34D399',
      primaryGlow: 'rgba(16, 185, 129, 0.3)',
      surface: '#F0FDF4',
      background: '#FFFFFF',
      textPrimary: '#08170F',
      textSecondary: 'rgba(8, 23, 15, 0.6)',
      highlight: '#D97706',
    },
  },
  cyberpunk: {
    dark: {
      primary: '#00F0FF',
      primaryLight: '#00D4FF',
      primaryGlow: 'rgba(0, 240, 255, 0.5)',
      surface: '#12121F',
      background: '#0A0A0F',
      textPrimary: '#E0F0FF',
      textSecondary: '#607080',
      highlight: '#FFD700',
    },
    light: {
      primary: '#00B8D4',
      primaryLight: '#00E5FF',
      primaryGlow: 'rgba(0, 184, 212, 0.3)',
      surface: '#F0FAFF',
      background: '#FAFCFF',
      textPrimary: '#0A1628',
      textSecondary: 'rgba(10, 22, 40, 0.6)',
      highlight: '#FF6D00',
    },
  },
  minimal: {
    dark: {
      primary: '#4A90D9',
      primaryLight: '#6BA5E7',
      primaryGlow: 'rgba(74, 144, 217, 0.3)',
      surface: '#1E1E2E',
      background: '#16161E',
      textPrimary: '#E8E8EE',
      textSecondary: '#8888A0',
      highlight: '#0066FF',
    },
    light: {
      primary: '#1A1A2E',
      primaryLight: '#16213E',
      primaryGlow: 'rgba(26, 26, 46, 0.1)',
      surface: '#FFFFFF',
      background: '#F8F9FA',
      textPrimary: '#1A1A2E',
      textSecondary: '#6C757D',
      highlight: '#0066FF',
    },
  },
  neumorphism: {
    dark: {
      primary: '#6C63FF',
      primaryLight: '#7B73FF',
      primaryGlow: 'rgba(108, 99, 255, 0.25)',
      surface: '#2D2D3F',
      background: '#252535',
      textPrimary: '#E0E0F0',
      textSecondary: '#9090A8',
      highlight: '#FF6B6B',
    },
    light: {
      primary: '#6C63FF',
      primaryLight: '#7B73FF',
      primaryGlow: 'rgba(108, 99, 255, 0.2)',
      surface: '#E0E5EC',
      background: '#E0E5EC',
      textPrimary: '#2D3436',
      textSecondary: '#636E72',
      highlight: '#FF6B6B',
    },
  },
};

export const PRESET_LABELS: Record<Preset, string> = {
  galaxy: '星河',
  nebula: '星云',
  aurora: '极光',
  cyberpunk: '赛博',
  minimal: '极简',
  neumorphism: '新拟态',
};
