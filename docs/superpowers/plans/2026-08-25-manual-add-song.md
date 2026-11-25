# 手动添加歌曲 + 内容库扩充 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现手动添加歌曲（自动搜/手动 URL）+ 批量爬热榜 + 批量刷新 URL，并在前端主界面工具栏提供入口。

**Architecture:** 后端新增 `addManualSong` 服务方法与 `POST /api/songs/add`、`POST /api/songs/refresh-hot100` 端点（复用 `checkAudioUrlPlayable`、`search_song_url.py`、`refreshHot100`、`batchCheckAndRefresh`）；前端新增 `AddSongPanel` 组件 + API 封装 + 工具栏按钮。

**Tech Stack:** Node 18 + TypeScript + Express + Prisma（后端），React 18 + Vite（前端）。

---

## 文件结构

**后端新建/修改：**
- 修改 `server/src/modules/songs/songs.service.ts` — 新增 `addManualSong` 方法
- 修改 `server/src/modules/songs/songs.controller.ts` — 新增 `addManualSong` / `refreshHot100` 端点
- 修改 `server/src/modules/songs/songs.routes.ts` — 注册新路由
- 新建 `server/tests/songs-add-manual.test.ts` — 单测

**前端新建/修改：**
- 新建 `web/src/components/AddSongPanel.tsx` — 添加歌曲面板
- 新建 `web/src/components/AddSongPanel.css` — 面板样式
- 修改 `web/src/services/api.ts` — 新增 3 个 API 方法
- 修改 `web/src/App.tsx` — 工具栏按钮 + 面板开关

---

## Task 1: 后端 `addManualSong` 服务方法

**Files:**
- Modify: `server/src/modules/songs/songs.service.ts`
- Test: `server/tests/songs-add-manual.test.ts`

- [ ] **Step 1: 编写失败测试**

创建 `server/tests/songs-add-manual.test.ts`：

```typescript
import { SongsService } from '../src/modules/songs/songs.service';

// mock 依赖
jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    song: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));
jest.mock('../src/lib/python-runner', () => ({
  runPython: jest.fn(),
}));

const prisma = require('../src/lib/prisma').default;
const { runPython } = require('../src/lib/python-runner');

describe('SongsService.addManualSong', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('自动搜索成功时创建歌曲', async () => {
    prisma.song.findFirst.mockResolvedValue(null); // 无重复
    runPython.mockResolvedValue({
      stdout: JSON.stringify({ success: true, url: 'https://example.com/a.mp3', songId: '1', title: '测试', artist: '歌手' }),
      stderr: '',
    });
    prisma.song.create.mockImplementation(async ({ data }: any) => ({ id: data.id, ...data }));

    const svc = new SongsService();
    const song = await svc.addManualSong('测试', '歌手', undefined, 1);

    expect(song.title).toBe('测试');
    expect(song.audioUrl).toBe('https://example.com/a.mp3');
    expect(prisma.song.create).toHaveBeenCalled();
  });

  it('自动搜索失败时抛出错误', async () => {
    prisma.song.findFirst.mockResolvedValue(null);
    runPython.mockResolvedValue({ stdout: JSON.stringify({ success: false, error: '无结果' }), stderr: '' });

    const svc = new SongsService();
    await expect(svc.addManualSong('不存在', '歌手', undefined, 1)).rejects.toThrow();
  });

  it('歌曲已存在时返回已有歌曲（不重复创建）', async () => {
    const existing = { id: 'manual:old', title: '测试', artist: '歌手', audioUrl: 'https://old' };
    prisma.song.findFirst.mockResolvedValue(existing);

    const svc = new SongsService();
    const song = await svc.addManualSong('测试', '歌手', undefined, 1);

    expect(song.id).toBe('manual:old');
    expect(prisma.song.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && npx jest tests/songs-add-manual.test.ts --forceExit`
Expected: FAIL（`addManualSong` 方法不存在）

- [ ] **Step 3: 实现 `addManualSong`**

在 `server/src/modules/songs/songs.service.ts` 顶部（现有 import 之后）新增 import：

```typescript
import crypto from 'crypto';
import path from 'path';
import { runPython } from '../../lib/python-runner';
```

在 `SongsService` 类内（`createSong` 方法之前）新增 `addManualSong` 方法：

