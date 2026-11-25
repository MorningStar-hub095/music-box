# AI 电台健壮性优化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收敛 AI 电台前端 UI、提升前端响应速度、加强后台服务稳定性（分三阶段）。

**Architecture:** 抽离共用 LLM 配置表单组件；收敛 useAudioPlayer 的冗余更新；对后台定时器 `.unref()` 并给多源刷新加总超时上限。保持现有架构，不做大重构。

**Tech Stack:** React 18 + TypeScript + Vite + Vitest（前端），Express + Prisma + ts-node + Jest（后端）。

---

## 文件结构

**新建：**
- `web/src/components/LlmConfigForm.tsx` — 共用 LLM 配置表单（provider/密钥/模型/温度/探索比例/超时）

**修改：**
- `web/src/components/LlmConfigPanel.tsx` — 改为薄壳，复用 LlmConfigForm
- `web/src/components/RadioPanel.tsx` — 内联配置复用 LlmConfigForm
- `web/src/hooks/useAudioPlayer.ts` — 移除 timeupdate 与 1s 轮询
- `web/src/App.tsx` — 自动电台 effect 优化
- `server/src/lib/redis.ts` — 定时器 `.unref()`
- `server/src/modules/url-manager/url-manager.scheduler.ts` — 定时器 `.unref()` + 预热限流
- `server/src/modules/url-manager/url-manager.config.ts` — 新增 retry.totalTimeout
- `server/src/modules/url-manager/url-manager.service.ts` — withRetry 总超时上限

---

## 阶段一：前端 UI 收敛

### Task 1: 新增共用 LlmConfigForm 组件

**Files:**
- Create: `web/src/components/LlmConfigForm.tsx`

- [ ] **Step 1: 编写组件（含状态、加载、保存、表单）**

创建 `web/src/components/LlmConfigForm.tsx`：

