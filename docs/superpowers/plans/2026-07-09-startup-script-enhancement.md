# 启动脚本增强实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增强启动脚本，实现完整的服务启动流程，包含环境检查、健康检查、自动重试、日志记录等功能

**Architecture:** 使用 Node.js 脚本实现启动流程控制，支持并行启动非依赖服务，串行启动有依赖关系的服务，提供详细的启动状态反馈

**Tech Stack:** Node.js, child_process, net, fs

---

## 文件结构

```
d:\music_box\
├── scripts\
│   ├── start.js          # 主启动脚本
│   ├── health.js         # 健康检查脚本
│   ├── stop.js           # 停止服务脚本
│   ├── install.js        # 依赖安装脚本
│   └── build.js          # 项目构建脚本
├── logs\                 # 日志目录
│   └── startup.log       # 启动日志文件
└── package.json          # 根目录配置
```

---

### Task 1: 增强启动脚本

**Files:**
- Modify: `d:\music_box\scripts\start.js`

- [ ] **Step 1: 读取现有启动脚本**

```bash
# 检查现有脚本内容
cat d:\music_box\scripts\start.js
```

- [ ] **Step 2: 创建增强版启动脚本**

替换 `d:\music_box\scripts\start.js` 为以下内容：

```javascript
#!/usr/bin/env node

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import net from 'net';
import fs from 'fs';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'startup.log');

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

// 日志工具
const logger = {
  _writeToFile: (level, msg) => {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE, logLine);
  },
  info: (msg) => {
    console.log(`${colors.cyan}[INFO]${colors.reset} ${msg}`);
    logger._writeToFile('INFO', msg);
  },
  success: (msg) => {
    console.log(`${colors.green}[✓]${colors.reset} ${msg}`);
    logger._writeToFile('SUCCESS', msg);
  },
  warn: (msg) => {
    console.log(`${colors.yellow}[!]${colors.reset} ${msg}`);
    logger._writeToFile('WARN', msg);
  },
  error: (msg) => {
    console.log(`${colors.red}[✗]${colors.reset} ${msg}`);
    logger._writeToFile('ERROR', msg);
  },
  step: (msg) => {
    console.log(`${colors.blue}[→]${colors.reset} ${msg}`);
    logger._writeToFile('STEP', msg);
  },
  progress: (current, total, msg) => {
    const percent = Math.round((current / total) * 100);
    const bar = '█'.repeat(Math.round(percent / 5)) + '░'.repeat(20 - Math.round(percent / 5));
    process.stdout.write(`\r${colors.cyan}[${bar}]${colors.reset} ${percent}% ${msg}`);
    if (current === total) console.log('');
  },
};

// 服务配置
const services = {
  api: {
    name: 'API Server',
    port: 3000,
    dir: path.join(ROOT_DIR, 'server'),
    command: 'npm',
    args: ['run', 'dev'],
    healthUrl: 'http://localhost:3000/health',
    healthTimeout: 30000,
    retryCount: 3,
    retryDelay: 2000,
    dependencies: ['database'],
  },
  web: {
    name: 'Web Player',
    port: 5173,
    dir: path.join(ROOT_DIR, 'web'),
    command: 'npm',
    args: ['run', 'dev'],
    healthTimeout: 15000,
    retryCount: 3,
    retryDelay: 2000,
    dependencies: ['api'],
  },
  admin: {
    name: 'Admin',
    port: 5174,
    dir: path.join(ROOT_DIR, 'web', 'admin'),
    command: 'npm',
    args: ['run', 'dev'],
    healthTimeout: 15000,
    retryCount: 3,
    retryDelay: 2000,
    dependencies: ['api'],
  },
  browse: {
    name: 'Browse',
    port: 5175,
    dir: path.join(ROOT_DIR, 'web', 'browse'),
    command: 'npm',
    args: ['run', 'dev'],
    healthTimeout: 15000,
    retryCount: 3,
    retryDelay: 2000,
    dependencies: ['api'],
  },
};

// 检查端口是否可用
async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

// 等待端口被占用（服务启动）
async function waitForPort(port, timeout = 30000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (!(await isPortAvailable(port))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

// HTTP 健康检查
async function healthCheck(url, timeout = 5000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response.ok;
  } catch (e) {
    return false;
  }
}

// 检查数据库连接
async function checkDatabase() {
  logger.step('检查数据库连接...');
  try {
    await execAsync('npx prisma db pull --print', {
      cwd: path.join(ROOT_DIR, 'server'),
      timeout: 10000,
    });
    logger.success('数据库连接正常');
    return true;
  } catch (error) {
    logger.error('数据库连接失败');
    logger.warn('请确保 MySQL 服务已启动，并检查 server/.env 配置');
    return false;
  }
}

// 检查 Redis 连接
async function checkRedis() {
  logger.step('检查 Redis 连接...');
  try {
    // 简单的 Redis 连接检查
    const { default: redis } = await import('ioredis').catch(() => ({ default: null }));
    if (!redis) {
      logger.warn('Redis 客户端未安装，跳过检查');
      return true;
    }
    const client = new redis(process.env.REDIS_URL || 'redis://localhost:6379');
    await client.ping();
    await client.quit();
    logger.success('Redis 连接正常');
    return true;
  } catch (error) {
    logger.warn('Redis 连接失败，某些功能可能不可用');
    return true; // Redis 不是必需的，继续启动
  }
}

// 检查 Node.js 版本
async function checkNodeVersion() {
  logger.step('检查 Node.js 版本...');
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0]);
  if (major < 18) {
    logger.error(`Node.js 版本过低: ${version}，需要 >= 18.0.0`);
    return false;
  }
  logger.success(`Node.js 版本: ${version}`);
  return true;
}

// 检查 npm 依赖
async function checkDependencies() {
  logger.step('检查 npm 依赖...');
  const dirs = ['server', 'web', 'web/admin', 'web/browse'];

  for (const dir of dirs) {
    const nodeModulesPath = path.join(ROOT_DIR, dir, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
      logger.warn(`${dir}/node_modules 不存在，请运行 npm run install:all`);
      return false;
    }
  }

  logger.success('所有依赖已安装');
  return true;
}

// 生成 Prisma Client
async function generatePrisma() {
  logger.step('生成 Prisma Client...');
  try {
    await execAsync('npx prisma generate', {
      cwd: path.join(ROOT_DIR, 'server'),
      timeout: 30000,
    });
    logger.success('Prisma Client 已生成');
    return true;
  } catch (error) {
    logger.error('Prisma Client 生成失败');
    return false;
  }
}

// 启动单个服务（带重试）
async function startServiceWithRetry(config, retryCount = 0) {
  const maxRetries = config.retryCount || 3;
  const retryDelay = config.retryDelay || 2000;

  try {
    return await startService(config);
  } catch (error) {
    if (retryCount < maxRetries) {
      logger.warn(`${config.name} 启动失败，${retryDelay / 1000}秒后重试 (${retryCount + 1}/${maxRetries})...`);
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      return startServiceWithRetry(config, retryCount + 1);
    } else {
      throw error;
    }
  }
}

// 启动单个服务
function startService(config) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const command = isWindows ? `${config.command}.cmd` : config.command;

    const child = spawn(command, config.args, {
      cwd: config.dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env, FORCE_COLOR: 'true' },
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        started = true;
        resolve(child);
      }
    }, config.healthTimeout || 10000);

    child.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('ready') || output.includes('Local:') || output.includes('localhost')) {
        if (!started) {
          started = true;
          clearTimeout(timeout);
          resolve(child);
        }
      }
    });

    child.stderr.on('data', (data) => {
      const output = data.toString();
      if (output.includes('VITE') || output.includes('ready') || output.includes('Local:')) {
        if (!started) {
          started = true;
          clearTimeout(timeout);
          resolve(child);
        }
      }
    });

    child.on('error', (error) => {
      if (!started) {
        started = true;
        clearTimeout(timeout);
        reject(error);
      }
    });

    child.on('exit', (code) => {
      if (code !== null && code !== 0 && !started) {
        started = true;
        clearTimeout(timeout);
        reject(new Error(`进程退出，代码: ${code}`));
      }
    });
  });
}

// 打开浏览器
function openBrowser(url) {
  const isWindows = process.platform === 'win32';
  const command = isWindows ? 'start' : 'open';
  exec(`${command} ${url}`, (error) => {
    if (error) {
      logger.warn(`无法自动打开浏览器: ${url}`);
    }
  });
}

// 显示服务状态表格
function showStatusTable(servicesStatus) {
  console.log('\n' + colors.bright + '╔══════════════════════════════════════════════════════════════╗' + colors.reset);
  console.log(colors.bright + '║                      📊 服务状态                             ║' + colors.reset);
  console.log(colors.bright + '╠══════════════════════════════════════════════════════════════╣' + colors.reset);

  for (const { name, port, status, url } of servicesStatus) {
    const statusIcon = status === 'running' ? `${colors.green}● 运行中` : `${colors.red}● 已停止`;
    const statusStr = statusIcon.padEnd(20) + colors.reset;
    const nameStr = name.padEnd(15);
    const portStr = `:${port}`.padEnd(8);
    console.log(`║  ${statusStr}${nameStr}${portStr}${url || ''}  ║`);
  }

  console.log(colors.bright + '╚══════════════════════════════════════════════════════════════╝' + colors.reset);
}

// 主函数
async function main() {
  const startTime = Date.now();
  const args = process.argv.slice(2);
  const isDev = args.includes('--dev');
  const isApiOnly = args.includes('--api-only');
  const skipChecks = args.includes('--skip-checks');

  console.log('\n' + colors.bright + '╔══════════════════════════════════════════════════════════════╗' + colors.reset);
  console.log(colors.bright + '║                    🎵 音乐盒子启动器                         ║' + colors.reset);
  console.log(colors.bright + '╚══════════════════════════════════════════════════════════════╝' + colors.reset + '\n');

  logger.info(`启动模式: ${isApiOnly ? '仅 API' : isDev ? '开发模式' : '完整模式'}`);
  logger.info(`日志文件: ${LOG_FILE}\n`);

  // 环境检查
  if (!skipChecks) {
    console.log(colors.bright + '━━━ 环境检查 ━━━' + colors.reset);

    const nodeOk = await checkNodeVersion();
    if (!nodeOk) {
      process.exit(1);
    }

    const depsOk = await checkDependencies();
    if (!depsOk) {
      logger.error('请先安装依赖: npm run install:all');
      process.exit(1);
    }

    const dbOk = await checkDatabase();
    if (!dbOk) {
      process.exit(1);
    }

    await checkRedis();

    // 生成 Prisma Client
    const prismaOk = await generatePrisma();
    if (!prismaOk) {
      process.exit(1);
    }
  }

  // 确定要启动的服务
  const servicesToStart = isApiOnly
    ? ['api']
    : isDev
      ? ['api', 'web', 'admin']
      : ['api', 'web', 'admin', 'browse'];

  console.log('\n' + colors.bright + '━━━ 启动服务 ━━━' + colors.reset);

  // 启动服务
  const processes = [];
  const servicesStatus = [];

  for (const serviceKey of servicesToStart) {
    const config = services[serviceKey];
    logger.step(`启动 ${config.name}...`);

    try {
      const child = await startServiceWithRetry(config);
      processes.push({ key: serviceKey, process: child, config });
      servicesStatus.push({
        name: config.name,
        port: config.port,
        status: 'running',
        url: `http://localhost:${config.port}`,
      });
      logger.success(`${config.name} 已启动 (端口 ${config.port})`);
    } catch (error) {
      servicesStatus.push({
        name: config.name,
        port: config.port,
        status: 'stopped',
        url: null,
      });
      logger.error(`${config.name} 启动失败: ${error.message}`);
    }
  }

  // 等待 API Server 就绪
  if (servicesToStart.includes('api')) {
    logger.step('等待 API Server 就绪...');
    const apiReady = await waitForPort(3000, 15000);
    if (apiReady) {
      logger.success('API Server 已就绪');
    } else {
      logger.warn('API Server 启动超时');
    }
  }

  // 打开浏览器
  if (servicesToStart.includes('web')) {
    logger.step('打开 Web Player...');
    setTimeout(() => {
      openBrowser('http://localhost:5173');
    }, 2000);
  }

  // 显示状态表格
  showStatusTable(servicesStatus);

  // 显示启动时间
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n${colors.dim}启动耗时: ${duration}秒${colors.reset}`);
  console.log(`${colors.dim}日志文件: ${LOG_FILE}${colors.reset}`);
  console.log(`${colors.bright}按 Ctrl+C 停止所有服务${colors.reset}\n`);

  // 优雅退出
  process.on('SIGINT', () => {
    console.log('\n' + colors.yellow + '正在停止所有服务...' + colors.reset);
    for (const { process: child, config } of processes) {
      child.kill();
      logger.info(`${config.name} 已停止`);
    }
    logger.info('所有服务已停止');
    process.exit(0);
  });

  // 保持进程运行
  await new Promise(() => {});
}

main().catch((error) => {
  logger.error(`启动失败: ${error.message}`);
  process.exit(1);
});
```

