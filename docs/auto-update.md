# 桌面应用自动版本更新说明

> 适用版本：桌面版 v1.4.0 起
> 技术方案：electron-updater（generic provider）+ 服务端静态托管目录

## 一、整体流程

```
发布端                                用户端（桌面应用）
──────                                ─────────────────
bump-version.cjs 1.x.y                应用启动（现有打包流程不变）
npm run build:all（server+web）        ├─ 内嵌 PG + 后端子进程（原流程）
npm run stage（组装 desktop/app）      ├─ 窗口创建 + /api/version 更新日志提示（v1.2.0 功能）
npm run dist（electron-builder）       └─ 延迟 5s 检查更新源（electron-updater）
上传 3 个文件到 feed 目录                  ├─ latest.yml 有更高版本 → 弹窗征询
  ├─ MusicBox-Setup-x.y.z.exe          ├─ 用户选「立即更新」→ 自动下载（差量+sha512 校验）
  ├─ MusicBox-Setup-x.y.z.exe.blockmap ├─ 下载完成 → 立即重启安装 / 稍后
  └─ latest.yml（自动生成，含 sha512）   └─ 「稍后」→ 应用退出时自动静默安装
```

现有打包启动流程（内嵌 PostgreSQL → 后端子进程 → 健康检查 → 窗口）完全不变；
自动更新是新增的独立环节，任何失败只写日志，不影响应用正常运行。

## 二、配置项

### 用户端（桌面应用）

| 配置项 | 位置 | 说明 |
|--------|------|------|
| `MB_UPDATE_URL` | 环境变量 | 更新源地址（最高优先级），如 `http://your-server:3000/updates/` |
| `updateFeedUrl` | `%APPDATA%/MusicBox/instance.json` | 实例配置文件中的更新源地址（次优先级，可运维手动编辑） |
| `latest` channel | `desktop/package.json` build.publish | 更新通道，当前固定 latest |

**启用条件**：`app.isPackaged`（仅打包态）且更新源地址非空。二者缺一则完全跳过自动更新（仅保留 v1.2.0 的版本日志提示），开发态永不触发。

### 服务端（更新包托管）

| 配置项 | 说明 |
|--------|------|
| `MB_UPDATES_DIR` 环境变量 | 托管目录绝对路径；默认 `<server>/static/updates`（已随构建自动创建） |
| 路由 `GET /updates/*` | express 静态服务，对外暴露 feed 目录；无需认证，只读 |

### 构建期（electron-builder）

`desktop/package.json` → `build.publish`：

```json
"publish": [{ "provider": "generic", "url": "https://updates.musicbox.local/desktop/", "channel": "latest" }]
```

该 URL 是**打包默认值**（用于生成 latest.yml）；运行期实际使用的更新源以
`MB_UPDATE_URL` / `instance.json.updateFeedUrl` 为准（`setFeedURL` 运行时覆盖），
二者不必相同——例如开发打包时写占位符，部署后再按环境注入真实地址。

## 三、版本号管理方式

1. **单一事实来源**：`server/src/version.ts` 的 `APP_VERSION` + `CHANGELOG`；
2. **一键升版**：`node scripts/bump-version.cjs <x.y.z>` 同步更新
   `server/package.json`、`desktop/package.json`、根 `package.json`、`version.ts` 四处；
3. **每次功能优化 = 一次版本更新**：bump 后在 `version.ts` 的 CHANGELOG 顶部补一条
   记录（version/date/changes），该记录同时出现在 `/api/version` 接口与桌面版
   更新提示弹窗中；
4. **electron-updater 的版本判定**：读取 feed 目录中 latest.yml 的 `version` 字段，
   与 `app.getVersion()`（即 desktop/package.json 的 version）做语义化比较——
   因此发布前必须先 bump-version 再打包，保证 latest.yml 版本 > 已装版本。

## 四、发布操作步骤（完整清单）

```bash
# 1. 升版本 + 补 CHANGELOG
node scripts/bump-version.cjs 1.4.1

# 2. 构建 server 与 web 产物
cd server && npm run build
cd ../web && npm run build
cd .. && node scripts/build-all.js        # 或分别执行上述两步

# 3. 组装桌面应用内嵌产物
npm run stage --prefix desktop            # 有产物新鲜度检查，勿 --force 跳过

# 4. 打包安装器（生成 release/ 下的 3 个更新文件）
cd desktop && npm run dist

# 5. 上传到更新 feed 目录（即 server/static/updates 或 MB_UPDATES_DIR）
#    MusicBox-Setup-1.4.1.exe
#    MusicBox-Setup-1.4.1.exe.blockmap
#    latest.yml
```

## 五、稳定性保障机制

| 机制 | 说明 |
|------|------|
| sha512 完整性校验 | electron-updater 自动校验 latest.yml 中的 sha512，损坏/被篡改的更新包拒绝安装 |
| 差量下载 | blockmap 存在时仅下载变化部分，降低带宽与失败概率 |
| 失败隔离 | 检查/下载/安装任何环节出错只写 `[UPDATE]` 日志，不弹错误框、不阻塞启动与退出 |
| 退出兜底 | `autoInstallOnAppQuit=true`：下载完成但用户选「稍后」，退出时自动静默安装 |
| 幂等提示 | 本会话用户拒绝后不再重复弹窗；`autoDownload=false` 保证未经用户确认不下载 |
| 安装方式 | NSIS 静默安装（`quitAndInstall(true, true)`），装完自动重启应用；用户数据（pgdata、instance.json）位于 userData，不受更新影响 |

## 六、当前局限

- 更新源为 HTTP 时 electron-updater 会要求 `allowDowngrade`/明确配置，生产建议 HTTPS；
- 当前仅支持 Windows NSIS 目标自动更新（portable 便携版不支持自更新，仍走手动替换）；
- 更新源为项目自身服务器托管时，多实例部署需保证各实例 `MB_UPDATES_DIR` 指向同一共享存储，或统一走 nginx/CDN 分发。
