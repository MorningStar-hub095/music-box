# 按钮与导航栏美化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 web 应用中所有按钮和导航栏元素从 emoji 升级为 SVG 线性图标 + 玻璃质感 + 三级层次，并加入品牌动画 Logo、Tab 胶囊、紧凑底部控制栏 + 曲目卡。

**Architecture:** 新建 `Icons.tsx` 集中管理所有 SVG 图标组件；修改 `App.tsx` 替换 emoji 为 SVG 组件并调整结构；修改 `App.css` 添加新样式与动效。所有交互逻辑保持不变。

**Tech Stack:** React + TypeScript + Vite，CSS 变量 + glassmorphism

**Spec:** `docs/superpowers/specs/2026-07-06-buttons-navbar-beautification-design.md`

---

## 文件结构

| 文件 | 操作 | 责任 |
|------|------|------|
| `web/src/components/Icons.tsx` | 新建 | 所有 SVG 图标组件（Feather 风格），统一导出 |
| `web/src/App.tsx` | 修改 | 替换 emoji 为 SVG 组件，重构导航栏/搜索栏/Action Row/底部控制栏结构 |
| `web/src/App.css` | 修改 | 新增品牌 Logo、Tab 胶囊、三级按钮、曲目卡样式与动效 |

---

## Task 1: 创建 SVG 图标组件库

**Files:**
- Create: `web/src/components/Icons.tsx`

- [ ] **Step 1: 创建 Icons.tsx 文件**

创建 `web/src/components/Icons.tsx`，内容如下：

```tsx
// web/src/components/Icons.tsx - SVG 线性图标库（Feather 风格）
import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
  fill?: string;
  strokeWidth?: number;
}

const baseProps = (size: number, className?: string, fill: string = 'none', strokeWidth: number = 1.8) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill,
  stroke: 'currentColor',
  strokeWidth,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
});

export const PlayIcon: React.FC<IconProps> = ({ size = 18, className, fill = 'currentColor' }) => (
  <svg {...baseProps(size, className, fill, 0)}>
    <path d="M8 5v14l11-7z" />
  </svg>
);

export const PauseIcon: React.FC<IconProps> = ({ size = 18, className, fill = 'currentColor' }) => (
  <svg {...baseProps(size, className, fill, 0)}>
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);

export const SkipBackIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M19 20L9 12l10-8v16z" />
    <line x1="5" y1="19" x2="5" y2="5" />
  </svg>
);

export const SkipForwardIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M5 4l10 8-10 8V4z" />
    <line x1="19" y1="5" x2="19" y2="19" />
  </svg>
);

export const HeartIcon: React.FC<IconProps> = ({ size = 18, className, fill = 'none' }) => (
  <svg {...baseProps(size, className, fill)}>
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);

export const MusicIcon: React.FC<IconProps> = ({ size = 18, className, fill = 'none' }) => (
  <svg {...baseProps(size, className, fill)}>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

export const ListIcon: React.FC<IconProps> = ({ size = 18, className }) => (
  <svg {...baseProps(size, className)}>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

export const BarChartIcon: React.FC<IconProps> = ({ size = 18, className }) => (
  <svg {...baseProps(size, className)}>
    <line x1="6" y1="20" x2="6" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="18" y1="20" x2="18" y2="14" />
  </svg>
);

export const ShuffleIcon: React.FC<IconProps> = ({ size = 12, className }) => (
  <svg {...baseProps(size, className)}>
    <polyline points="16 3 21 3 21 8" />
    <line x1="4" y1="20" x2="21" y2="3" />
    <polyline points="21 16 21 21 16 21" />
    <line x1="15" y1="15" x2="21" y2="21" />
    <line x1="4" y1="4" x2="9" y2="9" />
  </svg>
);

export const RepeatIcon: React.FC<IconProps> = ({ size = 12, className }) => (
  <svg {...baseProps(size, className)}>
    <polyline points="17 1 21 5 17 9" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);

export const RepeatOneIcon: React.FC<IconProps> = ({ size = 12, className }) => (
  <svg {...baseProps(size, className)}>
    <polyline points="17 1 21 5 17 9" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    <line x1="11" y1="10" x2="13" y2="10" />
    <line x1="12" y1="10" x2="12" y2="14" />
  </svg>
);

export const Volume2Icon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...baseProps(size, className)}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
);

export const VolumeXIcon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...baseProps(size, className)}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <line x1="23" y1="9" x2="17" y2="15" />
    <line x1="17" y1="9" x2="23" y2="15" />
  </svg>
);

export const SearchIcon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...baseProps(size, className)}>
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export const UploadIcon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

export const MoonIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

export const SunIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...baseProps(size, className)}>
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

export const XIcon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...baseProps(size, className)}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// 品牌 Logo 专用音符图标（填充）
export const NoteIcon: React.FC<IconProps> = ({ size = 16, className, fill = '#fff' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} className={className}>
    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
  </svg>
);
```