```tsx
/**
 * LlmConfigForm - 共用的 LLM API 配置表单
 * 供 LlmConfigPanel（自动电台）与 RadioPanel（对话电台）复用，消除两套重复配置 UI。
 */
import { useState, useEffect } from 'react';
import { radioAPI, LlmConfig } from '../services/api';
import './LlmConfigPanel.css';

interface LlmConfigFormProps {
  onSaved?: (config: LlmConfig) => void;
}

export default function LlmConfigForm({ onSaved }: LlmConfigFormProps) {
  const [config, setConfig] = useState<LlmConfig | null>(null);
  const [provider, setProvider] = useState('ollama');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [timeout, setTimeoutSec] = useState(110);
  const [explorationRatio, setExplorationRatio] = useState(0.3);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // 挂载时加载当前 LLM 配置与电台探索比例
  useEffect(() => {
    radioAPI.getLlmConfig()
      .then(cfg => {
        setConfig(cfg);
        setProvider(cfg.provider);
        setModel(cfg.model);
        setBaseUrl(cfg.baseUrl);
        setTemperature(cfg.temperature);
        setTimeoutSec(cfg.timeout);
        setApiKey('');
        setMsg('');
      })
      .catch(err => setMsg('加载配置失败：' + (err instanceof Error ? err.message : '')));
    radioAPI.getExplorationRatio()
      .then(r => setExplorationRatio(r.explorationRatio))
      .catch(() => {});
  }, []);

  // 切换提供商时自动填充默认模型与 Base URL
  const handleProviderChange = (value: string) => {
    setProvider(value);
    const preset = config?.providers?.find(p => p.value === value);
    if (preset) {
      setModel(preset.defaultModel);
      setBaseUrl(preset.defaultBaseUrl);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg('');
    try {
      const cfg = await radioAPI.saveLlmConfig({
        provider,
        apiKey: apiKey || undefined,
        model: model || undefined,
        baseUrl: baseUrl || undefined,
        temperature,
        timeout,
      });
      await radioAPI.saveExplorationRatio(explorationRatio);
      setConfig(cfg);
      setApiKey('');
      setMsg('配置已保存并立即生效');
      onSaved?.(cfg);
    } catch (err) {
      setMsg('保存失败：' + (err instanceof Error ? err.message : ''));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="llm-config-form">
      <div className="llm-config-field">
        <label>模型服务（提供商）</label>
        <select value={provider} onChange={e => handleProviderChange(e.target.value)}>
          {(config?.providers || []).map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      <div className="llm-config-field">
        <label>API 密钥 {config?.apiKeyMasked ? `（当前：${config.apiKeyMasked}）` : ''}</label>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="留空表示不修改"
        />
      </div>

      <div className="llm-config-field">
        <label>模型名称</label>
        <input
          type="text"
          value={model}
          onChange={e => setModel(e.target.value)}
          placeholder="如 deepseek-chat"
        />
      </div>

      {provider === 'custom' && (
        <div className="llm-config-field">
          <label>API Base URL</label>
          <input
            type="text"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
          />
        </div>
      )}

      <div className="llm-config-field">
        <label>温度（随机性）：{temperature.toFixed(1)}</label>
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={temperature}
          onChange={e => setTemperature(parseFloat(e.target.value))}
        />
      </div>

      <div className="llm-config-field">
        <label>探索比例：{(explorationRatio * 100).toFixed(0)}%（越高越多新歌探索，越低越贴合口味）</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={explorationRatio}
          onChange={e => setExplorationRatio(parseFloat(e.target.value))}
        />
      </div>

      <div className="llm-config-field">
        <label>请求超时：{timeout} 秒</label>
        <input
          type="range"
          min="10"
          max="300"
          step="10"
          value={timeout}
          onChange={e => setTimeoutSec(parseInt(e.target.value, 10))}
        />
      </div>

      {msg && <div className="llm-config-msg">{msg}</div>}

      <button className="llm-config-save" onClick={handleSave} disabled={saving}>
        {saving ? '保存中…' : '保存配置'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查确认无报错**

Run: `cd web && npx tsc --noEmit`
Expected: 无 `LlmConfigForm.tsx` 相关错误（若项目存在既有其它错误，忽略与本次无关者）。

### Task 2: LlmConfigPanel 复用 LlmConfigForm

**Files:**
- Modify: `web/src/components/LlmConfigPanel.tsx`

- [ ] **Step 1: 改写为薄壳容器**

用 Write 覆盖 `web/src/components/LlmConfigPanel.tsx`：

```tsx
/**
 * LlmConfigPanel - LLM API 配置面板（薄壳容器，表单逻辑见 LlmConfigForm）
 */

import LlmConfigForm from './LlmConfigForm';
import './LlmConfigPanel.css';

interface LlmConfigPanelProps {
  visible: boolean;
  onClose: () => void;
}

export default function LlmConfigPanel({ visible, onClose }: LlmConfigPanelProps) {
  if (!visible) return null;

  return (
    <div className="llm-config-panel">
      <div className="llm-config-header">
        <span>LLM API 配置</span>
        <button className="llm-config-close" onClick={onClose} title="关闭">✕</button>
      </div>
      <LlmConfigForm />
    </div>
  );
}
```

- [ ] **Step 2: 类型检查确认无报错**

Run: `cd web && npx tsc --noEmit`
Expected: 无 `LlmConfigPanel.tsx` 相关错误。

### Task 3: RadioPanel 内联配置复用 LlmConfigForm

**Files:**
- Modify: `web/src/components/RadioPanel.tsx`

- [ ] **Step 1: 引入 LlmConfigForm 并替换内联配置 JSX**

在 `RadioPanel.tsx` 顶部新增导入（放在现有 import 之后）：

```typescript
import LlmConfigForm from './LlmConfigForm';
```

将 `showConfig` 渲染块（原 `<div className="radio-config-panel">...</div>` 内联配置）替换为：

```tsx
        {showConfig && (
          <div className="radio-config-panel">
            <div className="config-header">
              <span>LLM API 配置</span>
              <button className="config-close" onClick={() => setShowConfig(false)}>✕</button>
            </div>
            <LlmConfigForm onSaved={(cfg) => setIsConfigured(cfg.configured)} />
          </div>
        )}
