// mini-app/src/sonic/themes.ts
// 音域回响色彩主题（小程序版精简）
export interface MiniTheme {
  label: string;
  baseColor1: string;
  baseColor2: string;
  coolCore: string;
  warmCore: string;
  rippleColor: string;
  peakColor: string;
}

export const MINI_THEMES: Record<string, MiniTheme> = {
  nocturnal: {
    label: '靛蓝紫',
    baseColor1: '#010206', baseColor2: '#040612',
    coolCore: '#591AE6', warmCore: '#A640FF',
    rippleColor: '#8033FF', peakColor: '#FF8C0D',
  },
  'ocean-deep': {
    label: '深海蓝',
    baseColor1: '#010207', baseColor2: '#01050F',
    coolCore: '#0040FF', warmCore: '#268CFF',
    rippleColor: '#1A80FF', peakColor: '#FFBF1A',
  },
  'arctic-aurora': {
    label: '冰蓝',
    baseColor1: '#010406', baseColor2: '#03080E',
    coolCore: '#00BFD9', warmCore: '#33FFD9',
    rippleColor: '#1AE6E6', peakColor: '#FF4059',
  },
  'cyber-forest': {
    label: '翡翠绿',
    baseColor1: '#010501', baseColor2: '#030B05',
    coolCore: '#00D959', warmCore: '#66FF4D',
    rippleColor: '#4DFF66', peakColor: '#FF3380',
  },
  'ember-fire': {
    label: '琥珀橙',
    baseColor1: '#060201', baseColor2: '#0D0501',
    coolCore: '#FF7300', warmCore: '#FFC726',
    rippleColor: '#FFA61A', peakColor: '#1A66FF',
  },
  'crimson-sunset': {
    label: '血红',
    baseColor1: '#060101', baseColor2: '#0E0304',
    coolCore: '#FF0D14', warmCore: '#FF5933',
    rippleColor: '#FF261A', peakColor: '#1AE6B3',
  },
  'neon-tokyo': {
    label: '霓虹紫粉',
    baseColor1: '#030106', baseColor2: '#080211',
    coolCore: '#FF0D99', warmCore: '#FF40D9',
    rippleColor: '#FF33BF', peakColor: '#F2FF26',
  },
  'minimal-monochrome': {
    label: '极简黑白',
    baseColor1: '#030303', baseColor2: '#0B0B0B',
    coolCore: '#CCCCCC', warmCore: '#FFFFFF',
    rippleColor: '#FFFFFF', peakColor: '#FFFFFF',
  },
};

export const MINI_THEME_KEYS = Object.keys(MINI_THEMES);