- [ ] **Step 2: 验证构建通过**

Run: `cd d:/music_box/web && npm.cmd run build`
Expected: 编译成功，无 TypeScript 错误

- [ ] **Step 3: 提交**

```bash
cd d:/music_box
git add web/src/components/Icons.tsx
git commit -m "feat: 添加 SVG 图标组件库 Icons.tsx"
```

---

## Task 2: 重构顶部导航栏

**Files:**
- Modify: `web/src/App.tsx`（导航栏部分，约 187-218 行）
- Modify: `web/src/App.css`（.nav, .nav-brand, .nav-tabs, .nav-tab, .nav-theme-btn, .theme-menu 样式）

- [ ] **Step 1: 修改 App.tsx 导航栏 JSX**

定位到 `<nav className="nav">` 部分，替换为：

```tsx
{/* 顶部导航 */}
<nav className="nav">
  <div className="nav-brand">
    <div className={`brand-logo${isPlaying ? ' playing' : ''}`}>
      <NoteIcon size={16} />
    </div>
    <span className="brand-text">音乐<span className="brand-accent">盒子</span></span>
  </div>
  <div className="nav-tabs-pill">
    <button
      className={activeTab === 'player' ? 'nav-tab-pill active' : 'nav-tab-pill'}
      onClick={() => setActiveTab('player')}
    >播放</button>
    <button
      className={activeTab === 'favorites' ? 'nav-tab-pill active' : 'nav-tab-pill'}
      onClick={() => setActiveTab('favorites')}
    >收藏 <span className="tab-badge">{favorites.length}</span></button>
    <button
      className={activeTab === 'recent' ? 'nav-tab-pill active' : 'nav-tab-pill'}
      onClick={() => setActiveTab('recent')}
    >最近 <span className="tab-badge">{recentTracks.length}</span></button>
  </div>
  <button className="nav-theme-btn" onClick={() => setShowThemeMenu(v => !v)} title="主题">
    {theme.mode === 'dark' ? <MoonIcon size={16} /> : <SunIcon size={16} />}
  </button>
  {showThemeMenu && (
    <div className="theme-menu">
      <button className="theme-menu-item" onClick={theme.toggleMode}>
        {theme.mode === 'dark' ? <SunIcon size={14} /> : <MoonIcon size={14} />}
        <span>{theme.mode === 'dark' ? '切换为亮色' : '切换为深色'}</span>
      </button>
      <div className="theme-menu-divider" />
      <div className="theme-presets">
        {(Object.keys(PRESET_LABELS) as Array<keyof typeof PRESET_LABELS>).map(p => (
          <button
            key={p}
            className={`theme-preset${theme.preset === p ? ' active' : ''}`}
            onClick={() => theme.setPreset(p)}
          >
            {PRESET_LABELS[p]}
          </button>
        ))}
      </div>
    </div>
  )}
</nav>
```

