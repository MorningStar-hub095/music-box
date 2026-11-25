# Aurora Glass 前端美化设计

## 背景

音乐盒子 Web 前端当前为深色主题，主色青绿 #17C3B2，有 3D 歌词阶梯、封面发光、频谱可视化等亮点。但存在设计令牌不一致、硬编码颜色多、视觉层次单薄等问题。本次美化将融合 Glassmorphism、Aurora/Gradient、Neumorphism、Glass+Aurora 四种风格为全新「Aurora Glass」风格，并为歌词区打造「梦幻与现实交织」的独特体验。

## 设计目标

1. **统一设计系统** — 消除 TS 令牌与 CSS 令牌的不一致，所有颜色走变量
2. **Aurora Glass 融合风格** — 动态渐变背景 + 玻璃拟态卡片 + 新拟态控件
3. **梦幻现实歌词** — 当前行锐利清晰（现实），远距行逐渐模糊飘渺（梦境）
4. **精致打磨** — 增强动画过渡、修复视觉不一致、提升整体质感

## 视觉架构

### 第 1 层：Aurora 动态渐变背景
- 全屏 `body` 层，两个大色块以 `radial-gradient` 缓慢流动
- 色块取自当前歌曲 `coverColor` + 互补色
- `@keyframes` 动画 20s 循环，`transform: translate` + `scale`
- 叠加 `#0F1419` 半透明遮罩保证文字可读性

### 第 2 层：Glassmorphism 玻璃卡片
- 播放器主卡片：`rgba(255,255,255,0.06)` + `backdrop-filter: blur(20px)`
- 边框：`1px solid rgba(255,255,255,0.1)`
- 圆角：`var(--radius-xl)` (16px)
- 阴影：`0 8px 32px rgba(0,0,0,0.3)`
- 搜索浮层、主题菜单同风格

### 第 3 层：Neumorphism 控件
- 播放按钮：外凸阴影 `4px 4px 12px rgba(0,0,0,0.3), -4px -4px 12px rgba(255,255,255,0.05)`
- 辅助按钮：凹槽 `inset 2px 2px 6px rgba(0,0,0,0.2), inset -2px -2px 6px rgba(255,255,255,0.03)`
- 进度条/音量条：凹槽轨道 + 玻璃 thumb
- hover 时阴影减弱，模拟"按下"效果

### 第 4 层：梦幻现实歌词
- **当前行（现实）**：锐利、清晰、高对比、温暖发光、玻璃面板背景
- **±1行（苏醒）**：`blur(1px)`、柔和光晕、半透明
- **±2行（入梦）**：`blur(3px)`、色彩偏移、渐淡
- **±3行（浅梦）**：`blur(6px)`、飘渺光斑、几乎不可读
- **±4+行（深梦）**：`blur(10px)`、化为光点、融入背景
- 过渡：0.6s 缓动，旧行"坠入梦境"、新行"从梦中苏醒"
- 背景：缓慢漂浮的光点粒子

### 封面区
- 玻璃面板 + neumorphic 内阴影
- 播放时发光阴影脉动（呼吸效果）
- 封面图片圆角 + 内嵌阴影

### 频谱可视化
- 渐变色柱（从 `coverColor` 到 `primary`）
- 玻璃背景半透明 + 模糊

### 播放列表/收藏/最近
- 玻璃卡片风格列表项
- 激活项主色微光边框
- hover 时玻璃高亮

## 设计令牌统一

### 新增 CSS 变量
```css
/* Glassmorphism */
--glass-bg: rgba(255, 255, 255, 0.06);
--glass-border: rgba(255, 255, 255, 0.1);
--glass-blur: 20px;

/* Neumorphism */
--neu-shadow-light: rgba(255, 255, 255, 0.05);
--neu-shadow-dark: rgba(0, 0, 0, 0.3);
--neu-radius: 12px;

/* Aurora */
--aurora-color-1: var(--color-primary);
--aurora-color-2: #8B5CF6;
--aurora-overlay: rgba(15, 20, 25, 0.7);

/* Dream Lyrics */
--dream-blur-1: 1px;
--dream-blur-2: 3px;
--dream-blur-3: 6px;
--dream-blur-4: 10px;
--dream-opacity-1: 0.7;
--dream-opacity-2: 0.5;
--dream-opacity-3: 0.3;
--dream-opacity-4: 0.15;
```

### 消除硬编码
- 所有 `rgba(23, 195, 178, ...)` 替换为 `color-mix(in srgb, var(--color-primary) XX%, transparent)` 或新增变量
- `#0F1419` 替换为 `var(--color-bg-page)`
- `#FFD60A` 替换为 `var(--color-highlight)`

## 文件改动范围

| 文件 | 改动 |
|------|------|
| `web/src/styles/theme.css` | 新增 Glass/Neu/Aurora/Dream 变量 |
| `web/src/App.css` | 全面重构视觉样式 |
| `web/src/App.tsx` | 歌词梦幻层级类名 + 粒子背景 div |
| `shared/design-tokens.ts` | 与 CSS 变量同步 |
| `shared/theme-presets.ts` | 更新预设配色适配新风格 |

## 验证
- `npm run build` 通过
- IDE 诊断无错误
- 三套主题预设（海洋/日落/森林）在 Aurora Glass 风格下均正常切换
