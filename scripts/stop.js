#!/usr/bin/env node

/**
 * 停止音乐盒子所有服务（重构版）
 * 共享模块: scripts/env-check.js
 */

import {
  colors,
  log,
  serviceConfig,
  killPortProcess,
} from './env-check.js';

// ============================================================
// 主函数
// ============================================================
async function main() {
  console.log(`\n${colors.bright}🛑 停止音乐盒子服务${colors.reset}\n`);

  const keys = Object.keys(serviceConfig);

  for (const key of keys) {
    const svc = serviceConfig[key];
    const port = svc.port;
    const label = `${svc.icon} ${svc.name}`.padEnd(20);

    log.info(`${label} 端口 ${port} ...`);
    const success = await killPortProcess(port);
    if (success) {
      log.success(`${label} 端口 ${port} 已释放`);
    } else {
      log.warn(`${label} 端口 ${port} 无服务运行`);
    }
  }

  console.log(`\n${colors.green}✅ 所有服务已停止${colors.reset}\n`);
}

main().catch((error) => {
  log.error(`停止服务失败: ${error.message}`);
  process.exit(1);
});
