# 更新包托管目录（自动更新 feed）

发布时将以下文件放入本目录：
- MusicBox-Setup-x.y.z.exe（NSIS 安装包）
- MusicBox-Setup-x.y.z.exe.blockmap（差量下载元数据）
- latest.yml（electron-builder 自动生成的版本元数据，含 sha512）

桌面版 electron-updater 将从 http://<host>:<port>/updates/latest.yml 检测并下载更新。
