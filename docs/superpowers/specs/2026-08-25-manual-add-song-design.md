# 手动添加歌曲 + 内容库扩充 — 设计方案

- 日期：2026-08-25
- 范围：手动添加新歌曲（自动搜/手动 URL）+ 批量爬热榜 + 批量刷新 URL，前端主界面工具栏入口

---

## 1. 概述

为丰富曲库、扩充可播放音频内容，提供「手动添加歌曲」能力，并暴露批量扩充入口：

1. **手动添加歌曲**：用户输入「歌名+歌手」（自动搜索获取可播放 URL）或「歌名+歌手+音频 URL」（手动指定），系统验证后入库。
2. **批量爬热榜**：一键触发爬取网易云热榜新歌入库。
3. **批量刷新 URL**：一键触发批量刷新失效歌曲 URL（复用已有能力）。

## 2. 现状与复用

| 能力 | 现状 | 处理 |
|------|------|------|
| 单曲 URL 刷新 | `url-manager.refreshUrl` + `/api/refresh-track` | 复用 |
| 批量刷新 URL | `POST /api/url-manager/refresh-batch`（`batchCheckAndRefresh`） | 复用（前端暴露） |
| 热榜爬取 | `refreshHot100()`（`playlists/hot100.service.ts`），仅定时调度触发 | 新增手动触发端点 |
| 自动搜索 URL | `search_song_url.py`（网易云按歌名+歌手搜索，本次会话已实现） | 复用 |
| URL 验证 | `checkAudioUrlPlayable`（GET Range，可靠） | 复用 |
| 创建歌曲 | `songs.service.createSong`（需手动提供 id/url，无验证） | 扩展 |

## 3. 后端设计

### 3.1 新增 `addManualSong`（songs.service.ts）

```
输入：{ title: string, artist?: string, audioUrl?: string }
流程：
  1. 生成唯一 ID：manual:{uuid}
  2. 去重：按 title + artist（忽略大小写）查询，已存在则返回已有歌曲
  3. 获取 URL：
     - audioUrl 提供 → checkAudioUrlPlayable(url) 验证；不可播放则抛错「音频URL不可播放」
     - audioUrl 未提供 → runPython(search_song_url.py, title, artist) 搜索；失败则抛错「未找到可播放版本」
  4. 调 createSong 入库（dataSource='manual'）
输出：创建的歌曲（含 id/title/artist/audioUrl/playable）
```

### 3.2 新增控制器端点（songs.controller.ts）

- `POST /api/songs/add`：调用 `addManualSong`，成功返回 201 + 歌曲；失败返回 400 + 错误信息
- `POST /api/songs/refresh-hot100`：调用 `refreshHot100()`，返回 `{ count }`（异步触发不阻塞）

### 3.3 复用端点

- `POST /api/url-manager/refresh-batch`（已存在）

## 4. 前端设计

### 4.1 新增组件 `AddSongPanel.tsx`

- 主界面顶部工具栏新增「添加歌曲」按钮，点击弹出面板（modal）
- 面板内：
  - **添加表单**：歌名（必填）、歌手（选填）、音频 URL（选填，默认隐藏，勾选「手动指定 URL」后显示）
  - **批量操作区**：「刷新失效 URL」「爬取热榜新歌」两个按钮
  - 提交后显示结果提示（成功/失败原因）

### 4.2 API 封装（api.ts）

- `addManualSong({ title, artist?, audioUrl? })` → POST `/api/songs/add`
- `refreshHot100()` → POST `/api/songs/refresh-hot100`
- `refreshBatchUrls()` → POST `/api/url-manager/refresh-batch`

### 4.3 集成（App.tsx）

- 工具栏渲染「添加歌曲」按钮 + 面板开关 state

## 5. 数据流与异常处理

| 场景 | 处理 |
|------|------|
| 手动 URL 不可播放 | 返回 400「音频URL不可播放」，不入库 |
| 自动搜索无结果 | 返回 400「未找到可播放版本」 |
| 歌曲已存在 | 返回已有歌曲（不重复入库） |
| 批量刷新/爬热榜 | 异步触发，返回「任务已启动」，避免长时间阻塞 |

## 6. 涉及文件

| 文件 | 改动 |
|------|------|
| `server/src/modules/songs/songs.service.ts` | 新增 `addManualSong` |
| `server/src/modules/songs/songs.controller.ts` | 新增 `add` / `refreshHot100` 端点 |
| `server/src/modules/songs/songs.routes.ts` | 注册新路由 |
| `web/src/components/AddSongPanel.tsx` | 新增面板组件 |
| `web/src/services/api.ts` | 新增 3 个 API 方法 |
| `web/src/App.tsx` | 工具栏集成按钮 + 面板开关 |

## 7. 测试

- 后端：`addManualSong`（手动 URL 成功 / 手动 URL 不可播放 / 自动搜索成功 / 重复歌曲）单测
- 前端：`AddSongPanel` 渲染冒烟 + 提交调用 API
- 回归：现有后端 14 用例、前端 5 用例保持通过

## 8. 约束

- 严禁删除原有代码，修改处加普通注释；新功能优先复用现有服务（`checkAudioUrlPlayable`、`search_song_url.py`、`refreshHot100`、`batchCheckAndRefresh`）。