- [ ] **Step 2: 在 App.tsx 顶部添加 Icons 导入**

在 App.tsx 顶部 import 区域添加：

```tsx
import { PlayIcon, PauseIcon, SkipBackIcon, SkipForwardIcon, HeartIcon, MusicIcon,
        ListIcon, BarChartIcon, ShuffleIcon, RepeatIcon, RepeatOneIcon,
        Volume2Icon, VolumeXIcon, SearchIcon, UploadIcon, MoonIcon, SunIcon,
        XIcon, NoteIcon } from '@/components/Icons';
```

- [ ] **Step 3: 替换 App.css 中导航栏相关样式**

定位到 `/* ========== 导航栏 ========== */` 部分，替换 `.nav`、`.nav-brand`、`.nav-tabs`、`.nav-tab`、`.nav-theme-btn`、`.theme-menu` 全部样式为：

```css
/* ========== 导航栏 ========== */
.nav {
  display: flex;
  align-items: center;
  gap: var(--spacing-lg);
  padding: 0 var(--spacing-xl);
  height: 56px;
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
  z-index: 10;
  position: relative;
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.brand-logo {
  width: 28px; height: 28px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark));
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 12px var(--color-primary-glow);
  animation: brand-icon-float 3s ease-in-out infinite;
}
.brand-logo.playing {
  animation: brand-icon-spin 4s linear infinite;
}
@keyframes brand-icon-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}
@keyframes brand-icon-spin {
  to { transform: rotate(360deg); }
}

.brand-text {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: 0.5px;
}
.brand-accent {
  color: var(--color-primary-light);
}

/* Tab 胶囊容器 */
.nav-tabs-pill {
  display: flex;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--glass-border);
  border-radius: 999px;
  padding: 3px;
  margin-left: auto;
}
.nav-tab-pill {
  padding: 6px 16px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.nav-tab-pill:hover {
  color: var(--color-text-primary);
}
.nav-tab-pill.active {
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark));
  color: #fff;
  box-shadow: 0 2px 8px var(--color-primary-glow);
}
.tab-badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-tertiary);
}
.nav-tab-pill.active .tab-badge {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}

/* 主题切换按钮 */
.nav-theme-btn {
  width: 34px; height: 34px;
  border-radius: var(--radius-round);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  display: flex; align-items: center; justify-content: center;
  color: var(--color-text-secondary);
  transition: all 0.25s;
  flex-shrink: 0;
}
.nav-theme-btn:hover {
  background: var(--glass-bg-hover);
  border-color: var(--glass-border-hover);
  color: var(--color-primary-light);
  box-shadow: 0 0 12px var(--color-primary-glow);
  transform: rotate(15deg);
}

/* 主题菜单 */
.theme-menu {
  position: absolute;
  top: 50px; right: var(--spacing-xl);
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur-heavy));
  -webkit-backdrop-filter: blur(var(--glass-blur-heavy));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: var(--spacing-sm);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  z-index: 20;
  box-shadow: var(--glass-shadow);
  min-width: 180px;
}
.theme-menu-item {
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  font-size: 13px;
  color: var(--color-text-secondary);
  text-align: left;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  transition: all 0.2s;
}
.theme-menu-item:hover {
  background: var(--glass-bg-hover);
  color: var(--color-text-primary);
}
.theme-menu-divider {
  height: 1px;
  background: var(--glass-border);
  margin: 4px 0;
}
.theme-presets {
  display: flex;
  gap: 4px;
  padding: 4px 0;
}
.theme-preset {
  flex: 1;
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--radius-md);
  font-size: 12px;
  color: var(--color-text-secondary);
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid transparent;
  transition: all 0.2s;
  text-align: center;
}
.theme-preset:hover {
  color: var(--color-text-primary);
  background: var(--glass-bg-hover);
}
.theme-preset.active {
  color: var(--color-primary-light);
  background: var(--color-primary-soft);
  border-color: rgba(99, 102, 241, 0.4);
}
```