```typescript
  /**
   * 手动添加歌曲：按「歌名+歌手」自动搜索可播放 URL，或使用手动指定的 URL。
   * 复用 checkAudioUrlPlayable 验证 URL、search_song_url.py 自动搜索。
   */
  async addManualSong(title: string, artist: string = '', audioUrl?: string, userId?: number) {
    // 1. 去重：按 title + artist（忽略大小写）查找已存在歌曲
    const existing = await prisma.song.findFirst({
      where: {
        title: { equals: title, mode: 'insensitive' },
        ...(artist ? { artist: { equals: artist, mode: 'insensitive' } } : {}),
        archived: false,
      },
    });
    if (existing) {
      return existing;
    }

    // 2. 获取 URL
    let finalUrl: string;
    let platform = 'manual';
    if (audioUrl) {
      // 手动指定 URL：验证可播放
      const valid = await checkAudioUrlPlayable(audioUrl);
      if (!valid) {
        throw new Error('音频URL不可播放，请检查链接');
      }
      finalUrl = audioUrl;
    } else {
      // 自动搜索：按歌名+歌手在网易云搜索
      const scriptPath = path.resolve(process.cwd(), '..', 'tools', 'search_song_url.py');
      const { stdout } = await runPython([scriptPath, title, artist], { timeout: 30000 });
      let result: any;
      try {
        result = JSON.parse(stdout);
      } catch {
        throw new Error('搜索脚本返回异常');
      }
      if (!result.success || !result.url) {
        throw new Error(result.error || '未找到可播放版本');
      }
      finalUrl = result.url;
      platform = 'netease';
    }

    // 3. 创建歌曲（自动生成唯一 ID）
    const id = `manual:${crypto.randomUUID()}`;
    const song = await this.createSong({
      id,
      title,
      artist: artist || '未知歌手',
      audioUrl: finalUrl,
      platform,
      dataSource: 'manual',
      sourceUrl: finalUrl,
    } as any, userId);

    return song;
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && npx jest tests/songs-add-manual.test.ts --forceExit`
Expected: PASS（3 用例通过）

---

## Task 2: 控制器 + 路由

**Files:**
- Modify: `server/src/modules/songs/songs.controller.ts`
- Modify: `server/src/modules/songs/songs.routes.ts`

- [ ] **Step 1: 控制器新增两个方法**

在 `server/src/modules/songs/songs.controller.ts` 顶部新增 import：

```typescript
import { refreshHot100 } from '../playlists/hot100.service';
```

在 `SongsController` 类内（`createSong` 方法之后）新增：

```typescript
  /** 手动添加歌曲：自动搜或手动 URL */
  async addManualSong(req: AuthRequest, res: AuthResponse) {
    try {
      const { title, artist, audioUrl } = req.body || {};
      if (!title || !title.trim()) {
        return res.status(400).json({ success: false, error: '请提供歌曲标题' });
      }
      const userId = req.user?.id;
      const song = await songsService.addManualSong(
        title.trim(),
        (artist || '').trim(),
        audioUrl || undefined,
        userId,
      );
      return res.status(201).json({ success: true, data: song });
    } catch (error: any) {
      return res.status(400).json({ success: false, error: error?.message || '添加失败' });
    }
  }

  /** 手动触发热榜爬取（异步，立即返回） */
  async refreshHot100(_req: AuthRequest, res: AuthResponse) {
    try {
      // 异步触发，不阻塞响应
      res.json({ success: true, message: '热榜爬取任务已启动' });
      refreshHot100()
        .then((r) => console.log(`[SONGS] 热榜爬取完成: ${r.count} 首`))
        .catch((e) => console.error('[SONGS] 热榜爬取失败:', e?.message || e));
    } catch (error: any) {
      res.status(500).json({ success: false, error: error?.message || '操作失败' });
    }
  }
```

- [ ] **Step 2: 路由注册**

在 `server/src/modules/songs/songs.routes.ts` 中，在 `/refresh-track` 路由之前新增（必须在 `/:id` 之前注册，避免被 `/:id` 捕获）：

```typescript
// 手动添加歌曲（自动搜或手动 URL，任何登录用户可用）
router.post('/add', authenticate, (req, res) => songsController.addManualSong(req, res));

// 手动触发热榜爬取（异步）
router.post('/refresh-hot100', authenticate, (req, res) => songsController.refreshHot100(req, res));
```

- [ ] **Step 3: 类型检查**

Run: `cd server && npx tsc --noEmit`
Expected: 无 songs.service.ts / songs.controller.ts / songs.routes.ts 相关错误

---

## Task 3: 前端 API 封装

**Files:**
- Modify: `web/src/services/api.ts`

- [ ] **Step 1: 新增 API 方法**

在 `web/src/services/api.ts` 末尾新增：