```

> 说明：原内联的 provider/密钥/模型/温度/超时状态与保存逻辑由 LlmConfigForm 承担，`saveConfig`/`openConfig`/`handleProviderChange` 及 `formProvider` 等状态可保留但不再使用（按项目规范不删除，可注释标记）。

- [ ] **Step 2: 类型检查确认无报错**

Run: `cd web && npx tsc --noEmit`
Expected: 无 `RadioPanel.tsx` 相关错误（若 `form*`/`saveConfig`/`openConfig` 等未使用变量触发 TS 报错，用注释标记并移除未使用引用）。

---

## 阶段二：前端响应速度

### Task 4: useAudioPlayer 收敛 position/isPlaying 更新

**Files:**
- Modify: `web/src/hooks/useAudioPlayer.ts`

- [ ] **Step 1: 移除 timeupdate 监听**

删除 `ensureAudio` 中的 timeupdate 监听块（position 已由 rAF 50ms 高频更新）：

```typescript
      audio.addEventListener('timeupdate', () => {
        setPosition(audio.currentTime * 1000);
      });
```

- [ ] **Step 2: 移除 1s 轮询 isPlaying**

删除模块末尾的 isPlaying 轮询 effect：

```typescript
  // isPlaying 与 audio.paused 保持同步（用轮询兜底，避免事件丢失）
  useEffect(() => {
    const id = setInterval(() => {
      const audio = audioRef.current;
      if (!audio) return;
      const playing = !audio.paused;
      setIsPlaying(prev => prev === playing ? prev : playing);
    }, 1000);
    return () => clearInterval(id);
  }, []);
```

- [ ] **Step 3: 运行前端测试确认不回归**

Run: `cd web && npx vitest run`
Expected: `useAudioPlayer` 4 用例仍通过。

### Task 5: App.tsx 自动电台 effect 优化

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: 电台歌单映射提取为 useCallback**

将三处重复的歌曲映射逻辑（`startAutoRadio` / `handleRefreshRadio` / `streamNext` 中的 `(result.songs || []).map(...)`）提取为组件级 `useCallback`：

```typescript
  // 将电台返回的歌曲映射为 Track（音频走 /api/audio 代理）
  const mapRadioSongs = useCallback((songs: any[]): Track[] =>
    (songs || []).map((s: any) => ({
      id: s.id,
      title: s.title || '',
      artist: s.artist || '',
      audioUrl: `http://localhost:${apiPort}/api/audio/${encodeURIComponent(s.id)}`,
      lyricContent: '',
      coverColor: '#667eea',
    })), [apiPort]);
```

然后在三处将 `(result.songs || []).map((s: any) => ({ ... }))` 替换为 `mapRadioSongs(result.songs)`。

- [ ] **Step 2: 类型检查确认无报错**

Run: `cd web && npx tsc --noEmit`
Expected: 无 `App.tsx` 相关错误。

---

## 阶段三：后台稳定性

### Task 6: redis.ts 定时器 `.unref()`

**Files:**
- Modify: `server/src/lib/redis.ts`

- [ ] **Step 1: 给清理定时器加 .unref()**

将模块顶部的清理定时器：

```typescript
// 定期清理过期条目（每60秒）
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiry && entry.expiry <= now) {
      store.delete(key);
    }
  }
}, 60000);
```

改为：

```typescript
// 定期清理过期条目（每60秒）；.unref() 避免阻止进程优雅退出
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiry && entry.expiry <= now) {
      store.delete(key);
    }
  }
}, 60000).unref();
```

- [ ] **Step 2: 验证无报错**

Run: `cd server && npx tsc --noEmit`
Expected: 无 `redis.ts` 相关错误。

### Task 7: url-manager 调度器 `.unref()` + 预热限流

**Files:**
- Modify: `server/src/modules/url-manager/url-manager.scheduler.ts`

- [ ] **Step 1: 定时器统一 .unref()**

将 `start()` 中的 `this.timers.push(setInterval(...))` 改为 `.unref()`（保持返回的 handle 存入 timers，同时取消事件循环引用）：

```typescript
    // 1. 热门歌曲检查
    this.timers.push(setInterval(
      () => this.runTask('hotCheck', () => this.checkHotTracks()),
      cfg.hotCheckInterval,
    ).unref());