- [ ] **Step 4: 验证构建通过**

Run: `cd d:/music_box/web && npm.cmd run build`
Expected: 编译成功

- [ ] **Step 5: 提交**

```bash
cd d:/music_box
git add web/src/App.tsx web/src/App.css
git commit -m "feat: 重构导航栏 - 动画品牌Logo + 胶囊Tab + SVG主题按钮"
```

---

## Task 3: 重构搜索栏

**Files:**
- Modify: `web/src/App.tsx`（搜索栏部分，约 220-229 行）
- Modify: `web/src/App.css`（.search-bar, .search-input, .search-btn, .import-btn 样式）

- [ ] **Step 1: 修改 App.tsx 搜索栏 JSX**

定位到 `<div className="search-bar">` 部分，替换为：

```tsx
<div className="search-bar">
  <div className="search-input-wrap">
    <SearchIcon size={14} className="search-input-icon" />
    <input type="text" className="search-input" placeholder="搜索歌名/歌手..."
      value={search.query} onChange={(e) => search.setQuery(e.target.value)} />
  </div>
  <button className="search-btn" onClick={search.searchOnline} disabled={search.isSearching} title="在线搜索">
    {search.isSearching ? <span className="searching-spinner" /> : <SearchIcon size={14} />}
  </button>
  <button className="import-btn" onClick={localImport.importFiles} title="导入本地音频">
    <UploadIcon size={14} />
    <span>导入</span>
  </button>
  <input ref={localImport.inputRef} type="file" accept="audio/*" multiple style={{display:'none'}}
    onChange={(e) => { if (e.target.files) localImport.handleFiles(e.target.files); }} />
</div>
```

- [ ] **Step 2: 替换 App.css 中搜索栏样式**

定位到 `/* ========== 搜索栏 ========== */` 部分，替换为：

```css
/* ========== 搜索栏 ========== */
.search-bar {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-xl);
  position: relative;
  z-index: 10;
  flex-shrink: 0;
}

.search-input-wrap {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
}
.search-input-icon {
  position: absolute;
  left: 14px;
  color: var(--color-text-tertiary);
  pointer-events: none;
  transition: color 0.25s;
}
.search-input-wrap:focus-within .search-input-icon {
  color: var(--color-primary-light);
}

.search-input {
  width: 100%;
  height: 38px;
  padding: 0 var(--spacing-md) 0 38px;
  border-radius: var(--radius-round);
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;
  transition: all 0.25s;
  font-family: inherit;
}
.search-input::placeholder { color: var(--color-text-tertiary); }
.search-input:focus {
  border-color: var(--color-primary);
  background: var(--glass-bg-hover);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.search-btn, .import-btn {
  height: 38px;
  border-radius: var(--radius-round);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  display: flex; align-items: center; justify-content: center;
  font-size: 13px;
  color: var(--color-text-secondary);
  transition: all 0.25s;
  white-space: nowrap;
}
.search-btn { width: 38px; padding: 0; }
.import-btn { padding: 0 var(--spacing-md); gap: 6px; }
.search-btn:hover, .import-btn:hover {
  background: var(--glass-bg-hover);
  color: var(--color-primary-light);
  border-color: var(--glass-border-hover);
  box-shadow: 0 0 12px var(--color-primary-glow);
  transform: translateY(-1px);
}
.search-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

.searching-spinner {
  width: 14px; height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-top-color: var(--color-primary-light);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
```

- [ ] **Step 3: 验证构建通过**

Run: `cd d:/music_box/web && npm.cmd run build`
Expected: 编译成功

- [ ] **Step 4: 提交**

```bash
cd d:/music_box
git add web/src/App.tsx web/src/App.css
git commit -m "feat: 重构搜索栏 - 前置SVG图标 + 玻璃按钮"
```

---

## Task 4: 重构封面区 Action Row

**Files:**
- Modify: `web/src/App.tsx`（action-row 部分，约 285-301 行）
- Modify: `web/src/App.css`（.icon-btn 三级层次样式）

