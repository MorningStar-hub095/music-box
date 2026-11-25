# 桌面版启动慢 / 无响应问题 —— 根因分析与修复记录（v1.4.1）

日期：2026-11-16
影响范围：打包应用版（`部署包-20261111` 及所有既有安装）
修复版本：v1.4.1

## 一、故障现象

- 双击桌面快捷方式「音乐盒子」后**毫无反应**（长达约 2 分钟无任何窗口）；
- 偶尔能打开，但从双击到窗口出现**极慢**；
- 问题自快捷方式生成后（首次部署）持续存在。

## 二、证据链（全部可复查）

### 1. 运行日志时间线（`%APPDATA%\MusicBox\app.log`）

每次启动的 `pg_ctl 启动内嵌实例` → `内嵌实例已就绪` 间隔**恒等于 120.0 秒**：

| 启动时间 | pg_ctl 开始 | 就绪 | 耗时 |
|---|---|---|---|
| 11-11 06:27 | 06:27:52.997 | 06:29:53.121 | 120.1s |
| 11-12 05:29 | 05:29:00.186 | 05:31:00.216 | 120.0s |
| 11-12 11:16 | 11:16:56.507 | 11:18:56.534 | 120.0s |
| 11-12 13:42 | 13:42:21.060 | 13:44:21.114 | 120.0s |
| 11-16 15:38 | 15:38:41.333 | 15:40:41.354 | 120.0s |

120.0s 恰好等于 main.js 中 `execFileAsync` 的 `timeout: 120000` 毫秒——回调是被 Node 超时机制强制放行的。

### 2. PostgreSQL 自身日志（`pgdata/log/`，11-16 15:38 那次启动）

```
15:38:41  正在启动 PostgreSQL 15.19
15:38:41  正在监听 IPv4 地址 "127.0.0.1"，端口 54329
15:38:42  数据库系统准备接受连接
```

**PG 本体 1 秒内就绪**——慢的不是数据库，是 `pg_ctl start` 的返回。

### 3. 受控对照实验（相同 pgbin、相同 pgdata、相同参数）

| 变体 | 启动方式 | 结果 |
|---|---|---|
| A | Node execFile + `windowsHide:true` + 管道 stdio（= 原实现） | **150.0s（恰好 = 超时值）** |
| B | Node execFile + `windowsHide:true` + `stdio:'ignore'` | **60.0s（恰好 = 超时值）** |
| C | Node spawn 管道 stdio，**无 windowsHide** | **5.6s ✓** |
| D | Node spawn `stdio:'ignore'`，**无 windowsHide** | **5.5s ✓** |
| E | 直接 spawn postgres.exe + `windowsHide:true` | TCP 永不就绪（挂死） |
| H | Node spawn `detached:true` + `stdio:'ignore'`（自带控制台） | **2.0s ✓** |

结论：**`windowsHide: true`（Windows 的 CREATE_NO_WINDOW，即进程完全没有控制台）会导致 pg_ctl / postgres.exe 的启动等待逻辑挂死**，直到父进程超时；`stdio: 'ignore'` 单独不能解决问题（变体 B），必须让子进程拥有控制台（detached）。管道 stdio 还存在次生问题：postgres 继承句柄导致 Node 等待 EOF。

## 三、快捷方式本身排查结论（排除嫌疑）

解析 `D:\桌面\音乐盒子.lnk` 二进制（ShellLink 格式）：

- 目标：`D:\music_box\部署包-20261111\MusicBox\MusicBox.exe`（本地盘，存在）
- 工作目录：`D:\music_box\部署包-20261111\MusicBox`（正确）
- 图标：同本地 exe（正确）
- 启动参数：无

快捷方式配置**完全正确**，不是故障原因。"毫无反应" 的真实体验是：应用在启动链路走完（原为 ~133 秒）之前**不创建任何窗口**，期间双击图标看不到任何反馈；由于单实例锁，期间重复点击也会静默退出。

## 四、修复内容（v1.4.1）

`desktop/main.js`（部署包 `resources/app.asar` 同步重建）：

1. **启动方式修复**：`pg_ctl start` 由 `execFileAsync`（管道 + windowsHide）改为 `spawn(..., { detached: true, stdio: 'ignore' })`，绕开 CREATE_NO_WINDOW 挂死问题；
2. **就绪判定修复**：不再依赖 pg_ctl -w 的返回时机，改为协议级就绪探测 `pgProbeOnce()`（纯 Node 实现，与 pg_isready 同语义：发送 StartupMessage，收到 Authentication* 即就绪，SQLSTATE 57P03 "starting up" 继续等待）——不依赖 pg_isready.exe（两套 pgbin 均未携带该二进制）；
3. **启动引导窗口**：新增 splash 窗口，双击图标后立即显示「正在启动数据库 → 正在启动后端服务 → 即将完成」，主窗口就绪后关闭；启动中途关闭引导窗口视为放弃启动，优雅退出。

