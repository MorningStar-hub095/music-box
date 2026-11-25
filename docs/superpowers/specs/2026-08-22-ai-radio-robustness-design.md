# AI 电台健壮性优化 — 设计方案

- 日期：2026-08-22
- 范围：AI 电台的「UI 收敛 + 前端响应速度 + 后台稳定性」整体优化（分三阶段实施）

---

## 1. 概述

在已完成 AI 电台「个性化推荐 + 心动模式探索」、探索比例可调、音频 URL 跨源降级等能力的基础上，进一步收敛前端 UI、提升前端响应速度、加强后台服务稳定性，使 AI 电台体验更流畅、更健壮。

## 2. 现状问题

### 2.1 前端 UI
- `LlmConfigPanel.tsx`（被 `RadioPlaylist.tsx` 使用）与 `RadioPanel.tsx` 内联配置面板重复实现两套 LLM 配置 UI（provider/密钥/模型/温度/超时），维护成本高、易不一致。
- 探索比例滑杆已接入 `LlmConfigPanel`（本次会话已完成）。

### 2.2 前端响应速度
- `useAudioPlayer.ts` 中 position/isPlaying 更新冗余：`timeupdate`(约 250ms) + rAF(50ms) + `setInterval`(1s 轮询 isPlaying) 三套并存，产生不必要 re-render。
- `App.tsx` 自动电台多个 effect 联动（`radioSongs`/`extraTracks`/`pendingRadioPlayRef`），存在多余 re-render 空间。

### 2.3 后台稳定性
- `server/src/lib/redis.ts` 60s 缓存清理 `setInterval` 未 `.unref()`，导致 Node 进程无法优雅退出（Jest "Force exiting" 的根因之一）。
- `url-manager.scheduler.ts` 大量 `setInterval` 定时任务 + 启动即音频预热（50 首），启动瞬时压力大，定时器未 unref。
- `url-manager.service.ts` 多源刷新 `withRetry` 指数退避在失败场景可累计耗时 30s+，缺乏总超时上限。

---

## 3. 方案（三阶段）

### 阶段一：前端 UI 收敛

抽离共用的 LLM 配置表单组件，消除两套重复 UI：

- 新增 `web/src/components/LlmConfigForm.tsx`：包含 provider / API Key / 模型 / Base URL / 温度 / 探索比例 / 超时 的全部状态、加载、保存逻辑。
- `LlmConfigPanel.tsx` 改为薄壳容器，复用 `LlmConfigForm`（保留原文件与入口，不删除）。
- `RadioPanel.tsx` 的内联配置面板改为复用 `LlmConfigForm`（原内联 JSX 用注释标记迁移，不删除）。

### 阶段二：前端响应速度

- `useAudioPlayer.ts`：
  - 移除 `timeupdate` 监听（position 已由 rAF 50ms 高频更新，更流畅）。
  - 移除 1s `setInterval` 轮询 isPlaying（改由 play/pause/ended 事件驱动，保留必要的兜底逻辑注释）。
  - 结果：position/isPlaying 更新从三套收敛为一套 rAF + 事件驱动。
- `App.tsx` 自动电台：
  - 电台歌单映射、effect 依赖优化（`useMemo`/`useCallback`），减少多余 re-render。

### 阶段三：后台稳定性

- `server/src/lib/redis.ts`：60s 清理 `setInterval(...).unref()`。
- `url-manager.scheduler.ts`：所有 `setInterval`/`setTimeout` 定时器 `.unref()`；启动音频预热 `audioWarmup` 增加延迟与限流（降低启动瞬时压力）。
- `url-manager.service.ts`：`withRetry` 增加总耗时上限（默认 15s），超时即放弃，避免失败场景拖 30s+。

---

## 4. 涉及文件

| 文件 | 改动 |
|------|------|
| `web/src/components/LlmConfigForm.tsx` | 新增：共用配置表单 |
| `web/src/components/LlmConfigPanel.tsx` | 复用 LlmConfigForm（薄壳） |
| `web/src/components/RadioPanel.tsx` | 内联配置复用 LlmConfigForm |
| `web/src/hooks/useAudioPlayer.ts` | 收敛 position/isPlaying 更新 |
| `web/src/App.tsx` | 自动电台 effect 优化 |
| `server/src/lib/redis.ts` | 定时器 `.unref()` |
| `server/src/modules/url-manager/url-manager.scheduler.ts` | 定时器 `.unref()` + 预热限流 |
| `server/src/modules/url-manager/url-manager.service.ts` | `withRetry` 总超时上限 |

---

## 5. 测试与验证

- 前端：`useAudioPlayer` 单测回归（4 用例保持通过）；`LlmConfigForm` 渲染冒烟。
- 后端：`url-manager` / `audio-cache` / `radio-diversity` / `music-api` 单测回归（14 用例保持通过）。
- 稳定性：服务优雅退出验证（无 "Force exiting" 告警）；启动预热延迟生效。

## 6. 验收标准

1. 两套 LLM 配置 UI 收敛为共用组件，行为一致。
2. `useAudioPlayer` 无冗余更新，电台播放流畅。
3. 后台定时器 `.unref()`，进程可优雅退出。
4. 多源刷新有总超时上限，不再长时间阻塞。
5. 现有测试全部通过，无新增 TS 报错。

## 7. 约束

- 严禁删除原有代码，通过注释标记迁移/废弃，修改处加普通注释。
