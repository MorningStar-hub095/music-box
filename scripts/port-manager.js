#!/usr/bin/env node

/**
 * Music Box 端口管理模块
 *
 * 功能：
 * 1. 在 IANA 动态端口范围（49152-65535）内为各服务分配端口
 * 2. 启动时动态检测端口可用性
 * 3. 端口被占用时自动寻找下一个可用端口
 * 4. 端口分配结果写入共享配置文件，供所有服务读取
 * 5. 完整的端口分配日志记录
 */

import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const PORT_CONFIG_FILE = path.join(ROOT_DIR, 'logs', '.ports.json');
const LOG_DIR = path.join(ROOT_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'port_manager.log');

// ============================================================
// 端口范围配置
// ============================================================

// IANA 动态/私有端口范围: 49152-65535
const PORT_RANGE_START = 49152;
const PORT_RANGE_END = 65535;

// 各服务首选端口（可在环境变量中覆盖）
const DEFAULT_PORTS = {
  API:     { port: 49200, envKey: 'API_PORT',     name: 'API Server' },
  WEB:     { port: 49201, envKey: 'WEB_PORT',     name: 'Web Player' },
  ADMIN:   { port: 49202, envKey: 'ADMIN_PORT',   name: 'Admin' },
  BROWSE:  { port: 49203, envKey: 'BROWSE_PORT',  name: 'Browse' },
};

// ============================================================
// 日志
// ============================================================

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function writeLog(level, msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${msg}\n`;
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
  } catch (_) {}
}

// ============================================================
// 端口检测
// ============================================================

/**
 * 检查指定端口是否可用
 * @param {number} port
 * @param {string} [host='127.0.0.1']
 * @returns {Promise<boolean>}
 */
export function isPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * 从指定端口开始，寻找第一个可用端口
 * @param {number} startPort
 * @param {string} [host='127.0.0.1']
 * @param {number} [maxAttempts=50]
 * @returns {Promise<number|null>} 可用端口号，或 null（全部被占用）
 */
export async function findAvailablePort(startPort, host = '127.0.0.1', maxAttempts = 50) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (port > PORT_RANGE_END) break;
    if (await isPortAvailable(port, host)) {
      return port;
    }
  }
  return null;
}

// ============================================================
// 端口分配
// ============================================================

/**
 * 为所有服务分配端口
 * @returns {Promise<Object>} 端口分配结果
 */
export async function allocatePorts() {
  ensureLogDir();
  writeLog('INFO', '========== 端口分配开始 ==========');

  const result = {};
  const usedPorts = new Set();
  let hasError = false;

  for (const [key, config] of Object.entries(DEFAULT_PORTS)) {
    const envPort = process.env[config.envKey];
    const preferredPort = envPort ? parseInt(envPort, 10) : config.port;

    writeLog('INFO', `${config.name}: 首选端口 ${preferredPort} (来源: ${envPort ? '环境变量 ' + config.envKey : '默认值'})`);

    // 检查首选端口
    if (!usedPorts.has(preferredPort) && await isPortAvailable(preferredPort)) {
      result[key] = {
        port: preferredPort,
        name: config.name,
        envKey: config.envKey,
        source: envPort ? 'env' : 'default',
      };
      usedPorts.add(preferredPort);
      writeLog('INFO', `  -> 分配端口 ${preferredPort} (首选端口可用)`);
      continue;
    }

    writeLog('WARN', `  -> 首选端口 ${preferredPort} 不可用，开始自动搜索...`);

    // 自动寻找可用端口
    const availablePort = await findAvailablePort(PORT_RANGE_START);
    if (availablePort !== null && !usedPorts.has(availablePort)) {
      result[key] = {
        port: availablePort,
        name: config.name,
        envKey: config.envKey,
        source: 'auto',
      };
      usedPorts.add(availablePort);
      writeLog('INFO', `  -> 自动分配端口 ${availablePort}`);
    } else {
      writeLog('ERROR', `  -> 无法为 ${config.name} 找到可用端口！`);
      hasError = true;
      result[key] = {
        port: preferredPort,
        name: config.name,
        envKey: config.envKey,
        source: 'failed',
        error: '无可用端口',
      };
    }
  }

  // 写入端口配置文件
  try {
    fs.writeFileSync(PORT_CONFIG_FILE, JSON.stringify(result, null, 2), 'utf-8');
    writeLog('INFO', `端口配置已写入: ${PORT_CONFIG_FILE}`);
  } catch (err) {
    writeLog('ERROR', `写入端口配置文件失败: ${err.message}`);
  }

  writeLog('INFO', '========== 端口分配完成 ==========');

  return { ports: result, hasError };
}

/**
 * 读取已分配的端口配置
 * @returns {Object|null}
 */
export function readPortConfig() {
  try {
    if (fs.existsSync(PORT_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(PORT_CONFIG_FILE, 'utf-8'));
    }
  } catch (_) {}
  return null;
}

/**
 * 获取指定服务的端口号
 * 优先读取已分配配置，其次使用环境变量或默认值
 * @param {string} serviceKey - API, WEB, ADMIN, BROWSE
 * @returns {number}
 */
export function getPort(serviceKey) {
  const config = readPortConfig();
  if (config && config[serviceKey]) {
    return config[serviceKey].port;
  }
  const defaultConfig = DEFAULT_PORTS[serviceKey];
  if (!defaultConfig) return 8088;
  const envPort = process.env[defaultConfig.envKey];
  return envPort ? parseInt(envPort, 10) : defaultConfig.port;
}

/**
 * 验证所有端口绑定成功
 * @returns {Promise<Object>} 验证结果
 */
export async function verifyPorts() {
  const config = readPortConfig();
  if (!config) return { success: false, error: '端口配置文件不存在' };

  const results = {};
  let allOk = true;

  for (const [key, info] of Object.entries(config)) {
    const inUse = !(await isPortAvailable(info.port));
    results[key] = { port: info.port, name: info.name, bound: inUse };
    if (!inUse) {
      allOk = false;
      writeLog('WARN', `端口验证: ${info.name} (端口 ${info.port}) 未在监听`);
    } else {
      writeLog('INFO', `端口验证: ${info.name} (端口 ${info.port}) 正在监听`);
    }
  }

  return { success: allOk, results };
}

// ============================================================
// CLI 模式
// ============================================================

const isMain = process.argv[1] && (
  process.argv[1].endsWith('port-manager.js') ||
  process.argv[1].endsWith('port-manager')
);

if (isMain) {
  const action = process.argv[2] || 'allocate';

  if (action === 'allocate') {
    const { ports, hasError } = await allocatePorts();
    console.log('\n端口分配结果:');
    for (const [key, info] of Object.entries(ports)) {
      const status = info.source === 'failed' ? '❌' : '✔';
      console.log(`  ${status} ${info.name}: ${info.port} (${info.source})`);
    }
    if (hasError) process.exit(1);
  } else if (action === 'verify') {
    const { success, results } = await verifyPorts();
    console.log('\n端口验证结果:');
    for (const [key, info] of Object.entries(results)) {
      const status = info.bound ? '✔ 正在监听' : '✗ 未监听';
      console.log(`  ${info.name}: ${info.port} - ${status}`);
    }
    if (!success) process.exit(1);
  } else if (action === 'show') {
    const config = readPortConfig();
    if (config) {
      console.log('\n当前端口配置:');
      for (const [key, info] of Object.entries(config)) {
        console.log(`  ${info.name}: ${info.port}`);
      }
    } else {
      console.log('端口配置文件不存在，请先运行: node scripts/port-manager.js allocate');
    }
  }
}
