# 音乐盒子综合增强实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在基础优化之上，为三端音乐播放器新增 4 个增强模块：搜索与曲库管理（深度）、音频可视化、主题切换、本地文件导入

**Architecture:** 4 个独立模块通过 `usePlaylist` 间接协作。搜索模块用 Python 微服务桥接爬虫，可视化用 Web Audio AnalyserNode，主题用 CSS 变量，本地导入用 URL.createObjectURL。

**Tech Stack:** React 18/Vite/TypeScript, Taro 3, Python http.server, Web Audio API, Canvas API

**Spec:** `docs/superpowers/specs/2026-07-04-music-box-enhancement-design.md`

---

## 文件结构总览

| 模块 | 新建文件 | 修改文件 |
|------|----------|----------|
| 搜索 | `tools/search_server.py`, `shared/useSearch.ts` | `web/src/App.tsx`, `web/src/App.css`, `mini-app/src/pages/index/index.tsx`, `run-web.bat` |
| 可视化 | `web/src/hooks/useVisualizer.ts`, `mini-app/src/hooks/useVisualizer.ts` | `web/src/App.tsx`, `web/src/App.css` |
| 主题 | `shared/theme-presets.ts`, `shared/useTheme.ts` | `web/src/App.tsx`, `web/src/styles/theme.css`, `mini-app/src/pages/index/index.tsx` |
| 本地导入 | `shared/useLocalImport.ts` | `web/src/App.tsx`, `mini-app/src/pages/index/index.tsx` |

---

## 模块 1：搜索与曲库管理

### Task 1: 创建搜索微服务 `tools/search_server.py`

**Files:**
- Create: `tools/search_server.py`

- [ ] **Step 1: 创建 `tools/search_server.py`**

```python
#!/usr/bin/env python3
"""音乐盒子搜索微服务 - 提供 HTTP API 供 Web/小程序调用爬虫搜索和入库。"""
import json
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# 确保能导入 music_crawler
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import music_crawler

TRACKS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'shared', 'tracks.json')
PORT = 7878


class SearchHandler(BaseHTTPRequestHandler):
    def _send_json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_cors(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_OPTIONS(self):
        self._send_cors()

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        if parsed.path == '/api/search':
            q = params.get('q', [''])[0]
            if not q:
                self._send_json(400, {'error': '缺少参数 q'})
                return
            results = music_crawler.search_all(q, limit=10)
            data = [
                {
                    'id': t.id,
                    'platform': t.platform,
                    'title': t.title,
                    'artist': t.artist,
                    'album': t.album,
                    'albumCover': t.albumCover,
                    'lyricContent': t.lyricContent,
                    'audioUrl': t.audioUrl,
                    'playable': t.playable,
                }
                for t in results
            ]
            self._send_json(200, {'results': data})
            return

        self._send_json(404, {'error': '未知端点'})

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == '/api/add':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            try:
                track = json.loads(body)
            except json.JSONDecodeError:
                self._send_json(400, {'error': '无效 JSON'})
                return

            # 读取现有 tracks
            if os.path.exists(TRACKS_FILE):
                with open(TRACKS_FILE, 'r', encoding='utf-8') as f:
                    tracks = json.load(f)
            else:
                tracks = []

            # 去重
            if any(t.get('id') == track.get('id') for t in tracks):
                self._send_json(200, {'message': '曲目已存在', 'skipped': True})
                return

            # 追加
            if 'coverColor' not in track:
                track['coverColor'] = '#17C3B2'
            if 'playable' not in track:
                track['playable'] = True
            tracks.append(track)

            with open(TRACKS_FILE, 'w', encoding='utf-8') as f:
                json.dump(tracks, f, ensure_ascii=False, indent=2)

            self._send_json(200, {'message': '添加成功', 'track': track})
            return

        self._send_json(404, {'error': '未知端点'})

    def log_message(self, format, *args):
        print(f'[SearchServer] {args[0]}')


def main():
    print(f'[SearchServer] 启动搜索微服务 http://localhost:{PORT}')
    server = HTTPServer(('127.0.0.1', PORT), SearchHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[SearchServer] 已停止')
        server.server_close()


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: 验证语法**

运行:
```powershell
python -m py_compile tools/search_server.py
```

预期: 无输出（语法正确）。

- [ ] **Step 3: 启动微服务并测试搜索**

运行:
```powershell
python tools/search_server.py
```

另开终端测试:
```powershell
curl "http://localhost:7878/api/search?q=晴天"
```

预期: 返回 JSON `{"results": [...]}`。

- [ ] **Step 4: 更新 `run-web.bat` 启动时拉起微服务**

将 `run-web.bat` 内容替换为：

```bat
@echo off
REM Music Box - Web Version Launcher
cd /d "%~dp0"

