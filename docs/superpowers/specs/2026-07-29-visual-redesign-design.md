# 音乐盒子视觉美化设计规范

## 1. 设计目标

在保留现有 Galaxy/Nebula/Aurora 三套主题的基础上，新增 Cyberpunk（赛博朋克）、Minimal（极简现代）、Neumorphism（新拟态）三套差异化视觉风格，形成六套完整主题体系。网页版、小程序版同时推进，动效按风格自动匹配。

## 2. 六套主题色彩规范

### 2.1 Galaxy（现有 - 保留）

| 属性 | 值 |
|------|-----|
| 主色 | #6366F1 靛蓝紫 |
| 主色浅 | #818CF8 |
| 主色辉光 | rgba(99,102,241,0.35) |
| 背景 | #080B1A 深空黑 |
| 表面 | rgba(26,29,58,0.4) |
| 文本主 | #E8E8F0 |
| 文本次 | #9CA3AF |
| 高亮 | #FBBF24 金色 |
| 收藏 | #F472B6 粉色 |
| 玻璃模糊 | 24px |
| 3D 场景 | nocturnal（柱网格+粒子） |
| 动效 | 中等过渡 0.45s |

### 2.2 Nebula（现有 - 保留）

| 属性 | 值 |
|------|-----|
| 主色 | #EC4899 玫瑰粉 |
| 主色浅 | #F472B6 |
| 主色辉光 | rgba(236,72,153,0.35) |
| 背景 | #0D0618 星云紫黑 |
| 表面 | rgba(30,15,40,0.4) |
| 文本主 | #F0E8F0 |
| 文本次 | #B0A3B8 |
| 高亮 | #FBBF24 金色 |
| 收藏 | #EC4899 玫瑰粉 |
| 玻璃模糊 | 24px |
| 3D 场景 | coral-mirage（粒子星云） |
| 动效 | 中等过渡 0.45s |

### 2.3 Aurora（现有 - 保留）

| 属性 | 值 |
|------|-----|
| 主色 | #10B981 翡翠绿 |
| 主色浅 | #34D399 |
| 主色辉光 | rgba(16,185,129,0.35) |
| 背景 | #051A0F 极光深绿 |
| 表面 | rgba(10,40,25,0.4) |
| 文本主 | #E8F0EC |
| 文本次 | #9CB8A8 |
| 高亮 | #FBBF24 金色 |
| 收藏 | #F472B6 粉色 |
| 玻璃模糊 | 24px |
| 3D 场景 | cyber-forest（柱网格+粒子） |
| 动效 | 中等过渡 0.45s |

### 2.4 Cyberpunk（新增）

| 属性 | 值 |
|------|-----|
| 主色 | #00F0FF 霓虹青 |
| 主色浅 | #00D4FF |
| 主色辉光 | rgba(0,240,255,0.5) |
| 次色 | #FF00AA 霓虹粉 |
| 背景 | #0A0A0F 赛博暗黑 |
| 表面 | rgba(15,15,25,0.6) |
| 文本主 | #E0F0FF |
| 文本次 | #607080 |
| 高亮 | #FFD700 霓虹金 |
| 收藏 | #FF00AA 霓虹粉 |
| 玻璃模糊 | 16px |
| 边框 | 1px solid rgba(0,240,255,0.2) |
| 扫描线 | repeating-linear-gradient 效果 |
| 3D 场景 | neon-tokyo（故障+数据流） |
| 动效 | 快速闪烁 0.2s + 发光脉冲 |

**特色效果：**
- 按钮悬停：霓虹发光边框 + 文字阴影
- 卡片：扫描线背景 + 发光边缘
- 文本：text-shadow 多层霓虹辉光
- 背景：网格线 + 移动数据流粒子

### 2.5 Minimal（新增）

| 属性 | 值 |
|------|-----|
| 主色 | #1A1A2E 极简深蓝 |
| 主色浅 | #16213E |
| 主色辉光 | 无 |
| 背景 | #F8F9FA 极简白 |
| 表面 | #FFFFFF 纯白 |
| 文本主 | #1A1A2E |
| 文本次 | #6C757D |
| 高亮 | #0066FF 蓝色链接 |
| 收藏 | #FF3B30 红色 |
| 玻璃模糊 | 无 |
| 阴影 | 0 1px 3px rgba(0,0,0,0.08) |
| 3D 场景 | 无（纯色背景或极简几何） |
| 动效 | 克制过渡 0.25s ease |

**特色效果：**
- 按钮：无边框、纯色填充、hover 微妙变深
- 卡片：白色背景 + 极轻阴影
- 文本：无衬线字体（-apple-system, SF Pro）
- 背景：纯白或极浅灰，无纹理

### 2.6 Neumorphism（新增）

