# 全自动 AI 电台系统实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有对话式 AI 电台重构为「全自动 AI 电台」——点击播放器「电台」按钮立即生成并播放个性化歌单，无限连播、单曲失败自动跳过、全程无需人工干预，并与现有对话电台并存。

**Architecture:** 后端新增 `RadioStreamService`（内存流式状态机 + 规则秒开 + 后台 LLM 异步优化），新增 3 个端点；前端复用「电台」按钮触发自动电台，复用 `extraTracks + select + onEnded` 播放链路，新增低水位预取实现无限连播。

**Tech Stack:** TypeScript, Express, Prisma, React, LangChain Agent（复用现有推荐引擎）

---

## 文件结构

### 新建的文件
- `server/src/modules/radio/radio-stream.service.ts` — 自动电台流式状态机

### 修改的文件
- `server/src/modules/radio/radio.controller.ts` — 注册 stream/start、stream/next、stream/feedback 三个端点
- `web/src/services/api.ts` — 新增 streamStart/streamNext/streamFeedback API
- `web/src/App.tsx` — 「电台」按钮改为启动自动电台、新增预取逻辑、保留对话面板入口

---

## Task 1: 后端 — 创建 RadioStreamService

**Files:**
- Create: `server/src/modules/radio/radio-stream.service.ts`

- [ ] **Step 1: 写入完整服务代码**