- [ ] **Step 1: 修改 App.tsx Action Row JSX**

定位到 `<div className="action-row">` 部分，替换为：

```tsx
<div className="action-row">
  <button
    className={`icon-btn${fav ? ' fav-active' : ''}`}
    onClick={handleToggleFavorite}
    title="收藏"
  >
    <HeartIcon size={18} fill={fav ? 'currentColor' : 'none'} />
  </button>
  <button
    className={`icon-btn${showLyrics ? ' active' : ''}`}
    onClick={() => setShowLyrics(v => !v)}
    title="歌词"
  >
    <MusicIcon size={18} fill={showLyrics ? 'currentColor' : 'none'} />
  </button>
  <button
    className={`icon-btn${showPlaylist ? ' active' : ''}`}
    onClick={() => setShowPlaylist(v => !v)}
    title="播放列表"
  >
    <ListIcon size={18} />
  </button>
  <button
    className={`icon-btn${visualizer.isActive ? ' active' : ''}`}
    onClick={visualizer.toggle}
    title="频谱"
  >
    <BarChartIcon size={18} />
  </button>
</div>
```

- [ ] **Step 2: 替换 App.css 中 .icon-btn 样式**

定位到 `.icon-btn {` 部分（包括 .icon-btn:hover, .icon-btn.active），替换为：

```css
.icon-btn {
  width: 40px; height: 40px;
  border-radius: var(--radius-round);
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
  display: flex; align-items: center; justify-content: center;
  color: var(--color-text-secondary);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.icon-btn:hover {
  background: var(--glass-bg-hover);
  color: var(--color-primary-light);
  border-color: var(--glass-border-hover);
  box-shadow: 0 0 16px var(--color-primary-glow);
  transform: translateY(-2px);
}
.icon-btn:active { transform: translateY(0) scale(0.95); }

/* L1 激活态：主色填充 */
.icon-btn.active {
  color: #fff;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark));
  border-color: transparent;
  box-shadow: 0 4px 16px var(--color-primary-glow);
}
.icon-btn.active:hover {
  transform: translateY(-2px) scale(1.05);
  box-shadow: 0 6px 24px var(--color-primary-glow);
}

/* L3 收藏激活态：粉色克制版 */
.icon-btn.fav-active {
  color: var(--color-favorite);
  background: rgba(244, 114, 182, 0.12);
  border-color: rgba(244, 114, 182, 0.3);
  box-shadow: 0 0 12px rgba(244, 114, 182, 0.25);
}
.icon-btn.fav-active:hover {
  background: rgba(244, 114, 182, 0.2);
  box-shadow: 0 0 20px rgba(244, 114, 182, 0.4);
  color: var(--color-favorite);
}
```

- [ ] **Step 3: 验证构建通过**

Run: `cd d:/music_box/web && npm.cmd run build`
Expected: 编译成功

- [ ] **Step 4: 提交**

```bash
cd d:/music_box
git add web/src/App.tsx web/src/App.css
git commit -m "feat: 重构Action Row - 三级按钮层次 + SVG图标"
```

---

## Task 5: 重构底部控制栏

**Files:**
- Modify: `web/src/App.tsx`（footer 部分，约 437-475 行）
- Modify: `web/src/App.css`（.footer, .ctrl-btn, .play-btn, .mode-btn, .volume-control, 新增 .track-mini 样式）

- [ ] **Step 1: 修改 App.tsx 底部控制栏 JSX**

定位到 `<footer className="footer">` 部分，替换 control-row 为：