| 属性 | 值 |
|------|-----|
| 主色 | #6C63FF 柔紫 |
| 主色浅 | #7B73FF |
| 主色辉光 | rgba(108,99,255,0.2) |
| 背景 | #E0E5EC 浅灰 |
| 表面 | #E0E5EC 同背景 |
| 文本主 | #2D3436 |
| 文本次 | #636E72 |
| 高亮 | #FF6B6B 珊瑚红 |
| 收藏 | #FF6B9D 粉红 |
| 玻璃模糊 | 无 |
| 凸起阴影 | 6px 6px 12px #b8b9be, -6px -6px 12px #ffffff |
| 凹陷阴影 | inset 6px 6px 12px #b8b9be, inset -6px -6px 12px #ffffff |
| 3D 场景 | minimal-monochrome（柔和几何） |
| 动效 | 弹性过渡 0.35s cubic-bezier(0.25,0.46,0.45,0.94) |

**特色效果：**
- 按钮：凸起效果（亮面左上、暗面右下）
- 卡片：同色凸起或凹陷
- 输入框：凹陷效果
- 背景：纯色无渐变

## 3. 字体规范

| 主题 | 正文 | 标题 | 歌词 |
|------|------|------|------|
| Galaxy | KaiTi, serif | KaiTi, serif | 楷体（艺术） |
| Nebula | KaiTi, serif | KaiTi, serif | 楷体（艺术） |
| Aurora | KaiTi, serif | KaiTi, serif | 楷体（艺术） |
| Cyberpunk | 'Orbitron', monospace | 'Orbitron', monospace | 'Share Tech Mono' |
| Minimal | -apple-system, 'SF Pro', sans-serif | 'SF Pro Display', sans-serif | 'SF Pro Text' |
| Neumorphism | 'Nunito', sans-serif | 'Nunito', sans-serif | 'Nunito' |

## 4. 组件样式映射

### 4.1 播放按钮

| 主题 | 样式 |
|------|------|
| Galaxy/Nebula/Aurora | 圆形、主色渐变、悬停发光 |
| Cyberpunk | 圆角方形、霓虹边框、悬停闪烁 |
| Minimal | 圆形、纯色填充、无阴影 |
| Neumorphism | 圆形、凸起效果、按压凹陷 |

### 4.2 卡片/面板

| 主题 | 样式 |
|------|------|
| Galaxy/Nebula/Aurora | 玻璃拟态、blur(24px)、半透明背景 |
| Cyberpunk | 暗色背景、扫描线纹理、霓虹边框 |
| Minimal | 白色背景、极轻阴影、无边框 |
| Neumorphism | 同色凸起、双阴影 |

### 4.3 搜索栏

| 主题 | 样式 |
|------|------|
| Galaxy/Nebula/Aurora | 胶囊形、毛玻璃背景 |
| Cyberpunk | 直角、霓虹边框、闪烁光标 |
| Minimal | 圆角矩形、浅灰背景 |
| Neumorphism | 胶囊形、凹陷效果 |

## 5. 动效规范

| 主题 | 过渡时长 | 缓动函数 | 特效 |
|------|----------|----------|------|
| Galaxy | 0.45s | cubic-bezier(0.4,0,0.2,1) | 粒子脉冲 |
| Nebula | 0.45s | cubic-bezier(0.4,0,0.2,1) | 星云流动 |
| Aurora | 0.45s | cubic-bezier(0.4,0,0.2,1) | 极光波纹 |
| Cyberpunk | 0.2s | ease-in-out | 故障闪烁、霓虹脉冲 |
| Minimal | 0.25s | ease | 无特效 |
| Neumorphism | 0.35s | cubic-bezier(0.25,0.46,0.45,0.94) | 弹性按压 |

## 6. 3D 场景映射

| UI 主题 | Sonic 主题 | 场景效果 |
|---------|-----------|----------|
| Galaxy | nocturnal | 160x160 柱网格 + 粒子星云 |
| Nebula | coral-mirage | 2000 粒子星云 |
| Aurora | cyber-forest | 柱网格 + 翡翠粒子 |
| Cyberpunk | neon-tokyo | 故障网格 + 数据流粒子 |
| Minimal | 无 3D | 纯色背景或极简几何线条 |
| Neumorphism | minimal-monochrome | 柔和单色柱网格（低对比度） |

## 7. 实施范围

### 7.1 需要修改的文件

**主题系统：**
- `shared/theme-presets.ts` - 新增 3 套主题预设
- `web/src/styles/theme.css` - 新增 CSS 变量
- `web/src/sonic/themes.ts` - 新增 Sonic 主题映射

**组件样式：**
- `web/src/App.css` - 主题相关样式扩展
- `web/src/components/*.css` - 各组件主题适配
- `web/src/pages/*.css` - 各页面主题适配

**主题切换逻辑：**
- `shared/useTheme.ts` - 扩展主题切换

**小程序端：**
- `mini-app/src/components/NebulaBackground.tsx` - 适配新主题

### 7.2 不修改的部分

- 核心业务逻辑不变
- 3D 场景代码结构不变（只新增主题配置）
- 现有三套主题的视觉效果不变
- API 和数据层不变