echo ============================================
echo   Music Box - Web (React + Vite)
echo ============================================
echo.

REM 启动搜索微服务（后台）
echo [Start] 启动搜索微服务 (端口 7878)...
start "MusicBox Search Server" /min python tools/search_server.py
timeout /t 1 /nobreak >nul

cd web

REM Check if node_modules exists
if not exist "node_modules" (
    echo [Init] First run, installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [Error] Dependency installation failed.
        pause
        exit /b 1
    )
    echo [Done] Dependencies installed successfully.
    echo.
)

echo [Start] Starting dev server...
echo [Info] After startup, open in browser: http://localhost:5173/
echo [Info] Search API: http://localhost:7878/api/search?q=关键词
echo.

call npm run dev

pause
```

---

### Task 2: 创建 `shared/useSearch.ts` 搜索 Hook

**Files:**
- Create: `shared/useSearch.ts`

- [ ] **Step 1: 创建 `shared/useSearch.ts`**

```typescript
// shared/useSearch.ts - 搜索与曲库管理 Hook（Web + 小程序共享）
import { useState, useCallback, useMemo, useEffect } from 'react';
import { Track } from './types';

const SEARCH_API = 'http://localhost:7878';

export function useSearch(playlist: Track[], onAddTrack: (track: Track) => void) {
  const [query, setQuery] = useState('');
  const [onlineResults, setOnlineResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOnline, setShowOnline] = useState(false);

  // 本地筛选：输入即过滤
  const filtered = useMemo(() => {
    if (!query.trim()) return playlist;
    const q = query.toLowerCase();
    return playlist.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q)
    );
  }, [playlist, query]);

  // 在线搜索
  const searchOnline = useCallback(async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setError(null);
    try {
      const resp = await fetch(`${SEARCH_API}/api/search?q=${encodeURIComponent(query)}`);
      if (!resp.ok) throw new Error('搜索服务响应异常');
      const data = await resp.json();
      setOnlineResults(data.results || []);
      setShowOnline(true);
    } catch (err) {
      setError('搜索服务未运行，仅支持本地筛选');
      setShowOnline(false);
    } finally {
      setIsSearching(false);
    }
  }, [query]);

  // 加入曲库
  const addTrack = useCallback(async (track: Track) => {
    try {
      const resp = await fetch(`${SEARCH_API}/api/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(track),
      });
      if (!resp.ok) throw new Error('加入失败');
      const data = await resp.json();
      if (!data.skipped) {
        onAddTrack(track);
      }
    } catch (err) {
      setError('加入失败，请检查搜索服务是否运行');
    }
  }, [onAddTrack]);

  const closeOnline = useCallback(() => setShowOnline(false), []);

  return {
    query,
    setQuery,
    filtered,
    onlineResults,
    isSearching,
    searchOnline,
    addTrack,
    error,
    showOnline,
    closeOnline,
  };
}
```

- [ ] **Step 2: 验证 TypeScript 语法**

运行:
```powershell
cd web; npx tsc --noEmit ../../shared/useSearch.ts --strict --moduleResolution node --esModuleInterop
```

预期: 无错误（或仅有 `--strict` 相关的类型提示，不影响使用）。

---

### Task 3: Web 端搜索栏 UI

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.css`

- [ ] **Step 1: 在 `App.tsx` 导入 useSearch 并初始化**

在 `web/src/App.tsx` 顶部导入区（第 5 行后）添加：

```typescript
import { useSearch } from '../../shared/useSearch';
```

在 `usePlaylist()` 解构后（第 31 行后）添加：

```typescript
  const [extraTracks, setExtraTracks] = useState<Track[]>([]);
  const allPlaylist = [...playlist, ...extraTracks];
  const search = useSearch(allPlaylist, (track) => {
    setExtraTracks(prev => [...prev, track]);
  });
```

注意：将 `usePlaylist` 返回的 `playlist` 替换为 `allPlaylist` 用于搜索和显示。

- [ ] **Step 2: 在导航栏下方添加搜索栏**

在 `web/src/App.tsx` 的 `<nav>` 标签之后、`<main>` 标签之前添加：

```tsx
        {/* 搜索栏 */}
        <div className="search-bar">
          <input
            type="text"
            className="search-input"
            placeholder="搜索歌名/歌手..."
            value={search.query}
            onChange={(e) => search.setQuery(e.target.value)}
          />
          <button
            className="search-btn"
            onClick={search.searchOnline}
            disabled={search.isSearching}
          >
            {search.isSearching ? '⏳' : '🔍 在线搜词'}
          </button>
        </div>
        {search.error && <div className="search-error">{search.error}</div>}

        {/* 在线搜索结果浮层 */}
        {search.showOnline && (
          <div className="search-overlay">
            <div className="search-overlay-header">
              <span>在线搜索结果 ({search.onlineResults.length})</span>
              <button onClick={search.closeOnline}>×</button>
            </div>
            <ul className="search-results">
              {search.onlineResults.map(t => (
                <li key={t.id} className="search-result-item">
                  <div className="search-result-info">
                    <span className="search-result-title">{t.title}</span>
                    <span className="search-result-artist">{t.artist}</span>
                  </div>
                  <button onClick={() => search.addTrack(t)}>加入曲库</button>
                </li>
              ))}
              {search.onlineResults.length === 0 && (
                <li className="search-empty">未找到相关曲目</li>
              )}
            </ul>
          </div>
        )}
```

- [ ] **Step 3: 播放列表使用筛选后的结果**

将播放列表抽屉中的 `{playlist.map((t, i) => (` 改为 `{search.filtered.map((t, i) => (`。

将收藏和最近播放列表中的曲目来源也改为 `allPlaylist`（用于 find 查找）。

- [ ] **Step 4: 在 `App.css` 添加搜索栏样式**

```css
/* 搜索栏 */
.search-bar {
  display: flex;
  gap: 8px;
  padding: 8px 16px;
  background: var(--color-surface);
}

.search-input {
  flex: 1;
  padding: 8px 12px;
  background: var(--color-background);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  color: var(--color-text-primary);
  font-size: 14px;
  outline: none;
}

.search-input:focus {
  border-color: var(--color-primary);
}

.search-btn {
  padding: 8px 16px;
  background: var(--color-primary);
  border: none;
  border-radius: 8px;
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  white-space: nowrap;
}

.search-btn:disabled {
  opacity: 0.5;
}

.search-error {
  padding: 4px 16px;
  color: #ef4444;
  font-size: 12px;
  background: rgba(239,68,68,0.1);
}

/* 在线搜索浮层 */
.search-overlay {
  position: fixed;
  top: 100px;
  left: 50%;
  transform: translateX(-50%);
  width: 90%;
  max-width: 500px;
  max-height: 400px;
  background: var(--color-surface);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  z-index: 100;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.search-overlay-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
  color: var(--color-text-primary);
}

.search-overlay-header button {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: 20px;
  cursor: pointer;
}

.search-results {
  list-style: none;
  overflow-y: auto;
  flex: 1;
}

.search-result-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.search-result-info {
  display: flex;
  flex-direction: column;
}

.search-result-title {
  color: var(--color-text-primary);
  font-size: 14px;
}

.search-result-artist {
  color: var(--color-text-secondary);
  font-size: 12px;
}

.search-result-item button {
  padding: 4px 12px;
  background: var(--color-primary);
  border: none;
  border-radius: 6px;
  color: #fff;
  cursor: pointer;
  font-size: 12px;
}

.search-empty {
  padding: 24px;
  text-align: center;
  color: var(--color-text-secondary);
}
```

- [ ] **Step 5: 验证 Web 构建**

运行:
```powershell
cd web; npm run build
```

预期: 构建成功。

---

## 模块 2：音频可视化

### Task 4: Web 端音频可视化 Hook + Canvas

**Files:**
- Create: `web/src/hooks/useVisualizer.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.css`

- [ ] **Step 1: 创建 `web/src/hooks/useVisualizer.ts`**

```typescript
// web/src/hooks/useVisualizer.ts - 音频频谱可视化（Web Audio API）
import { useRef, useState, useCallback, useEffect } from 'react';

export function useVisualizer(audioElement: HTMLAudioElement | null, color: string) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isActive, setIsActive] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const draw = useCallback(() => {
    if (!analyserRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const barCount = 24;
    const barWidth = canvas.width / barCount;
    const gap = 2;

    for (let i = 0; i < barCount; i++) {
      const value = dataArray[i] || 0;
      const barHeight = (value / 255) * canvas.height;
      const x = i * barWidth;
      ctx.fillStyle = color;
      ctx.fillRect(x + gap / 2, canvas.height - barHeight, barWidth - gap, barHeight);
    }

    rafRef.current = requestAnimationFrame(draw);
  }, [color]);

  const start = useCallback(() => {
    if (!audioElement) return;
    if (!audioContextRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioCtx();
      sourceRef.current = audioContextRef.current.createMediaElementSource(audioElement);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 64;
      sourceRef.current.connect(analyserRef.current);
      analyserRef.current.connect(audioContextRef.current.destination);
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    rafRef.current = requestAnimationFrame(draw);
  }, [audioElement, draw]);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const toggle = useCallback(() => {
    setIsActive(prev => {
      if (prev) {
        stop();
        return false;
      } else {
        start();
        return true;
      }
    });
  }, [start, stop]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      stop();
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, [stop]);

  // 音频元素变化时重新连接
  useEffect(() => {
    if (isActive && audioElement) {
      start();
    }
  }, [audioElement, isActive, start]);

  return { canvasRef, isActive, toggle };
}
```

- [ ] **Step 2: 在 `App.tsx` 添加频谱 Canvas 和开关按钮**

在 `web/src/App.tsx` 导入区添加：

```typescript
import { useVisualizer } from '@/hooks/useVisualizer';
```

在 `App` 组件内，在 `useSearch` 之后添加（需要从 `useAudioPlayer` 获取 audio 元素引用）：

```typescript
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const visualizer = useVisualizer(audioElRef.current, currentTrack?.coverColor || '#17C3B2');
```

注意：需要修改 `useAudioPlayer` 暴露内部的 `audio` 元素引用。在 `useAudioPlayer.ts` 的 return 中添加 `audioElRef`。

在封面区域下方添加 Canvas：

```tsx
            {visualizer.isActive && (
              <canvas
                ref={visualizer.canvasRef}
                className="visualizer-canvas"
                width={200}
                height={60}
              />
            )}
```

在 `action-row` 中添加可视化开关按钮：

```tsx
                <button className="icon-btn" onClick={visualizer.toggle} title="频谱">
                  <span style={{ color: visualizer.isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>📊</span>
                </button>
```

- [ ] **Step 3: 修改 `useAudioPlayer.ts` 暴露 audio 元素引用**

在 `web/src/hooks/useAudioPlayer.ts` 的 return 语句前添加：

```typescript
  const getAudioElement = useCallback(() => audioRef.current, []);
```

在 return 中添加 `getAudioElement`：

```typescript
  return { isPlaying, position, duration, play, pause, resume, seek, stop,
           volume, setVolume, muted, toggleMute, isLoading, error, clearError,
           getAudioElement };
```

- [ ] **Step 4: 在 `App.css` 添加频谱样式**

```css
/* 频谱可视化 */
.visualizer-canvas {
  display: block;
  margin: 8px auto;
  border-radius: 8px;
  background: rgba(0,0,0,0.2);
}
```

- [ ] **Step 5: 验证 Web 构建**

运行:
```powershell
cd web; npm run build
```

---

### Task 5: 小程序端静态波形组件

**Files:**
- Create: `mini-app/src/hooks/useVisualizer.ts`

- [ ] **Step 1: 创建 `mini-app/src/hooks/useVisualizer.ts`（静态波形）**

```typescript
// mini-app/src/hooks/useVisualizer.ts - 静态波形占位（小程序无 AudioContext）
import { useState, useCallback } from 'react';

export function useVisualizer() {
  const [isActive, setIsActive] = useState(false);
  const toggle = useCallback(() => setIsActive(prev => !prev), []);
  return { isActive, toggle };
}
```

- [ ] **Step 2: 在小程序播放页添加波形动画**

在 `mini-app/src/pages/index/index.tsx` 封面区域添加条件渲染：

```tsx
{visualizer.isActive && (
  <View className="wave-bar-container">
    <View className="wave-bar wave-bar-1" />
    <View className="wave-bar wave-bar-2" />
    <View className="wave-bar wave-bar-3" />
  </View>
)}
```

在 `index.module.scss` 添加：

```scss
.wave-bar-container {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 4px;
  height: 60px;
  margin: 8px 0;
}

.wave-bar {
  width: 6px;
  background: $color-primary;
  border-radius: 3px;
  animation: wave 0.8s ease-in-out infinite alternate;
}

.wave-bar-1 { animation-delay: 0s; height: 30px; }
.wave-bar-2 { animation-delay: 0.2s; height: 45px; }
.wave-bar-3 { animation-delay: 0.4s; height: 20px; }

@keyframes wave {
  0% { transform: scaleY(0.3); }
  100% { transform: scaleY(1); }
}
```

---

## 模块 3：主题与个性化

### Task 6: 创建主题预设和 useTheme Hook

**Files:**
- Create: `shared/theme-presets.ts`
- Create: `shared/useTheme.ts`

- [ ] **Step 1: 创建 `shared/theme-presets.ts`**

```typescript
// shared/theme-presets.ts - 主题色预设定义
export type ThemeMode = 'dark' | 'light';
export type Preset = 'ocean' | 'sunset' | 'forest';

export interface ThemeColors {
  primary: string;
  surface: string;
  background: string;
  textPrimary: string;
  textSecondary: string;
}

export const PRESETS: Record<Preset, { dark: ThemeColors; light: ThemeColors }> = {
  ocean: {
    dark: {
      primary: '#17C3B2',
      surface: '#1A1F2E',
      background: '#0F1419',
      textPrimary: '#FFFFFF',
      textSecondary: 'rgba(255,255,255,0.6)',
    },
    light: {
      primary: '#17C3B2',
      surface: '#F0F4F8',
      background: '#FFFFFF',
      textPrimary: '#0F1419',
      textSecondary: 'rgba(15,20,25,0.6)',
    },
  },
  sunset: {
    dark: {
      primary: '#F76E11',
      surface: '#2D1B1B',
      background: '#1A1010',
      textPrimary: '#FFFFFF',
      textSecondary: 'rgba(255,255,255,0.6)',
    },
    light: {
      primary: '#F76E11',
      surface: '#FFF5F0',
      background: '#FFFFFF',
      textPrimary: '#1A1010',
      textSecondary: 'rgba(26,16,16,0.6)',
    },
  },
  forest: {
    dark: {
      primary: '#52796F',
      surface: '#1F2D28',
      background: '#0F1A14',
      textPrimary: '#FFFFFF',
      textSecondary: 'rgba(255,255,255,0.6)',
    },
    light: {
      primary: '#52796F',
      surface: '#F0F5F2',
      background: '#FFFFFF',
      textPrimary: '#0F1A14',
      textSecondary: 'rgba(15,26,20,0.6)',
    },
  },
};

export const PRESET_LABELS: Record<Preset, string> = {
  ocean: '海洋',
  sunset: '日落',
  forest: '森林',
};
```

- [ ] **Step 2: 创建 `shared/useTheme.ts`**

```typescript
// shared/useTheme.ts - 主题切换 Hook（Web + 小程序共享）
import { useState, useCallback, useEffect } from 'react';
import { ThemeMode, Preset, PRESETS } from './theme-presets';

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
  } catch {
    // 存储失败时静默处理
  }
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => loadFromStorage(STORAGE_KEY_MODE, 'dark'));
  const [preset, setPresetState] = useState<Preset>(() => loadFromStorage(STORAGE_KEY_PRESET, 'ocean'));

  const colors = PRESETS[preset][mode];

  // 应用 CSS 变量到 document root
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--color-primary', colors.primary);
    root.style.setProperty('--color-surface', colors.surface);
    root.style.setProperty('--color-background', colors.background);
    root.style.setProperty('--color-text-primary', colors.textPrimary);
    root.style.setProperty('--color-text-secondary', colors.textSecondary);
    root.setAttribute('data-theme', mode);
  }, [colors]);

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
```

- [ ] **Step 3: 验证 TypeScript 语法**

运行:
```powershell
cd web; npx tsc --noEmit ../../shared/theme-presets.ts ../../shared/useTheme.ts --strict --moduleResolution node --esModuleInterop
```

---

### Task 7: Web 端主题切换 UI

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.css`

- [ ] **Step 1: 在 `App.tsx` 导入并使用 useTheme**

添加导入：

```typescript
import { useTheme } from '../../shared/useTheme';
import { PRESET_LABELS } from '../../shared/theme-presets';
```

在组件内初始化：

```typescript
  const theme = useTheme();
  const [showThemeMenu, setShowThemeMenu] = useState(false);
```

- [ ] **Step 2: 在导航栏添加主题切换按钮**

在 `<nav className="nav">` 的 `nav-brand` 之后添加：

```tsx
        <button className="nav-theme-btn" onClick={() => setShowThemeMenu(v => !v)} title="主题">
          {theme.mode === 'dark' ? '🌙' : '☀️'}
        </button>
        {showThemeMenu && (
          <div className="theme-menu">
            <button onClick={theme.toggleMode}>
              {theme.mode === 'dark' ? '☀️ 亮色' : '🌙 深色'}
            </button>
            <div className="theme-presets">
              {(Object.keys(PRESET_LABELS) as Array<keyof typeof PRESET_LABELS>).map(p => (
                <button
                  key={p}
                  className={theme.preset === p ? 'active' : ''}
                  onClick={() => theme.setPreset(p)}
                >
                  {PRESET_LABELS[p]}
                </button>
              ))}
            </div>
          </div>
        )}
```

- [ ] **Step 3: 在 `App.css` 添加主题菜单样式**

```css
/* 主题切换 */
.nav-theme-btn {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
}

.nav-theme-btn:hover {
  background: rgba(255,255,255,0.1);
}

.theme-menu {
  position: absolute;
  top: 56px;
  right: 16px;
  background: var(--color-surface);
  border-radius: 12px;
  padding: 12px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.theme-menu button {
  padding: 8px 16px;
  background: none;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  color: var(--color-text-primary);
  cursor: pointer;
  font-size: 14px;
}

.theme-menu button.active {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}

.theme-presets {
  display: flex;
  gap: 4px;
}

.theme-presets button {
  flex: 1;
  padding: 4px 8px;
  font-size: 12px;
}
```

- [ ] **Step 4: 验证 Web 构建**

运行:
```powershell
cd web; npm run build
```

---

### Task 7b: 小程序端主题切换

**Files:**
- Create: `mini-app/src/hooks/useTheme.ts`

- [ ] **Step 1: 创建 `mini-app/src/hooks/useTheme.ts`（用 Taro Storage 持久化）**

```typescript
// mini-app/src/hooks/useTheme.ts - 主题切换 Hook（小程序版，用 Taro Storage）
import { useState, useCallback, useEffect } from 'react';
import Taro from '@tarojs/taro';
import { ThemeMode, Preset, PRESETS } from '../../shared/theme-presets';

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
      return v || 'ocean';
    } catch {
      return 'ocean';
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
```

- [ ] **Step 2: 在小程序播放页添加主题切换按钮**

在 `mini-app/src/pages/index/index.tsx` 导入并初始化 `useTheme`，在导航栏添加深/亮切换按钮 + 预设选择。具体实现参考 Web 端 Task 7 Step 2，将 `<button>` 替换为 Taro `<Button>`，CSS 变量通过根 View 的 inline style 或 className 切换。

- [ ] **Step 3: 验证小程序构建**

运行:
```powershell
cd mini-app; npm run build:h5
```

---

## 模块 4：本地文件导入

### Task 8: Web 端本地文件导入

**Files:**
- Create: `shared/useLocalImport.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.css`

- [ ] **Step 1: 创建 `shared/useLocalImport.ts`**

```typescript
// shared/useLocalImport.ts - 本地文件导入 Hook（Web 版本）
import { useState, useCallback, useRef } from 'react';
import { Track } from './types';

const IMPORT_COLORS = ['#17C3B2', '#8B5CF6', '#F59E0B', '#E76F51', '#2A9D8F', '#F4A261'];

export function useLocalImport(onImport: (track: Track) => void) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const importFiles = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.click();
    }
  }, []);

  const handleFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files).filter(f =>
      f.type.startsWith('audio/') || f.name.match(/\.(mp3|wav|ogg|flac|m4a)$/i)
    );

    fileArray.forEach((file, idx) => {
      const url = URL.createObjectURL(file);
      const name = file.name.replace(/\.[^.]+$/, '');
      const track: Track = {
        id: `local:${Date.now()}:${idx}`,
        title: name,
        artist: '本地文件',
        audioUrl: url,
        lyricContent: '[00:00.00]♪ 本地文件',
        coverColor: IMPORT_COLORS[Math.floor(Math.random() * IMPORT_COLORS.length)],
      };
      onImport(track);
    });
  }, [onImport]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  return {
    inputRef,
    dragOver,
    importFiles,
    handleFiles,
    onDrop,
    onDragOver,
    onDragLeave,
  };
}
```

- [ ] **Step 2: 在 `App.tsx` 添加导入按钮和拖拽区域**

添加导入：

```typescript
import { useLocalImport } from '../../shared/useLocalImport';
```

在组件内初始化：

```typescript
  const localImport = useLocalImport((track) => {
    setExtraTracks(prev => [...prev, track]);
  });
```

在搜索栏中添加导入按钮：

```tsx
        <div className="search-bar">
          <input
            type="text"
            className="search-input"
            placeholder="搜索歌名/歌手..."
            value={search.query}
            onChange={(e) => search.setQuery(e.target.value)}
          />
          <button className="search-btn" onClick={search.searchOnline} disabled={search.isSearching}>
            {search.isSearching ? '⏳' : '🔍 在线搜词'}
          </button>
          <button className="import-btn" onClick={localImport.importFiles} title="导入本地音频">
            📁 导入
          </button>
          <input
            ref={localImport.inputRef}
            type="file"
            accept="audio/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files) localImport.handleFiles(e.target.files); }}
          />
        </div>
```

在 `<div className="app">` 上添加拖拽事件：

```tsx
    <div
      className={`app${localImport.dragOver ? ' drag-over' : ''}`}
      onDrop={localImport.onDrop}
      onDragOver={localImport.onDragOver}
      onDragLeave={localImport.onDragLeave}
    >
```

- [ ] **Step 3: 在 `App.css` 添加导入按钮和拖拽样式**

```css
/* 本地导入 */
.import-btn {
  padding: 8px 16px;
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 8px;
  color: var(--color-text-primary);
  cursor: pointer;
  font-size: 14px;
  white-space: nowrap;
}

.app.drag-over {
  outline: 2px dashed var(--color-primary);
  outline-offset: -8px;
}
```

- [ ] **Step 4: 验证 Web 构建**

运行:
```powershell
cd web; npm run build
```

---

### Task 9: 小程序端本地文件导入

**Files:**
- Modify: `mini-app/src/pages/index/index.tsx`

- [ ] **Step 1: 在小程序播放页添加本地导入**

在 `mini-app/src/pages/index/index.tsx` 顶部导入：

```typescript
import Taro from '@tarojs/taro';
```

在组件内添加导入函数：

```typescript
  const importLocalFiles = useCallback(() => {
    Taro.chooseMessageFile({
      count: 9,
      type: 'file',
      extension: ['mp3', 'wav', 'm4a'],
      success: (res) => {
        const newTracks: Track[] = res.tempFiles.map((file, idx) => ({
          id: `local:${Date.now()}:${idx}`,
          title: file.name.replace(/\.[^.]+$/, ''),
          artist: '本地文件',
          audioUrl: file.path,
          lyricContent: '[00:00.00]♪ 本地文件',
          coverColor: '#17C3B2',
        }));
        setExtraTracks(prev => [...prev, ...newTracks]);
        Taro.showToast({ title: `已导入 ${newTracks.length} 首`, icon: 'success' });
      },
      fail: () => {
        Taro.showToast({ title: '取消导入', icon: 'none' });
      },
    });
  }, []);
```

在搜索栏区域添加导入按钮：

```tsx
<Button className="import-btn" onClick={importLocalFiles}>📁 导入</Button>
```

- [ ] **Step 2: 验证小程序构建**

运行:
```powershell
cd mini-app; npm run build:h5
```

---

## 验收检查清单

- [ ] `tools/search_server.py` 语法正确，启动后 `/api/search?q=晴天` 返回 JSON
- [ ] `shared/useSearch.ts` 本地筛选 + 在线搜索 + 加入曲库功能正常
- [ ] `shared/theme-presets.ts` + `shared/useTheme.ts` 3 套预设 + 深/亮切换正常
- [ ] `shared/useLocalImport.ts` 拖拽 + 按钮导入本地 mp3 正常
- [ ] `web/src/hooks/useVisualizer.ts` AnalyserNode 连接 + Canvas 绘制频谱正常
- [ ] Web `npm run build` 通过
- [ ] 小程序 `npm run build:h5` 通过
- [ ] Python `python -m py_compile tools/search_server.py` 通过
- [ ] IDE 诊断无错误
- [ ] Web 端搜索栏可见，输入关键词实时筛选
- [ ] Web 端主题切换后颜色立即生效
- [ ] Web 端频谱开关可切换，暂停时停止动画
- [ ] Web 端拖拽 mp3 文件到页面后自动加入曲库