部署包同步更新：`resources/app.asar`（main.js + package.json v1.4.1，备份 `app.asar.bak-v1.1.0` 保留）、`resources/server/dist`（v1.4.1，含推荐算法优化与 /api/version、/updates 路由）。

## 五、修复后验证

集成测试（精确复刻修复后 startPgServer + 探测逻辑，真实 pgdata）：

```
[0.1s] status: 未运行
[0.1s] pg_ctl 启动内嵌实例, port= 54329
[7.4s] 内嵌实例已就绪（协议级确认）   ← 本次含前次强杀后的 WAL 崩溃恢复；干净启动约 2s
[8.0s] 真实查询成功, 曲库歌曲数 = 1260
[8.2s] 已停止
INTEGRATION_OK 端到端耗时 8.2 s
```

对照：修复前同链路 120s（pg_ctl）+ 13s（后端健康检查）≈ **133s**；修复后 PG 就绪 2~7s + 后端 10~13s ≈ **12~20s**，且全程有引导窗口反馈。

## 六、遗留说明

- 沙箱/非交互会话中无法完整初始化 Electron GUI（原始 v1.1.0 与修复版在该环境下表现一致），完整的真实双击验证需在用户桌面进行；启动链路各环节均已用受控实验单独验证。
- 旧版 `pg.log` 中「版本不匹配 / 拒绝访问」记录为 11-09~11-11 期间旧部署包二进制（PG17 与 PG15 数据目录混用）的历史问题，与本次故障无关，现已不存在（部署包 pgbin 与 pgdata 均为 PG 15.19）。

## 七、追加修复（v1.4.2）：启动后弹出 cmd 控制台窗口

日期：2026-11-16。用户反馈：通过快捷方式启动应用后，弹出一个 cmd 控制台窗口。

### 排查过程（证据链）

1. **快捷方式本身**：目标 `D:\music_box\部署包-20261111\MusicBox\MusicBox.exe`（GUI 子系统，无控制台），已再次排除嫌疑。
2. **PG 启动链路（detached pg_ctl）**：受控实验 + 在真实交互桌面会话中以 EnumWindows 轮询可见窗口（以微信/Edge 等真实窗口校准过枚举器），postgres.exe 存活 25 秒期间**未出现任何** postgres/pg_ctl/conhost 控制台窗口。原因：pg_ctl 启动 postmaster 时显式设置 `STARTF_USESHOWWINDOW + SW_HIDE`，postgres 不会显示控制台。**PG 链路排除。**
3. **真正根因**：`server/src/scheduler.ts` 爬虫依赖预检 `execFile('python', ['-c', 'import requests'])` **未设 windowsHide**。桌面版后端进程 = GUI 子系统的 MusicBox.exe（ELECTRON_RUN_AS_NODE），自身无控制台；从无控制台的父进程 spawn 控制台程序（python.exe）且不带 CREATE_NO_WINDOW 时，Windows 会为子进程**新建可见控制台窗口**。该预检在每次应用启动 60 秒后（每日首个 checkAndRun）触发，且 python 预检在本机可用（app.log 中 python 实际运行过），因此每次启动约 1 分钟后闪现黑窗口。
4. 佐证：同类问题 2026-08-09 已在 `python-runner.ts` 修复过（runPython 统一 windowsHide:true，注释原文「修复 Python 窗口增殖问题」），scheduler 的独立 execFile 调用是漏网之鱼。

### 修复内容（v1.4.2）

- `server/src/scheduler.ts`：预检 execFile 补 `windowsHide: true`；
- `desktop/main.js`：首次运行解压内置集群的 `execFileSync(tar.exe)` 补 `windowsHide: true`（消除首次启动闪窗）；
- 版本 1.4.2，CHANGELOG 已记录；server/dist 同步至 `desktop/app/server/dist` 与 `部署包-20261111/MusicBox/resources/server/dist`；部署包 app.asar 已重建（含新 main.js + package.json v1.4.2）。

### 遗留

- 沙箱环境无法启动 Electron GUI 进行端到端验证（MusicBox.exe 从工具会话中无法完成初始化），需用户真实桌面验证：启动应用并保持运行 1 分钟以上，不应再出现任何控制台窗口。
- 部署包 `resources/server/tools-stub/` 目录缺失，导致启动时的分类歌单爬取必然失败（仅日志报错，无窗口）。后续构建应纳入该目录或跳过爬取初始化。
