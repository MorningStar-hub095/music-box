# 自有版权曲库（local-music）

此目录存放**本人拥有权利或已获授权**的音频文件，是演示模式（`DEMO_MODE=true`）下
唯一可用的音频来源，也可用于本地自托管场景。

## 使用步骤

1. 将音频文件放入本目录（支持 mp3 / flac / wav / m4a / ogg）；
2. 复制 `library.json.example` 为 `library.json`，按实际曲目填写清单；
3. 重启服务，前端通过 `GET /api/library/tracks` 浏览、`GET /api/library/audio/<文件名>` 播放。

## 合规说明

- 请只放入你有权分发的音频（自制、已购商用授权、CC 授权等）；
- 音频文件本身不入 Git（见 .gitignore），随仓库公开的只有本说明与清单模板；
- 服务器部署时如目录不在默认位置，用环境变量 `LOCAL_MUSIC_DIR` 指定。