```typescript
/**
 * RadioStream Service - 全自动 AI 电台（无限连播）
 *
 * 流程：
 *   start    → 规则推荐秒开（立即返回歌单）+ 后台异步触发 LLM 优化下一批
 *   next     → 返回下一批歌单（LLM 优先，规则兜底），并触发再下一轮 LLM
 *   feedback → 记录跳过/完成，用于去重
 *
 * 会话上下文：内存 Map（重启后重新开始），共享 LLM 聊天历史实现"越播越懂你"
 */

import { PrismaClient } from '@prisma/client';
import { RecommendationService } from '../recommendation/recommendation.service';
import { chatWithAgent } from './agent';

// ── 流式状态（内存，key 为 sessionId）──
interface StreamState {
  sessionId: number;
  userId: number;
  playedSongIds: Set<string>;   // 已返回/已播放歌曲（去重）
  playedTitles: string[];       // 已播歌曲标题（用于提示词避免重复）
  history: { role: string; content: string }[]; // LLM 共享聊天历史
  llmPending: boolean;          // 后台 LLM 是否在跑
  llmReadySongs: any[];         // LLM 已生成的待返回歌单
  llmReadyOutput: string;       // LLM 文字输出（可选展示）
}

const streams = new Map<number, StreamState>();

/** 每批推荐数量 */
const BATCH_SIZE = 10;

/** 清洗歌曲为前端需要的精简结构 */
function toSongView(song: any) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    duration: song.duration,
  };
}

/** 自动电台续播提示词 */
function buildAutoPrompt(playedTitles: string[]): string {
  const playedHint = playedTitles.length > 0
    ? `\n已播放过的歌曲（请勿重复推荐）：${playedTitles.slice(-20).join('、')}`
    : '';
  return `请根据我的听歌历史、情绪DNA、社交DNA和每日推荐，为我推荐下一批 5-10 首歌曲，保持风格连贯。${playedHint}`;
}

export class RadioStreamService {
  private recommender = new RecommendationService();

  constructor(private prisma: PrismaClient) {}

  /** 启动自动电台：规则推荐秒开 + 后台触发 LLM */
  async start(userId: number) {
    // 1. 创建共享会话（复用 RadioSession 记录上下文）
    const session = await this.prisma.radioSession.create({
      data: { userId, title: '自动电台' },
    });
    const sessionId = Number(session.id);

    // 2. 初始化流式状态
    const state: StreamState = {
      sessionId,
      userId,
      playedSongIds: new Set(),
      playedTitles: [],
      history: [],
      llmPending: false,
      llmReadySongs: [],
      llmReadyOutput: '',
    };
    streams.set(sessionId, state);

    // 3. 规则推荐秒开（立即返回）
    const songs = await this.ruleRecommend(state);

    // 4. 后台异步触发 LLM 生成下一批（不阻塞响应）
    this.triggerLLM(state).catch(err => {
      console.warn('[RadioStream] 后台 LLM 失败，降级规则推荐:', err instanceof Error ? err.message : err);
    });

    return { sessionId: String(session.id), songs };
  }

  /** 获取下一批歌单：LLM 优先，规则兜底，并触发再下一轮 LLM */
  async next(userId: number, sessionId: number) {
    const state = streams.get(sessionId);
    if (!state) throw new Error('Stream session not found');
    if (state.userId !== userId) throw new Error('Forbidden');

    let songs: any[];
    if (state.llmReadySongs.length > 0) {
      // LLM 结果已就绪，优先使用
      songs = state.llmReadySongs;
      state.llmReadySongs = [];
      state.llmReadyOutput = '';
    } else {
      // LLM 未就绪，规则兜底
      songs = await this.ruleRecommend(state);
    }

    // 记录已返回歌曲
    this.markPlayed(state, songs);

    // 触发下一轮 LLM（若未在跑）
    if (!state.llmPending) {
      this.triggerLLM(state).catch(err => {
        console.warn('[RadioStream] 后台 LLM 失败，降级规则推荐:', err instanceof Error ? err.message : err);
      });
    }

    return { songs };
  }

  /** 记录播放反馈（跳过/完成），用于去重与后续个性化 */
  async feedback(userId: number, sessionId: number, songId: string) {
    const state = streams.get(sessionId);
    if (!state) return { success: true };
    if (state.userId !== userId) throw new Error('Forbidden');
    state.playedSongIds.add(songId);
    return { success: true };
  }

  /** 记录已返回歌曲到去重集合与标题列表 */
  private markPlayed(state: StreamState, songs: any[]) {
    for (const s of songs) {
      state.playedSongIds.add(s.id);
      if (s.title) state.playedTitles.push(s.title);
    }
  }

  /** 规则推荐：排除已播歌曲（复用 RecommendationService 个性化推荐） */
  private async ruleRecommend(state: StreamState): Promise<any[]> {
    const all = await this.recommender.generateForUser(state.userId);
    const fresh = (all || []).filter((s: any) => !state.playedSongIds.has(s.id));
    const picked = fresh.length >= BATCH_SIZE ? fresh.slice(0, BATCH_SIZE) : fresh;
    return picked.map(toSongView);
  }

  /** 后台触发 LLM 生成下一批歌单 */
  private async triggerLLM(state: StreamState) {
    if (state.llmPending) return;
    state.llmPending = true;
    try {
      const prompt = buildAutoPrompt(state.playedTitles);
      // 记录用户消息到历史
      state.history.push({ role: 'user', content: prompt });
      const result = await chatWithAgent(this.prisma, state.userId, prompt, state.history);
      // 记录助手回复到历史
      state.history.push({ role: 'assistant', content: result.output });
      // 存储 LLM 歌单（清洗为精简结构，排除已播）
      const songs = (result.songs || []).map(toSongView).filter((s: any) => !state.playedSongIds.has(s.id));
      state.llmReadySongs = songs;
      state.llmReadyOutput = result.output;
    } finally {
      state.llmPending = false;
    }
  }
}
```

- [ ] **Step 2: 编译验证**

Run: `cd d:\music_box\server ; npx tsc --noEmit`

Expected: No errors（若报 BigInt 相关错误忽略，与现有 radio.service.ts 一致）

---

## Task 2: 后端 — 注册自动电台端点

**Files:**
- Modify: `server/src/modules/radio/radio.controller.ts`

- [ ] **Step 1: 引入 RadioStreamService 并实例化**

在 `import { RadioService } from './radio.service';` 之后新增：

```typescript
import { RadioStreamService } from './radio-stream.service';
```

在 `const service = new RadioService(prisma);` 之后新增：

```typescript
const streamService = new RadioStreamService(prisma);
```

- [ ] **Step 2: 在 `return router;` 之前新增三个端点**