```

对其余 6 个 `setInterval`（fullCheck / preDetection / failedRetry / cacheCleanup / alertCheck / audioPreDownload）做同样处理。

- [ ] **Step 2: 启动音频预热增加延迟**

将 `audioWarmup` 的启动延迟由 120 秒改为 300 秒（降低启动瞬时压力）：

```typescript
    // 启动批量预下载：延迟300秒后下载50首热门歌曲，降低启动瞬时压力
    setTimeout(() => this.runTask('audioWarmup', () => this.audioWarmup()), 300 * 1000).unref();
```

- [ ] **Step 3: 验证无报错**

Run: `cd server && npx tsc --noEmit`
Expected: 无 `url-manager.scheduler.ts` 相关错误。

### Task 8: withRetry 总超时上限

**Files:**
- Modify: `server/src/modules/url-manager/url-manager.config.ts`
- Modify: `server/src/modules/url-manager/url-manager.service.ts`

- [ ] **Step 1: 配置新增 totalTimeout**

在 `url-manager.config.ts` 的 `retry` 对象中新增：

```typescript
    /** 抖动范围（毫秒） */
    jitterRange: parseNumber(process.env.URL_RETRY_JITTER, 1000),
    /** 单次刷新重试链的总耗时上限（毫秒），超时即放弃，避免失败场景拖 30s+ */
    totalTimeout: parseNumber(process.env.URL_RETRY_TOTAL_TIMEOUT, 15000),
```

- [ ] **Step 2: withRetry 增加总超时判断**

在 `url-manager.service.ts` 的 `withRetry` 中，新增 `totalTimeout` 读取与截止判断：

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  context: string,
  opts?: { maxRetries?: number; baseDelay?: number; maxDelay?: number; jitterRange?: number; totalTimeout?: number },
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? urlManagerConfig.retry.maxRetries;
  const baseDelay = opts?.baseDelay ?? urlManagerConfig.retry.baseDelay;
  const maxDelay = opts?.maxDelay ?? urlManagerConfig.retry.maxDelay;
  const jitterRange = opts?.jitterRange ?? urlManagerConfig.retry.jitterRange;
  const totalTimeout = opts?.totalTimeout ?? urlManagerConfig.retry.totalTimeout;
  const startTime = Date.now();

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      // 超过总耗时上限：放弃重试，直接抛出
      if (Date.now() - startTime >= totalTimeout) {
        console.warn(`[URL-MGR] ${context} 超过总超时(${totalTimeout}ms)，停止重试`);
        throw lastError;
      }
      if (attempt < maxRetries) {
        const delay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt))
          + Math.random() * jitterRange;
        console.warn(
          `[URL-MGR] ${context} 第${attempt + 1}次失败，${Math.round(delay)}ms 后重试:`,
          err instanceof Error ? err.message : err,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}
```

- [ ] **Step 3: 运行后端单测确认不回归**

Run: `cd server && npx jest tests/url-manager.service.test.ts tests/music-api.service.test.ts --verbose --forceExit`
Expected: 全部通过。

---

## 执行顺序与验证

1. 按 Task 1 → 8 顺序执行。
2. 前端：`cd web && npx tsc --noEmit && npx vitest run`（组件无报错、useAudioPlayer 4 用例通过）。
3. 后端：`cd server && npx tsc --noEmit`，再运行 `npx jest tests/url-manager.service.test.ts tests/music-api.service.test.ts tests/radio-stream.service.test.ts tests/radio-diversity.test.ts --verbose --forceExit`（14 用例通过）。
4. 稳定性：启动服务后优雅关闭（Ctrl+C），确认无挂起定时器报错。

---

## 风险与回滚

- `useAudioPlayer` 移除 `timeupdate`/轮询后若歌词/进度条有回归，可恢复 `timeupdate` 监听（rAF 已覆盖播放态）。
- `RadioPanel` 移除内联配置后，若 `form*` 状态成为未使用变量触发 TS 报错，用注释标记处理。
- 所有改动遵循「不删除原代码、注释标记迁移、修改处加普通注释」规范。
