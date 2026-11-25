# 个人电台智能推荐系统设计文档

## 1. 概述

基于 LangChain Agent 的个人电台智能推荐系统，结合用户听歌历史、情绪DNA、社交DNA等个性化数据，提供 AI 驱动的音乐推荐服务。

## 2. 功能需求

### 2.1 核心功能
- **一键电台**：点击按钮自动生成 AI 推荐列表并播放
- **对话式推荐**：用户通过文字/语音与 AI 对话，获取个性化推荐
- **语音开启**：支持语音输入触发推荐

### 2.2 推荐逻辑
- 优先从已有曲库（1178首）推荐
- 曲库不匹配时，通过网络搜索发现新歌
- 结合每日推荐、情绪DNA、社交DNA等个性特征

### 2.3 记忆系统
- **会话级记忆**：同一电台会话内保留对话历史
- **长期记忆**：跨会话存储用户偏好（UserPreferenceMemory）

## 3. 技术架构

```
前端（React）
├─ AI 电台按钮（播放器集成）
├─ 对话面板（侧边栏）
└─ 语音识别（Web Speech API + 第三方回退）
    ↓
后端 API（Express）
├─ POST /api/radio/chat — 发送消息
├─ GET /api/radio/sessions — 获取会话列表
├─ GET /api/radio/sessions/:id — 获取会话详情
├─ POST /api/radio/quick — 一键电台
└─ DELETE /api/radio/sessions/:id — 删除会话
    ↓
LangChain Agent
├─ Tool: queryUserHistory — 查询听歌历史
├─ Tool: queryUserDNA — 查询情绪/社交DNA
├─ Tool: querySongLibrary — 搜索曲库
├─ Tool: searchExternal — 网络搜索
└─ Tool: generatePlaylist — 生成推荐列表
    ↓
LLM Provider（可切换）
├─ OpenAI API（gpt-4o-mini）
└─ Ollama（本地模型）
```

## 4. 数据模型

### RadioSession（电台会话）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | BigInt | 主键 |
| userId | Int | 用户ID |
| title | String? | 会话标题（AI 自动生成） |
| createdAt | DateTime | 创建时间 |
| updatedAt | DateTime | 更新时间 |

### RadioMessage（电台消息）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | BigInt | 主键 |
| sessionId | BigInt | 会话ID |
| role | String | 'user' / 'assistant' |
| content | String | 消息内容 |
| songs | Json? | 推荐歌曲列表（仅 assistant） |
| createdAt | DateTime | 创建时间 |

### UserPreferenceMemory（用户偏好记忆）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | BigInt | 主键 |
| userId | Int | 用户ID |
| key | String | 偏好键（如 'favorite_artist'） |
| value | String | 偏好值 |
| score | Float | 偏好强度（0-1） |
| updatedAt | DateTime | 更新时间 |

## 5. LangChain Agent Tools

### 5.1 queryUserHistory
- 查询用户最近播放的歌曲（最近50首）
- 查询播放次数最多的歌曲（Top 20）
- 查询最近收藏/喜欢的歌曲

### 5.2 queryUserDNA
- 查询情绪DNA（情绪标签 + 权重）
- 查询社交DNA（社交特征）
- 查询每日推荐列表

### 5.3 querySongLibrary
- 按风格（genre）搜索
- 按情绪（mood）搜索
- 按场景（scene）搜索
- 按艺术家/歌名模糊搜索

### 5.4 searchExternal
- 调用现有爬虫模块搜索新歌
- 返回歌曲元数据（标题、艺术家、专辑）

### 5.5 generatePlaylist
- 接收推荐列表
- 保存到数据库
- 返回格式化的播放列表

## 6. LLM 配置

```typescript
interface LLMConfig {
  provider: 'openai' | 'ollama';
  openaiApiKey?: string;
  openaiModel?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
}
```

## 7. 前端组件

### 7.1 RadioPanel（电台对话面板）
- 侧边栏滑出
- 消息列表（用户/AI 消息气泡）
- 输入框 + 发送按钮
- 语音按钮（长按说话）

### 7.2 PlayerRadioButton（播放器电台按钮）
- 播放器控制栏新增 AI 电台按钮
- 点击切换电台模式
- 电台模式下显示当前推荐理由

### 7.3 VoiceInput（语音输入组件）
- Web Speech API 优先
- 第三方 API 回退
- 实时语音转文字显示

## 8. 安全考虑

- 用户只能访问自己的会话和数据
- LLM API Key 安全存储在服务端环境变量
- 语音数据不持久化存储
- 推荐结果需要过滤敏感内容