- [ ] **Step 3: 测试启动脚本**

```bash
cd d:\music_box
npm run health
```

预期输出：健康检查脚本正常运行

- [ ] **Step 4: 测试完整启动**

```bash
cd d:\music_box
npm run start:dev
```

预期输出：
- 环境检查通过
- 服务启动成功
- 状态表格显示
- 浏览器打开

- [ ] **Step 5: 提交代码**

```bash
cd d:\music_box
git add scripts/start.js
git commit -m "feat: enhance startup script with retry, logging, and status table"
```

---

### Task 2: 增强健康检查脚本

**Files:**
- Modify: `d:\music_box\scripts\health.js`

- [ ] **Step 1: 读取现有健康检查脚本**

```bash
cat d:\music_box\scripts\health.js
```

- [ ] **Step 2: 创建增强版健康检查脚本**

替换 `d:\music_box\scripts\health.js` 为以下内容：

```javascript
#!/usr/bin/env node

import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

// 服务配置
const services = [
  { name: 'API Server', port: 3000, url: 'http://localhost:3000/health', required: true },
  { name: 'Web Player', port: 5173, required: false },
  { name: 'Admin', port: 5174, required: false },
  { name: 'Browse', port: 5175, required: false },
];

// 检查端口
async function checkPort(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, 'localhost');
  });
}

// HTTP 健康检查
async function healthCheck(url, timeout = 5000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return { ok: response.ok, status: response.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 检查日志文件
function checkLogFile() {
  const logFile = path.join(ROOT_DIR, 'logs', 'startup.log');
  if (fs.existsSync(logFile)) {
    const stats = fs.statSync(logFile);
    const size = (stats.size / 1024).toFixed(2);
    const lastModified = stats.mtime.toLocaleString('zh-CN');
    return { exists: true, size: `${size} KB`, lastModified };
  }
  return { exists: false };
}

// 主函数
async function main() {
  console.log('\n' + colors.bright + '╔══════════════════════════════════════════════════════════════╗' + colors.reset);
  console.log(colors.bright + '║                    🏥 音乐盒子健康检查                       ║' + colors.reset);
  console.log(colors.bright + '╚══════════════════════════════════════════════════════════════╝' + colors.reset + '\n');

  let allHealthy = true;
  let requiredHealthy = true;
  const results = [];

  for (const service of services) {
    const portOk = await checkPort(service.port);
    let healthOk = null;

    if (portOk && service.url) {
      healthOk = await healthCheck(service.url);
    }

    const status = portOk ? (healthOk && !healthOk.ok ? 'degraded' : 'running') : 'stopped';
    const icon = status === 'running' ? `${colors.green}✓` :
                 status === 'degraded' ? `${colors.yellow}!` :
                 `${colors.red}✗`;

    results.push({
      name: service.name,
      port: service.port,
      status,
      icon,
      required: service.required,
      health: healthOk,
    });

    if (status !== 'running') {
      allHealthy = false;
      if (service.required) {
        requiredHealthy = false;
      }
    }
  }

  // 显示结果表格
  console.log(colors.bright + '┌─────────────────────────────────────────────────────────────┐' + colors.reset);
  console.log(colors.bright + '│  服务名称              端口    状态                          │' + colors.reset);
  console.log(colors.bright + '├─────────────────────────────────────────────────────────────┤' + colors.reset);

  for (const { name, port, status, icon, required } of results) {
    const statusText = status === 'running' ? '运行中' :
                       status === 'degraded' ? '异常' :
                       '未运行';
    const requiredText = required ? ' [必需]' : '';
    const nameStr = (name + requiredText).padEnd(25);
    const portStr = `:${port}`.padEnd(10);
    console.log(`│  ${icon} ${colors.reset}${nameStr}${portStr}${statusText.padEnd(15)}│`);
  }

  console.log(colors.bright + '└─────────────────────────────────────────────────────────────┘' + colors.reset);

  // 检查日志文件
  const logInfo = checkLogFile();
  console.log('\n' + colors.bright + '日志文件:' + colors.reset);
  if (logInfo.exists) {
    console.log(`  ${colors.green}✓${colors.reset} ${logInfo.size} - 最后更新: ${logInfo.lastModified}`);
  } else {
    console.log(`  ${colors.yellow}!${colors.reset} 日志文件不存在`);
  }

  // 总结
  console.log('\n' + colors.bright + '总结:' + colors.reset);
  if (allHealthy) {
    console.log(`  ${colors.green}✅ 所有服务运行正常${colors.reset}`);
  } else if (requiredHealthy) {
    console.log(`  ${colors.yellow}⚠️  部分非必需服务未运行${colors.reset}`);
  } else {
    console.log(`  ${colors.red}❌ 必需服务未运行${colors.reset}`);
  }

  console.log('');
  process.exit(requiredHealthy ? 0 : 1);
}

main();
```

- [ ] **Step 3: 测试健康检查脚本**

```bash
cd d:\music_box
npm run health
```

预期输出：健康检查结果表格

- [ ] **Step 4: 提交代码**

```bash
cd d:\music_box
git add scripts/health.js
git commit -m "feat: enhance health check script with detailed status table"
```

---

## 总结

本计划包含以下任务：

1. **Task 1: 增强启动脚本**
   - 环境检查（Node.js、依赖、数据库、Redis）
   - 代码准备（Prisma 生成）
   - 服务启动（带重试机制）
   - 健康检查
   - 日志记录（控制台+文件）
   - 状态表格显示
   - 自动打开浏览器

2. **Task 2: 增强健康检查脚本**
   - 端口检查
   - HTTP 健康检查
   - 日志文件检查
   - 详细状态表格

**执行方式：**
- Subagent-Driven（推荐）：逐任务执行，每个任务完成后进行 review
- Inline Execution：在当前会话中批量执行