```tsx
<div className="control-row">
  {/* 左侧：曲目迷你卡 */}
  <div className="track-mini">
    <div
      className={`track-mini-cover${isPlaying ? ' playing' : ''}`}
      style={{ background: `linear-gradient(135deg, ${currentTrack.coverColor} 0%, var(--color-bg-card) 100%)` }}
    >
      <MusicIcon size={14} fill="#fff" />
    </div>
    <div className="track-mini-info">
      <div className="track-mini-title">{currentTrack.title}</div>
      <div className="track-mini-artist">{currentTrack.artist}</div>
    </div>
  </div>

  {/* 中间：主控制按钮组 */}
  <div className="main-controls">
    <button className="ctrl-btn" onClick={prev} title="上一首">
      <SkipBackIcon size={16} />
    </button>
    <button className={`play-btn${waitingForUser ? ' pulse' : ''}${refreshing ? ' refreshing' : ''}`}
      onClick={handlePlayPause} title={isPlaying ? '暂停' : '播放'}>
      {refreshing ? <span className="refreshing-spinner" />
        : isPlaying ? <PauseIcon size={22} />
        : <PlayIcon size={22} />}
    </button>
    <button className="ctrl-btn" onClick={next} title="下一首">
      <SkipForwardIcon size={16} />
    </button>
  </div>

  {/* 右侧：模式 + 音量 */}
  <div className="footer-right">
    <button className="mode-btn" onClick={togglePlayMode} title={PLAY_MODE_LABEL[playMode]}>
      {playMode === 'shuffle' ? <ShuffleIcon size={12} />
        : playMode === 'repeat-one' ? <RepeatOneIcon size={12} />
        : <RepeatIcon size={12} />}
      <span className="mode-label">{PLAY_MODE_LABEL[playMode]}</span>
    </button>
    <div className="volume-control">
      <button className="vol-btn" onClick={toggleMute} title={muted ? '取消静音' : '静音'}>
        {muted ? <VolumeXIcon size={14} /> : <Volume2Icon size={14} />}
      </button>
      <input
        type="range" min={0} max={100}
        value={muted ? 0 : volume}
        onChange={(e) => setVolume(Number(e.target.value))}
        className="volume-slider"
        title="音量"
      />
    </div>
  </div>
</div>
```

- [ ] **Step 2: 替换 App.css 底部控制栏样式**

定位到 `/* ========== 底部控制栏 ========== */` 部分（直到响应式之前），替换为：