```typescript
/** 手动添加歌曲返回的歌曲数据 */
export interface AddManualSongResult {
  id: string;
  title: string;
  artist: string;
  audioUrl: string;
  playable?: boolean;
}

/** 歌曲管理（手动添加 + 批量操作） */
export const songsAdminApi = {
  /** 手动添加歌曲：自动搜（省略 audioUrl）或手动指定 URL */
  addManualSong: (payload: { title: string; artist?: string; audioUrl?: string }) =>
    request<AddManualSongResult>('/songs/add', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  /** 手动触发热榜爬取 */
  refreshHot100: () =>
    request<{ message: string }>('/songs/refresh-hot100', { method: 'POST' }),
  /** 批量刷新失效 URL（复用 url-manager 已有接口） */
  refreshBatchUrls: () =>
    request<{ result: unknown }>('/url-manager/refresh-batch', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
```

- [ ] **Step 2: 类型检查**

Run: `cd web && npx tsc --noEmit`
Expected: 无 api.ts 相关错误

---

## Task 4: AddSongPanel 组件

**Files:**
- Create: `web/src/components/AddSongPanel.tsx`
- Create: `web/src/components/AddSongPanel.css`

- [ ] **Step 1: 编写组件**

创建 `web/src/components/AddSongPanel.tsx`：