```typescript
  // ── 全自动 AI 电台（无限连播）──

  // 启动自动电台：规则秒开 + 后台 LLM
  router.post('/stream/start', authenticate, async (req: AuthRequest, res: Response) => {
    try {
      const result = await streamService.start(req.user!.id);
      res.json({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start auto radio';
      res.status(500).json({ success: false, error: message });
    }
  });

  // 获取下一批歌单（无限连播预取）
  router.get('/stream/:sessionId/next', authenticate, async (req: AuthRequest, res: Response) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const result = await streamService.next(req.user!.id, sessionId);
      res.json({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get next songs';
      res.status(500).json({ success: false, error: message });
    }
  });

  // 播放反馈（跳过/完成）
  router.post('/stream/:sessionId/feedback', authenticate, async (req: AuthRequest, res: Response) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const { songId } = req.body;
      if (!songId) {
        res.status(400).json({ success: false, error: 'songId is required' });
        return;
      }
      const result = await streamService.feedback(req.user!.id, sessionId, songId);
      res.json({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to record feedback';
      res.status(500).json({ success: false, error: message });
    }
  });
```

- [ ] **Step 3: 编译验证**

Run: `cd d:\music_box\server ; npx tsc --noEmit`

Expected: No errors

- [ ] **Step 4: 启动服务并验证端点**

```powershell
cd d:\music_box\server
node dist/index.js
```

另开终端：

```powershell
# 启动自动电台
curl -X POST http://localhost:49200/api/radio/stream/start -H "Content-Type: application/json"
```

Expected: 返回 `{ success: true, data: { sessionId: "...", songs: [{ id, title, artist, duration }, ...] } }`，且立即返回（秒级）

```powershell
# 获取下一批（用上一步返回的 sessionId）
curl http://localhost:49200/api/radio/stream/<sessionId>/next
```

Expected: 返回 `{ success: true, data: { songs: [...] } }`

> 注意：`/stream/start` 和 `/stream/next` 需要认证（Bearer token）。若直接 curl 401，先调用 `/api/auth/guest` 获取 token 并带上 `-H "Authorization: Bearer <token>"`。

---

## Task 3: 前端 — 新增 stream API

**Files:**
- Modify: `web/src/services/api.ts`

- [ ] **Step 1: 在 `radioAPI` 对象内、`deleteSession` 之后新增三个方法**

在 `deleteSession: (sessionId: string) => ...` 之后、对象结尾 `};` 之前插入：

```typescript
  /** 启动全自动电台（规则秒开 + 后台 LLM 优化） */
  streamStart: () =>
    request<{ sessionId: string; songs: RecommendedSong[] }>('/radio/stream/start', {
      method: 'POST',
    }),

  /** 获取下一批歌单（无限连播预取） */
  streamNext: (sessionId: string) =>
    request<{ songs: RecommendedSong[] }>(`/radio/stream/${sessionId}/next`),

  /** 播放反馈（跳过/完成） */
  streamFeedback: (sessionId: string, songId: string) =>
    request<void>(`/radio/stream/${sessionId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ songId }),
    }),
```

- [ ] **Step 2: 编译验证**

Run: `cd d:\music_box\web ; npx tsc --noEmit`

Expected: No errors

---

## Task 4: 前端 — App.tsx 集成自动电台

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: 引入 radioAPI**

在现有 import 区域（`import RadioPanel from '@/components/RadioPanel';` 附近）新增：

```typescript
import { radioAPI } from '@/services/api';
```

- [ ] **Step 2: usePlaylist 解构中新增 `currentIndex`**

在 [usePlaylist 解构](file:///d:/music_box/web/src/App.tsx#L160-L174) 中，将 `playlist,` 后追加 `currentIndex,`：

```typescript
  const {
    playlist,
    currentIndex,
    currentTrack,
    playMode,
    next,
    prev,
    peekNext,
    select,
    togglePlayMode,
    isFavorite,
    toggleFavorite,
    addToRecent,
    favorites,
    recentTracks
  } = usePlaylist(extraTracks);
```

- [ ] **Step 3: 新增自动电台状态与引用**

在 `const [showRadioPanel, setShowRadioPanel] = useState(false);` 之后新增：

```typescript
  // 全自动电台状态（点击「电台」按钮启动）
  const [radioActive, setRadioActive] = useState(false);
  const radioSessionRef = useRef<string | null>(null);
  const radioFetchingRef = useRef(false);