```css
/* ========== 底部控制栏 ========== */
.footer {
  flex-shrink: 0;
  padding: var(--spacing-sm) var(--spacing-xl) var(--spacing-md);
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border-top: 1px solid var(--glass-border);
  z-index: 10;
  position: relative;
}

.progress-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
}
.time-text {
  font-size: 11px;
  color: var(--color-text-tertiary);
  min-width: 36px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.slider {
  flex: 1;
  height: 4px;
  border-radius: var(--radius-round);
  background: var(--color-bg-hover);
  -webkit-appearance: none;
  appearance: none;
  outline: none;
  cursor: pointer;
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px; height: 12px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--color-primary);
  box-shadow: 0 0 8px var(--color-primary-glow);
  cursor: pointer;
  transition: transform 0.25s, box-shadow 0.25s;
}
.slider::-webkit-slider-thumb:hover {
  transform: scale(1.4);
  box-shadow: 0 0 16px var(--color-primary-glow);
}
.slider::-moz-range-thumb {
  width: 12px; height: 12px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--color-primary);
  box-shadow: 0 0 8px var(--color-primary-glow);
  cursor: pointer;
}

.control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
}

/* 曲目迷你卡 */
.track-mini {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 4px 10px 4px 4px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  max-width: 200px;
  min-width: 0;
}
.track-mini-cover {
  width: 28px; height: 28px;
  border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  color: #fff;
}
.track-mini-cover.playing {
  animation: cover-mini-pulse 2s ease-in-out infinite;
}
@keyframes cover-mini-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--color-primary-glow); }
  50% { box-shadow: 0 0 0 4px transparent; }
}
.track-mini-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.track-mini-title {
  font-size: 11px;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.track-mini-artist {
  font-size: 10px;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 主控制按钮组 */
.main-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ctrl-btn {
  width: 34px; height: 34px;
  border-radius: var(--radius-round);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  display: flex; align-items: center; justify-content: center;
  color: var(--color-text-secondary);
  transition: all 0.25s;
}
.ctrl-btn:hover {
  color: var(--color-primary-light);
  background: var(--glass-bg-hover);
  border-color: var(--glass-border-hover);
  box-shadow: 0 0 12px var(--color-primary-glow);
  transform: translateY(-1px);
}
.ctrl-btn:active { transform: translateY(0) scale(0.95); }

.play-btn {
  width: 48px; height: 48px;
  border-radius: var(--radius-round);
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark));
  border: none;
  box-shadow: 0 4px 20px var(--color-primary-glow);
  display: flex; align-items: center; justify-content: center;
  color: #fff;
  transition: all 0.25s;
}
.play-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 6px 30px var(--color-primary-glow);
}
.play-btn:active { transform: scale(0.97); }
.play-btn.pulse {
  animation: play-btn-pulse 1.6s ease-in-out infinite;
}
@keyframes play-btn-pulse {
  0%, 100% { box-shadow: 0 4px 20px var(--color-primary-glow); transform: scale(1); }
  50% { box-shadow: 0 8px 40px var(--color-primary-glow), 0 0 60px var(--color-primary-glow); transform: scale(1.08); }
}
.play-btn.refreshing {
  animation: spin 1s linear infinite;
}

.refreshing-spinner {
  width: 20px; height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: #fff;
  border-radius: 50%;
  display: inline-block;
}

/* 右侧：模式 + 音量 */
.footer-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.mode-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-md);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  font-size: 11px;
  color: var(--color-text-secondary);
  transition: all 0.25s;
}
.mode-btn:hover {
  color: var(--color-primary-light);
  background: var(--glass-bg-hover);
  border-color: var(--glass-border-hover);
}
.mode-label {
  font-size: 11px;
  white-space: nowrap;
}

.volume-control {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
}
.vol-btn {
  width: 30px; height: 30px;
  border-radius: var(--radius-round);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  display: flex; align-items: center; justify-content: center;
  color: var(--color-text-secondary);
  transition: all 0.25s;
}
.vol-btn:hover {
  color: var(--color-primary-light);
  background: var(--glass-bg-hover);
  box-shadow: 0 0 8px var(--color-primary-glow);
}

.volume-slider {
  width: 72px;
  height: 3px;
  border-radius: var(--radius-round);
  background: var(--color-bg-hover);
  -webkit-appearance: none;
  appearance: none;
  outline: none;
  cursor: pointer;
}
.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px; height: 10px;
  border-radius: 50%;
  background: var(--color-primary-light);
  cursor: pointer;
  box-shadow: 0 0 6px var(--color-primary-glow);
}
.volume-slider::-moz-range-thumb {
  width: 10px; height: 10px;
  border-radius: 50%;
  background: var(--color-primary-light);
  border: none;
  cursor: pointer;
}
```

- [ ] **Step 3: 验证构建通过**

Run: `cd d:/music_box/web && npm.cmd run build`
Expected: 编译成功

- [ ] **Step 4: 提交**

```bash
cd d:/music_box
git add web/src/App.tsx web/src/App.css
git commit -m "feat: 重构底部控制栏 - 紧凑布局 + 曲目迷你卡 + SVG控制按钮"
```

---

## Task 6: 重构弹层关闭按钮 + 搜索结果项

**Files:**
- Modify: `web/src/App.tsx`（search-overlay-header, playlist-close, error-close 部分）
- Modify: `web/src/App.css`（.search-overlay-header button, .playlist-close, .error-close 样式）

- [ ] **Step 1: 修改 App.tsx 中所有关闭按钮和搜索结果项的 emoji**

把 `<button onClick={search.closeOnline}>×</button>` 改为：

```tsx
<button onClick={search.closeOnline} title="关闭"><XIcon size={16} /></button>
```