```tsx
/**
 * AddSongPanel - 手动添加歌曲面板
 * 支持：歌名+歌手自动搜 / 手动指定 URL，以及批量刷新、爬热榜入口。
 */
import { useState } from 'react';
import { songsAdminApi, AddManualSongResult } from '../services/api';
import './AddSongPanel.css';

interface AddSongPanelProps {
  onClose: () => void;
  onAdded?: (song: AddManualSongResult) => void;
}

export default function AddSongPanel({ onClose, onAdded }: AddSongPanelProps) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [manualUrl, setManualUrl] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [batchBusy, setBatchBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleAdd = async () => {
    if (!title.trim()) {
      setMsg({ type: 'error', text: '请填写歌名' });
      return;
    }
    setSubmitting(true);
    setMsg(null);
    try {
      const song = await songsAdminApi.addManualSong({
        title: title.trim(),
        artist: artist.trim() || undefined,
        audioUrl: manualUrl ? audioUrl.trim() || undefined : undefined,
      });
      setMsg({ type: 'success', text: `已添加：${song.title} - ${song.artist}` });
      setTitle('');
      setArtist('');
      setAudioUrl('');
      onAdded?.(song);
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message || '添加失败' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefreshBatch = async () => {
    setBatchBusy('refresh');
    setMsg(null);
    try {
      await songsAdminApi.refreshBatchUrls();
      setMsg({ type: 'success', text: '批量刷新任务已启动' });
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message || '操作失败' });
    } finally {
      setBatchBusy(null);
    }
  };

  const handleRefreshHot100 = async () => {
    setBatchBusy('hot100');
    setMsg(null);
    try {
      await songsAdminApi.refreshHot100();
      setMsg({ type: 'success', text: '热榜爬取任务已启动' });
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message || '操作失败' });
    } finally {
      setBatchBusy(null);
    }
  };

  return (
    <div className="add-song-overlay" onClick={onClose}>
      <div className="add-song-panel" onClick={(e) => e.stopPropagation()}>
        <div className="add-song-header">
          <span>添加歌曲</span>
          <button className="add-song-close" onClick={onClose} title="关闭">✕</button>
        </div>

        <div className="add-song-body">
          <div className="add-song-field">
            <label>歌名（必填）</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：晴天" />
          </div>

          <div className="add-song-field">
            <label>歌手（选填）</label>
            <input type="text" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="如：周杰伦" />
          </div>

          <label className="add-song-check">
            <input type="checkbox" checked={manualUrl} onChange={(e) => setManualUrl(e.target.checked)} />
            手动指定音频 URL（不勾选则自动搜索）
          </label>

          {manualUrl && (
            <div className="add-song-field">
              <label>音频 URL</label>
              <input type="text" value={audioUrl} onChange={(e) => setAudioUrl(e.target.value)} placeholder="https://..." />
            </div>
          )}

          {msg && <div className={`add-song-msg add-song-msg-${msg.type}`}>{msg.text}</div>}

          <button className="add-song-submit" onClick={handleAdd} disabled={submitting}>
            {submitting ? '添加中…' : '添加歌曲'}
          </button>

          <div className="add-song-divider" />

          <div className="add-song-batch">
            <button className="add-song-batch-btn" onClick={handleRefreshBatch} disabled={batchBusy !== null}>
              {batchBusy === 'refresh' ? '启动中…' : '刷新失效 URL'}
            </button>
            <button className="add-song-batch-btn" onClick={handleRefreshHot100} disabled={batchBusy !== null}>
              {batchBusy === 'hot100' ? '启动中…' : '爬取热榜新歌'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 编写样式**

创建 `web/src/components/AddSongPanel.css`：

```css
.add-song-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.add-song-panel {
  width: 360px;
  max-width: 90vw;
  background: #1f1f2e;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
.add-song-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-weight: 600;
}
.add-song-close {
  background: none;
  border: none;
  color: #aaa;
  cursor: pointer;
  font-size: 14px;
}
.add-song-body { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.add-song-field { display: flex; flex-direction: column; gap: 6px; }
.add-song-field label { font-size: 12px; color: #aaa; }
.add-song-field input {
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  outline: none;
}
.add-song-check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #ccc; cursor: pointer; }
.add-song-msg { font-size: 12px; padding: 8px 10px; border-radius: 8px; }
.add-song-msg-success { background: rgba(76, 175, 80, 0.15); color: #81c784; }
.add-song-msg-error { background: rgba(244, 67, 54, 0.15); color: #e57373; }
.add-song-submit {
  padding: 10px;
  border: none;
  border-radius: 8px;
  background: #4f6ef7;
  color: #fff;
  cursor: pointer;
  font-weight: 600;
}
.add-song-submit:disabled { opacity: 0.6; cursor: not-allowed; }
.add-song-divider { height: 1px; background: rgba(255, 255, 255, 0.08); }
.add-song-batch { display: flex; gap: 8px; }
.add-song-batch-btn {
  flex: 1;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: #ddd;
  cursor: pointer;
  font-size: 12px;
}
.add-song-batch-btn:disabled { opacity: 0.5; cursor: not-allowed; }
```

- [ ] **Step 3: 类型检查**

Run: `cd web && npx tsc --noEmit`
Expected: 无 AddSongPanel.tsx 相关错误

---

## Task 5: App.tsx 工具栏集成

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: 引入组件 + 新增 state**

在 `web/src/App.tsx` 顶部（组件 import 区）新增：

```typescript
import AddSongPanel from '@/components/AddSongPanel';
```

在组件内新增 state（放在 `showCachePanel` 等 state 附近）：

```typescript
  // 手动添加歌曲面板开关
  const [showAddSongPanel, setShowAddSongPanel] = useState(false);
```

- [ ] **Step 2: 工具栏新增「添加」按钮**

在「导入」按钮之后（`import-btn` 那段之后、缓存按钮之前）新增：

```tsx
        <button
          className="import-btn"
          onClick={() => setShowAddSongPanel(true)}
          title="添加歌曲"
        >
          <span>＋</span>
          <span>添加</span>
        </button>
```

- [ ] **Step 3: 渲染面板**

在组件返回的 JSX 末尾（关闭标签前）新增：

```tsx
      {showAddSongPanel && (
        <AddSongPanel
          onClose={() => setShowAddSongPanel(false)}
        />
      )}
```

- [ ] **Step 4: 类型检查**

Run: `cd web && npx tsc --noEmit`
Expected: 无 App.tsx 相关错误

---

## Task 6: 完整验证

- [ ] **Step 1: 后端测试 + 类型检查**

Run: `cd server && npx tsc --noEmit`
Run: `cd server && npx jest tests/songs-add-manual.test.ts tests/url-manager.service.test.ts tests/music-api.service.test.ts tests/radio-stream.service.test.ts tests/radio-diversity.test.ts --forceExit`
Expected: 全部通过（新增 3 用例 + 原有 14 用例）

- [ ] **Step 2: 前端类型检查 + 测试**

Run: `cd web && npx tsc --noEmit`
Run: `cd web && npx vitest run`
Expected: 无类型错误，useAudioPlayer 5 用例通过

---

## 风险与回滚

- `addManualSong` 自动搜索依赖 `search_song_url.py` 与网络，单测中已 mock `runPython`，不影响测试确定性。
- `/add`、`/refresh-hot100` 路由必须注册在 `/:id` 之前，避免路径被通配捕获。
- 手动 URL 验证复用 `checkAudioUrlPlayable`（GET Range，8s 超时），网络波动下可能误判为不可播放，属可接受范围。
- **权限说明**：`POST /api/url-manager/refresh-batch` 已存在且为 `admin` 权限（见 `url-manager.routes.ts`）。前端「刷新失效 URL」按钮对非管理员用户会返回 403（`request` 封装会抛出「请求失败 (403)」提示）；如需普通用户可用，需另行放宽该路由权限或新增专用端点。
- 所有改动遵循「不删除原代码、修改处加普通注释」规范。