```

- [ ] **Step 4: 新增启动函数与预取逻辑**

在 `handlePlayPlaylist` 函数附近新增以下两个代码块：

```typescript
  // 启动全自动电台：调用后端秒开歌单并立即播放
  const startAutoRadio = useCallback(async () => {
    try {
      setRadioActive(true);
      const result = await radioAPI.streamStart();
      radioSessionRef.current = result.sessionId;
      const tracks: Track[] = (result.songs || []).map((s: any) => ({
        id: s.id,
        title: s.title || '',
        artist: s.artist || '',
        audioUrl: `/api/stream/${s.id}`,
        lyricContent: '',
        coverColor: '#667eea',
      }));
      setExtraTracks(tracks);
      if (tracks.length > 0) {
        setTimeout(() => select(tracks[0].id), 100);
      }
    } catch (err) {
      setRadioActive(false);
      console.error('[AutoRadio] 启动失败:', err instanceof Error ? err.message : err);
    }
  }, [select, setExtraTracks]);
```

```typescript
  // 全自动电台：队列剩余 ≤ 3 首时预取下一批，实现无限连播
  useEffect(() => {
    if (!radioActive || !radioSessionRef.current) return;
    const remaining = playlist.length - currentIndex - 1;
    if (remaining > 3 || radioFetchingRef.current) return;
    radioFetchingRef.current = true;
    radioAPI.streamNext(radioSessionRef.current)
      .then(result => {
        const newTracks: Track[] = (result.songs || []).map((s: any) => ({
          id: s.id,
          title: s.title || '',
          artist: s.artist || '',
          audioUrl: `/api/stream/${s.id}`,
          lyricContent: '',
          coverColor: '#667eea',
        }));
        if (newTracks.length > 0) {
          setExtraTracks(prev => [...prev, ...newTracks]);
        }
      })
      .catch(err => console.warn('[AutoRadio] 预取失败:', err instanceof Error ? err.message : err))
      .finally(() => { radioFetchingRef.current = false; });
  }, [radioActive, currentIndex, playlist.length, setExtraTracks]);
```

- [ ] **Step 5: 修改「电台」按钮行为，并新增「对话」入口**

将现有「AI 电台按钮」块：

```tsx
        {/* AI 电台按钮 */}
        <button
          className={`cache-trigger-btn${showRadioPanel ? ' active' : ''}`}
          onClick={() => setShowRadioPanel(v => !v)}
          title="AI 电台"
        >
          🎙️
          <span>电台</span>
        </button>
```

替换为：

```tsx
        {/* AI 电台按钮（改为启动全自动电台：点击即生成并播放） */}
        <button
          className={`cache-trigger-btn${radioActive ? ' active' : ''}`}
          onClick={startAutoRadio}
          title="AI 电台"
        >
          🎙️
          <span>电台</span>
        </button>
        {/* 对话式电台入口（并存，打开原对话面板） */}
        <button
          className={`cache-trigger-btn${showRadioPanel ? ' active' : ''}`}
          onClick={() => setShowRadioPanel(v => !v)}
          title="电台对话"
        >
          💬
          <span>对话</span>
        </button>
```

- [ ] **Step 6: 编译验证**

Run: `cd d:\music_box\web ; npx tsc --noEmit`

Expected: No errors

- [ ] **Step 7: 构建前端**

Run: `cd d:\music_box\web ; npm run build`

Expected: Build successful

---

## Task 5: 端到端验证

- [ ] **Step 1: 启动后端与前端**

```powershell
cd d:\music_box\server
node dist/index.js
```

另开终端：

```powershell
cd d:\music_box\web
npm run dev
```

- [ ] **Step 2: 浏览器验证**

打开 `http://localhost:49200`（或 dev 端口），验证：
1. 点击「电台」按钮 → 立即开始播放歌单
2. 播放到队列末尾 → 自动续播（不中断）
3. 某首 URL 失效 → 自动跳过到下一首
4. 点击「对话」按钮 → 打开原对话式电台面板（功能不变）
5. 两种模式互不干扰

---

## 回滚方案

若实现有问题，可快速回滚：
1. 删除 `server/src/modules/radio/radio-stream.service.ts`
2. 恢复 `radio.controller.ts`（移除 stream 相关 import 与路由）
3. 恢复 `api.ts`（移除 streamStart/streamNext/streamFeedback）
4. 恢复 `App.tsx`（「电台」按钮改回 `setShowRadioPanel`，移除自动电台状态与预取逻辑）
