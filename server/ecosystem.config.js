/**
 * PM2 进程守护配置（非 Docker 部署方案）
 *
 * 使用方式：
 *   1. npm i -g pm2
 *   2. npm run build
 *   3. pm2 start ecosystem.config.js
 *   4. pm2 save && pm2 startup   # 开机自启
 *
 * 功能：
 *   - 进程意外退出后自动重启（autorestart）
 *   - 内存超限自动重启（max_memory_restart）
 *   - 连续崩溃次数限制（max_restarts，超过后停止以避免无限重启）
 *   - 日志持久化（out_file / error_file）
 */
module.exports = {
  apps: [
    {
      name: 'music-box-api',
      script: 'dist/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        // 注意：不在此写死 PORT，交由 server/.env（PORT=49200）决定，
        // 避免 PM2 环境变量覆盖 .env 导致与 Electron 壳（固定轮询 49200）不一致。
      },
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