把 `<button className="playlist-close" onClick={() => setShowPlaylist(false)}>×</button>` 改为：

```tsx
<button className="playlist-close" onClick={() => setShowPlaylist(false)} title="关闭">
  <XIcon size={14} />
</button>
```

把 `<button className="error-close" onClick={clearError}>×</button>` 改为：

```tsx
<button className="error-close" onClick={clearError} title="关闭">
  <XIcon size={14} />
</button>
```

- [ ] **Step 2: 验证构建通过**

Run: `cd d:/music_box/web && npm.cmd run build`
Expected: 编译成功

- [ ] **Step 3: 提交**

```bash
cd d:/music_box
git add web/src/App.tsx
git commit -m "feat: 弹层关闭按钮统一替换为SVG XIcon"
```

---

## Task 7: 清理旧样式 + 最终验证

**Files:**
- Modify: `web/src/App.css`（清理已废弃的样式）

- [ ] **Step 1: 清理 App.css 中已废弃的样式**

搜索并删除以下已废弃的样式块（如果还存在）：
- `.nav-tab` (旧 Tab 样式，已被 `.nav-tab-pill` 替代)
- `.nav-tab-badge` (已被 `.tab-badge` 替代)
- `.nav-tabs` (已被 `.nav-tabs-pill` 替代)
- `.searching-spinner` 如果有重复定义
- 任何包含 emoji 相关的样式

- [ ] **Step 2: 验证构建通过**

Run: `cd d:/music_box/web && npm.cmd run build`
Expected: 编译成功，无 TypeScript 错误，无 CSS 警告

- [ ] **Step 3: 启动 dev 服务器视觉验证**

Run: `cd d:/music_box/web && npm.cmd run dev`
打开浏览器 http://localhost:5173/ 验证：
- 品牌 Logo 浮动动画
- Tab 胶囊激活态主色填充
- 主题切换按钮 hover 旋转
- Action Row 三级按钮层次（点收藏激活看粉色，点歌词激活看主色填充）
- 底部曲目卡显示当前曲目
- 所有按钮 hover 上浮 + 光晕

- [ ] **Step 4: 提交**

```bash
cd d:/music_box
git add web/src/App.css
git commit -m "chore: 清理废弃样式"
```

---

## Self-Review

**1. Spec 覆盖检查：**
- ✅ 第 3 节决策表 9 项 → Task 1-7 全覆盖
- ✅ 第 4 节视觉规范（颜色/层次/图标/尺寸/动效）→ 在 Task 2-5 CSS 中体现
- ✅ 第 5.1 节导航栏 → Task 2
- ✅ 第 5.2 节搜索栏 → Task 3
- ✅ 第 5.3 节 Action Row → Task 4
- ✅ 第 5.4 节底部控制栏 → Task 5
- ✅ 第 6 节 SVG 图标库 → Task 1
- ✅ 第 7 节实现影响 → 全部对应
- ✅ 第 8 节验证标准 → Task 7 Step 3 视觉验证

**2. 占位符扫描：** 无 TBD/TODO/类似 Task N

**3. 类型一致性：**
- `IconProps` 接口在 Task 1 定义，所有图标组件使用一致
- `size` 默认值与 spec 第 4.4 节尺寸规范一致
- `fill` 参数在 `HeartIcon`、`MusicIcon`、`PlayIcon`、`PauseIcon`、`NoteIcon` 中使用
- Task 4 中 `fav ? 'currentColor' : 'none'` 与 `fav-active` 类名配合

**4. 实现风险：**
- Task 2 中 `isPlaying` 状态需要确保在 App.tsx 中已从 `useAudioPlayer` 解构（已存在）
- Task 5 中 `PLAY_MODE_LABEL` 和 `PLAY_MODE_ICON` 已从 `usePlaylist` 导入，但 `PLAY_MODE_ICON` 不再使用（被 SVG 替代），需保留 `PLAY_MODE_LABEL`
