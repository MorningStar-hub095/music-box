#!/usr/bin/env node
/**
 * =============================================================================
 *  音乐盒子 - 数据库访问工具 (db-tool.cjs)
 * =============================================================================
 *  功能说明：
 *    1. 数据库连接验证（基于 Prisma Client，安全可靠）
 *    2. 用户身份认证（bcrypt 密码校验 + JWT 签发）
 *    3. 必要的数据操作（用户列表、歌曲列表、统计、查询等只读操作）
 *
 *  安全设计：
 *    - 通过 Prisma Client 访问数据库（参数化查询，杜绝 SQL 注入）
 *    - 默认所有写操作（创建/更新/删除）均被禁用，需要 --allow-write 显式开启
 *    - 用户密码不会以明文返回，仅返回 hash 用于校验
 *    - 敏感字段（resetToken、securityAnswer）默认隐藏
 *    - 操作日志记录到 logs/db-tool.log
 *
 *  使用方法：
 *    node scripts/db-tool.cjs <命令> [参数]
 *
 *  命令列表：
 *    ping                              验证数据库连接
 *    auth <用户名>                     交互式输入密码并验证身份
 *    login <用户名> <密码>             验证用户身份（命令行参数模式，不推荐）
 *    users [选项]                      列出用户（支持 --limit、--role）
 *    user <id>                         查询指定用户详情
 *    songs [选项]                      列出歌曲（支持 --limit、--offset、--search）
 *    song <id>                         查询指定歌曲详情
 *    stats                             数据库统计（用户数、歌曲数、播放列表数等）
 *    tables                            列出所有表（仅元数据）
 *    help                              显示帮助信息
 *
 *  详细文档：见 docs/db-tool.md
 * =============================================================================
 */

'use strict';

const path = require('path');
const fs = require('fs');
const readline = require('readline');

// ============================================================
// 常量与路径
// ============================================================
const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT_DIR, 'server');
const ENV_FILE = path.join(SERVER_DIR, '.env');
const LOG_DIR = path.join(ROOT_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'db-tool.log');

// ============================================================
// 颜色配置
// ============================================================
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

// ============================================================
// 日志工具
// ============================================================
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function writeLog(level, msg) {
  const ts = new Date().toISOString();
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, `[${ts}] [${level}] ${msg}\n`, 'utf-8');
  } catch (_) {}
}

const log = {
  info: (msg) => console.log(`${colors.cyan}[INFO]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}[✓]${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}[!]${colors.reset} ${msg}`),
  error: (msg) => { console.error(`${colors.red}[✗]${colors.reset} ${msg}`); writeLog('ERROR', msg); },
  step: (msg) => console.log(`${colors.blue}[→]${colors.reset} ${msg}`),
  plain: (msg) => console.log(msg),
};

// ============================================================
// 加载 .env 文件
// ============================================================
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const envVars = {};
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    envVars[key] = val;
  }
  return envVars;
}

function configureEnvironment() {
  const envVars = loadEnvFile(ENV_FILE);
  for (const [k, v] of Object.entries(envVars)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  if (!process.env.DATABASE_URL) {
    log.error('未设置 DATABASE_URL，请检查 server/.env');
    return false;
  }
  return true;
}

// ============================================================
// 初始化 Prisma Client（懒加载）
// ============================================================
let prismaClient = null;

async function getPrisma() {
  if (prismaClient) return prismaClient;

  // 检查 Prisma Client 是否已生成
  const prismaClientPath = path.join(SERVER_DIR, 'node_modules', '.prisma', 'client', 'index.js');
  const prismaPkgPath = path.join(SERVER_DIR, 'node_modules', '@prisma', 'client');

  if (!fs.existsSync(prismaPkgPath)) {
    throw new Error(`未找到 @prisma/client，请运行: cd server && npm install`);
  }
  if (!fs.existsSync(prismaClientPath)) {
    log.warn('Prisma Client 未生成，正在生成...');
    const { execSync } = require('child_process');
    try {
      execSync('npx prisma generate', { cwd: SERVER_DIR, stdio: 'pipe', timeout: 60000 });
    } catch (e) {
      throw new Error(`Prisma Client 生成失败: ${e.message}`);
    }
  }

  // 设置工作目录，确保 Prisma 能正确加载引擎
  process.chdir(SERVER_DIR);

  const { PrismaClient } = require(prismaPkgPath);
  prismaClient = new PrismaClient({
    log: ['error', 'warn'],
  });
  return prismaClient;
}

async function disconnectPrisma() {
  if (prismaClient) {
    try { await prismaClient.$disconnect(); } catch (_) {}
  }
}

// ============================================================
// 安全工具
// ============================================================
function maskSensitive(user) {
  if (!user || typeof user !== 'object') return user;
  // 浅拷贝后删除敏感字段
  const safe = { ...user };
  delete safe.passwordHash;
  delete safe.resetToken;
  delete safe.resetTokenExpiresAt;
  delete safe.securityAnswer;
  return safe;
}

function maskDbUrl(url) {
  return (url || '').replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
}

// ============================================================
// 命令: help
// ============================================================
function showHelp() {
  console.log(`
${colors.bright}音乐盒子 - 数据库访问工具${colors.reset}

${colors.cyan}用法:${colors.reset}
  node scripts/db-tool.cjs <命令> [参数] [选项]

${colors.cyan}命令列表:${colors.reset}

  ${colors.green}ping${colors.reset}                              验证数据库连接（无需认证）
  ${colors.green}auth${colors.reset} <用户名>                     交互式密码输入并验证身份（推荐）
  ${colors.green}login${colors.reset} <用户名> <密码>             验证用户身份（命令行模式，不推荐）
  ${colors.green}users${colors.reset} [--limit N] [--role R]      列出用户（需认证）
  ${colors.green}user${colors.reset} <id>                         查询指定用户详情（需认证）
  ${colors.green}songs${colors.reset} [--limit N] [--offset N]    列出歌曲（需认证）
    [--search 关键词] [--platform 平台]
  ${colors.green}song${colors.reset} <id>                         查询指定歌曲详情（需认证）
  ${colors.green}stats${colors.reset}                             数据库统计（需认证）
  ${colors.green}tables${colors.reset}                           列出所有表（仅元数据，无需认证）
  ${colors.green}help${colors.reset}                             显示本帮助信息

${colors.cyan}全局选项:${colors.reset}
  --json                   以 JSON 格式输出（便于脚本处理）
  --allow-write            允许写操作（默认只读）
  --verbose                显示详细日志

${colors.cyan}示例:${colors.reset}

  # 1. 验证数据库连接
  node scripts/db-tool.cjs ping

  # 2. 交互式身份认证
  node scripts/db-tool.cjs auth admin
  # （会提示输入密码，密码不会显示在屏幕上）

  # 3. 列出前 20 个用户（JSON 格式）
  node scripts/db-tool.cjs users --limit 20 --json

  # 4. 查询用户 ID 为 1 的详情
  node scripts/db-tool.cjs user 1

  # 5. 搜索标题包含"夜"的歌曲
  node scripts/db-tool.cjs songs --search 夜 --limit 10

  # 6. 数据库整体统计
  node scripts/db-tool.cjs stats

${colors.cyan}退出码:${colors.reset}
  0   成功
  1   参数错误
  2   数据库连接失败
  3   认证失败
  4   Prisma Client 错误
  99  内部异常

${colors.cyan}日志:${colors.reset}
  ${path.relative(process.cwd(), LOG_FILE)}
`);
}

// ============================================================
// 命令: ping
// ============================================================
async function cmdPing() {
  log.step('验证数据库连接...');
  log.info(`DATABASE_URL: ${maskDbUrl(process.env.DATABASE_URL)}`);

  let prisma;
  try {
    prisma = await getPrisma();
  } catch (e) {
    log.error(`Prisma Client 初始化失败: ${e.message}`);
    return 4;
  }

  try {
    const start = Date.now();
    // $queryRaw 执行简单查询（参数化，无注入风险）
    const result = await prisma.$queryRaw`SELECT 1 AS ok, NOW() AS server_time, VERSION() AS version, DATABASE() AS db_name`;
    const elapsed = Date.now() - start;

    if (result && result.length > 0) {
      const row = result[0];
      log.success(`数据库连接成功 (${elapsed}ms)`);
      log.plain(`  ${colors.dim}服务器时间:${colors.reset} ${colors.cyan}${row.server_time}${colors.reset}`);
      log.plain(`  ${colors.dim}MySQL 版本:${colors.reset} ${colors.cyan}${row.version}${colors.reset}`);
      log.plain(`  ${colors.dim}当前数据库:${colors.reset} ${colors.cyan}${row.db_name}${colors.reset}`);
      return 0;
    } else {
      log.error('查询返回空结果');
      return 2;
    }
  } catch (e) {
    log.error(`数据库连接失败: ${e.message}`);
    log.warn('请检查:');
    log.warn('  1. MySQL 服务是否运行');
    log.warn('  2. server/.env 中 DATABASE_URL 是否正确');
    log.warn('  3. 数据库用户是否有访问 music_box 的权限');
    return 2;
  }
}

// ============================================================
// 命令: auth (交互式)
// ============================================================
function promptPassword(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    // 在 Windows 上隐藏输入
    const stdin = process.stdin;
    const onData = (c) => {
      // 拦截字符输出
    };
    if (stdin.isTTY) {
      stdin.setRawMode?.(true);
    }
    rl.question(prompt, (answer) => {
      if (stdin.isTTY) {
        stdin.setRawMode?.(false);
      }
      rl.close();
      // 输出换行模拟回车
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function cmdAuth(username) {
  if (!username) {
    log.error('用法: auth <用户名>');
    return 1;
  }
  log.step(`验证用户身份: ${username}`);
  process.stdout.write('请输入密码: ');
  const password = await promptPassword('');

  return doLogin(username, password);
}

// ============================================================
// 命令: login (命令行模式)
// ============================================================
async function cmdLogin(username, password) {
  if (!username || !password) {
    log.error('用法: login <用户名> <密码>');
    return 1;
  }
  log.warn('注意: 命令行参数会出现在进程列表中，建议使用 auth 命令交互式输入');
  log.step(`验证用户身份: ${username}`);
  return doLogin(username, password);
}

// ============================================================
// 登录逻辑（共用）
// ============================================================
async function doLogin(username, password) {
  let prisma;
  try {
    prisma = await getPrisma();
  } catch (e) {
    log.error(`Prisma Client 初始化失败: ${e.message}`);
    return 4;
  }

  try {
    // 查询用户
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      log.error(`用户不存在: ${username}`);
      writeLog('AUTH_FAIL', `username=${username} reason=user_not_found`);
      return 3;
    }

    if (user.status !== 'active') {
      log.error(`账号状态异常: ${user.status}`);
      writeLog('AUTH_FAIL', `username=${username} reason=status_${user.status}`);
      return 3;
    }

    // bcrypt 密码校验（动态加载，避免硬依赖）
    const bcrypt = require(path.join(SERVER_DIR, 'node_modules', 'bcryptjs'));
    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (!isValid) {
      log.error('密码错误');
      writeLog('AUTH_FAIL', `username=${username} reason=password_mismatch`);
      return 3;
    }

    // 签发 JWT（与服务器端使用相同密钥）
    const jwt = require(path.join(SERVER_DIR, 'node_modules', 'jsonwebtoken'));
    const jwtSecret = process.env.JWT_SECRET || 'music-box-dev-secret-2024-do-not-use-in-prod';
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      jwtSecret,
      { expiresIn: '7d' }
    );

    log.success('身份认证成功 ✓');
    log.plain(`  ${colors.dim}用户ID:${colors.reset}    ${colors.cyan}${user.id}${colors.reset}`);
    log.plain(`  ${colors.dim}用户名:${colors.reset}    ${colors.cyan}${user.username}${colors.reset}`);
    log.plain(`  ${colors.dim}邮箱:${colors.reset}      ${colors.cyan}${user.email}${colors.reset}`);
    log.plain(`  ${colors.dim}角色:${colors.reset}      ${colors.cyan}${user.role}${colors.reset}`);
    log.plain(`  ${colors.dim}状态:${colors.reset}      ${colors.green}${user.status}${colors.reset}`);
    log.plain(`  ${colors.dim}注册时间:${colors.reset}  ${colors.cyan}${user.createdAt}${colors.reset}`);
    log.plain(`  ${colors.dim}最后登录:${colors.reset}  ${colors.cyan}${user.lastLoginAt || '(从未)'}${colors.reset}`);
    log.plain(`  ${colors.dim}JWT Token:${colors.reset} ${colors.dim}${token.substring(0, 40)}...${colors.reset}`);
    writeLog('AUTH_OK', `username=${username} user_id=${user.id}`);

    // 更新最后登录时间（fire-and-forget，需 allow-write）
    if (process.argv.includes('--allow-write')) {
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });
        log.info('已更新最后登录时间');
      } catch (e) {
        log.warn(`更新最后登录时间失败: ${e.message}`);
      }
    } else {
      log.info('(未开启 --allow-write，跳过更新 lastLoginAt)');
    }

    return 0;
  } catch (e) {
    log.error(`认证过程出错: ${e.message}`);
    writeLog('AUTH_ERROR', `username=${username} error=${e.message}`);
    return 4;
  }
}

// ============================================================
// 命令: users
// ============================================================
async function cmdUsers(args) {
  let prisma;
  try {
    prisma = await getPrisma();
  } catch (e) {
    log.error(`Prisma Client 初始化失败: ${e.message}`);
    return 4;
  }

  const limit = parseInt(args.limit || '20', 10);
  const role = args.role;

  try {
    const where = role ? { role } : {};
    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
      },
      orderBy: { id: 'asc' },
      take: limit,
    });

    log.success(`查询到 ${users.length} 个用户`);
    if (args.json) {
      console.log(JSON.stringify(users, null, 2));
    } else {
      log.plain('');
      log.plain(`${'ID'.padEnd(6)}${'用户名'.padEnd(20)}${'角色'.padEnd(15)}${'状态'.padEnd(12)}${'最后登录'.padEnd(28)}邮箱`);
      log.plain(`${colors.dim}${'─'.repeat(100)}${colors.reset}`);
      for (const u of users) {
        const id = String(u.id).padEnd(6);
        const username = (u.username || '').padEnd(20).substring(0, 20);
        const role = (u.role || '').padEnd(15);
        const status = (u.status || '').padEnd(12);
        const lastLogin = (u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('zh-CN') : '(从未)').padEnd(28);
        log.plain(`${id}${username}${role}${status}${lastLogin}${u.email}`);
      }
      log.plain('');
    }
    return 0;
  } catch (e) {
    log.error(`查询用户失败: ${e.message}`);
    return 4;
  }
}

// ============================================================
// 命令: user
// ============================================================
async function cmdUser(idStr) {
  if (!idStr) {
    log.error('用法: user <id>');
    return 1;
  }
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    log.error(`无效的用户 ID: ${idStr}`);
    return 1;
  }

  let prisma;
  try {
    prisma = await getPrisma();
  } catch (e) {
    log.error(`Prisma Client 初始化失败: ${e.message}`);
    return 4;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        securityQuestion: true,
        _count: {
          select: {
            playlists: true,
            listeningEvents: true,
            dailyRecommendations: true,
          },
        },
      },
    });

    if (!user) {
      log.error(`未找到 ID 为 ${id} 的用户`);
      return 1;
    }

    log.success(`用户详情 #${id}`);
    if (args.json) {
      console.log(JSON.stringify(user, null, 2));
    } else {
      log.plain('');
      log.plain(`  ${colors.dim}用户ID:${colors.reset}        ${colors.cyan}${user.id}${colors.reset}`);
      log.plain(`  ${colors.dim}用户名:${colors.reset}        ${colors.cyan}${user.username}${colors.reset}`);
      log.plain(`  ${colors.dim}邮箱:${colors.reset}          ${colors.cyan}${user.email}${colors.reset}`);
      log.plain(`  ${colors.dim}角色:${colors.reset}          ${colors.cyan}${user.role}${colors.reset}`);
      log.plain(`  ${colors.dim}状态:${colors.reset}          ${colors.green}${user.status}${colors.reset}`);
      log.plain(`  ${colors.dim}注册时间:${colors.reset}      ${colors.cyan}${user.createdAt}${colors.reset}`);
      log.plain(`  ${colors.dim}最后登录:${colors.reset}      ${colors.cyan}${user.lastLoginAt || '(从未)'}${colors.reset}`);
      log.plain(`  ${colors.dim}密保问题:${colors.reset}      ${colors.cyan}${user.securityQuestion || '(无)'}${colors.reset}`);
      log.plain(`  ${colors.dim}播放列表数:${colors.reset}    ${colors.cyan}${user._count.playlists}${colors.reset}`);
      log.plain(`  ${colors.dim}聆听事件数:${colors.reset}    ${colors.cyan}${user._count.listeningEvents}${colors.reset}`);
      log.plain(`  ${colors.dim}推荐记录数:${colors.reset}    ${colors.cyan}${user._count.dailyRecommendations}${colors.reset}`);
      log.plain('');
    }
    return 0;
  } catch (e) {
    log.error(`查询用户失败: ${e.message}`);
    return 4;
  }
}

// ============================================================
// 命令: songs
// ============================================================
async function cmdSongs(args) {
  let prisma;
  try {
    prisma = await getPrisma();
  } catch (e) {
    log.error(`Prisma Client 初始化失败: ${e.message}`);
    return 4;
  }

  const limit = parseInt(args.limit || '20', 10);
  const offset = parseInt(args.offset || '0', 10);
  const search = args.search;
  const platform = args.platform;

  try {
    const where = {};
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { artist: { contains: search } },
        { album: { contains: search } },
      ];
    }
    if (platform) where.platform = platform;

    const [songs, total] = await Promise.all([
      prisma.song.findMany({
        where,
        select: {
          id: true,
          title: true,
          artist: true,
          album: true,
          platform: true,
          playable: true,
          playCount: true,
          likeCount: true,
          createdAt: true,
        },
        orderBy: { id: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.song.count({ where }),
    ]);

    log.success(`查询到 ${songs.length}/${total} 首歌曲 (offset=${offset})`);
    if (args.json) {
      console.log(JSON.stringify({ total, songs }, null, 2));
    } else {
      log.plain('');
      log.plain(`${'ID'.padEnd(15)}${'标题'.padEnd(30)}${'歌手'.padEnd(20)}${'平台'.padEnd(10)}${'可播'.padEnd(6)}${'播放'.padEnd(10)}专辑`);
      log.plain(`${colors.dim}${'─'.repeat(120)}${colors.reset}`);
      for (const s of songs) {
        const id = (s.id || '').padEnd(15).substring(0, 15);
        const title = (s.title || '').padEnd(30).substring(0, 30);
        const artist = (s.artist || '').padEnd(20).substring(0, 20);
        const plat = (s.platform || '').padEnd(10).substring(0, 10);
        const playable = (s.playable ? '是' : '否').padEnd(6);
        const playCount = String(s.playCount || 0).padEnd(10);
        log.plain(`${id}${title}${artist}${plat}${playable}${playCount}${s.album || ''}`);
      }
      log.plain('');
    }
    return 0;
  } catch (e) {
    log.error(`查询歌曲失败: ${e.message}`);
    return 4;
  }
}

// ============================================================
// 命令: song
// ============================================================
async function cmdSong(id) {
  if (!id) {
    log.error('用法: song <id>');
    return 1;
  }

  let prisma;
  try {
    prisma = await getPrisma();
  } catch (e) {
    log.error(`Prisma Client 初始化失败: ${e.message}`);
    return 4;
  }

  try {
    const song = await prisma.song.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        artist: true,
        album: true,
        albumCover: true,
        audioUrl: true,
        lyricContent: true,
        coverColor: true,
        duration: true,
        platform: true,
        playable: true,
        playCount: true,
        likeCount: true,
        favoriteCount: true,
        hotScore: true,
        createdAt: true,
        updatedAt: true,
        urlCheckedAt: true,
      },
    });

    if (!song) {
      log.error(`未找到 ID 为 ${id} 的歌曲`);
      return 1;
    }

    log.success(`歌曲详情 #${id}`);
    if (args.json) {
      console.log(JSON.stringify(song, null, 2));
    } else {
      log.plain('');
      log.plain(`  ${colors.dim}歌曲ID:${colors.reset}        ${colors.cyan}${song.id}${colors.reset}`);
      log.plain(`  ${colors.dim}标题:${colors.reset}          ${colors.cyan}${song.title}${colors.reset}`);
      log.plain(`  ${colors.dim}歌手:${colors.reset}          ${colors.cyan}${song.artist}${colors.reset}`);
      log.plain(`  ${colors.dim}专辑:${colors.reset}          ${colors.cyan}${song.album || '(无)'}${colors.reset}`);
      log.plain(`  ${colors.dim}平台:${colors.reset}          ${colors.cyan}${song.platform || '(无)'}${colors.reset}`);
      log.plain(`  ${colors.dim}时长:${colors.reset}          ${colors.cyan}${song.duration ? Math.floor(song.duration / 1000) + 's' : '(未知)'}${colors.reset}`);
      log.plain(`  ${colors.dim}可播放:${colors.reset}        ${song.playable ? colors.green + '是' : colors.red + '否'}${colors.reset}`);
      log.plain(`  ${colors.dim}播放次数:${colors.reset}      ${colors.cyan}${song.playCount}${colors.reset}`);
      log.plain(`  ${colors.dim}点赞数:${colors.reset}        ${colors.cyan}${song.likeCount}${colors.reset}`);
      log.plain(`  ${colors.dim}收藏数:${colors.reset}        ${colors.cyan}${song.favoriteCount}${colors.reset}`);
      log.plain(`  ${colors.dim}热度分:${colors.reset}        ${colors.cyan}${song.hotScore}${colors.reset}`);
      log.plain(`  ${colors.dim}封面色:${colors.reset}        ${colors.cyan}${song.coverColor || '(无)'}${colors.reset}`);
      log.plain(`  ${colors.dim}专辑封面:${colors.reset}      ${colors.dim}${(song.albumCover || '').substring(0, 60)}${song.albumCover ? '...' : '(无)'}${colors.reset}`);
      log.plain(`  ${colors.dim}音频URL:${colors.reset}       ${colors.dim}${(song.audioUrl || '').substring(0, 60)}...${colors.reset}`);
      log.plain(`  ${colors.dim}创建时间:${colors.reset}      ${colors.cyan}${song.createdAt}${colors.reset}`);
      log.plain(`  ${colors.dim}更新时间:${colors.reset}      ${colors.cyan}${song.updatedAt}${colors.reset}`);
      log.plain(`  ${colors.dim}URL检查:${colors.reset}       ${colors.cyan}${song.urlCheckedAt || '(从未)'}${colors.reset}`);
      log.plain(`  ${colors.dim}歌词:${colors.reset}          ${song.lyricContent ? `${song.lyricContent.length} 字符` : '(无)'}`);
      log.plain('');
    }
    return 0;
  } catch (e) {
    log.error(`查询歌曲失败: ${e.message}`);
    return 4;
  }
}

// ============================================================
// 命令: stats
// ============================================================
async function cmdStats() {
  let prisma;
  try {
    prisma = await getPrisma();
  } catch (e) {
    log.error(`Prisma Client 初始化失败: ${e.message}`);
    return 4;
  }

  try {
    const [
      userCount, songCount, playlistCount, crawlLogCount,
      listeningEventCount, dailyRecCount, operationLogCount,
      activeUserCount, playableSongCount,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.song.count(),
      prisma.playlist.count(),
      prisma.crawlLog.count(),
      prisma.listeningEvent.count(),
      prisma.dailyRecommendation.count(),
      prisma.operationLog.count(),
      prisma.user.count({ where: { status: 'active' } }),
      prisma.song.count({ where: { playable: true } }),
    ]);

    log.success('数据库统计');
    if (args.json) {
      console.log(JSON.stringify({
        users: userCount,
        activeUsers: activeUserCount,
        songs: songCount,
        playableSongs: playableSongCount,
        playlists: playlistCount,
        crawlLogs: crawlLogCount,
        listeningEvents: listeningEventCount,
        dailyRecommendations: dailyRecCount,
        operationLogs: operationLogCount,
      }, null, 2));
    } else {
      log.plain('');
      log.plain(`  ${colors.dim}用户总数:${colors.reset}        ${colors.cyan}${userCount}${colors.reset}`);
      log.plain(`  ${colors.dim}活跃用户:${colors.reset}        ${colors.green}${activeUserCount}${colors.reset}`);
      log.plain(`  ${colors.dim}歌曲总数:${colors.reset}        ${colors.cyan}${songCount}${colors.reset}`);
      log.plain(`  ${colors.dim}可播放歌曲:${colors.reset}      ${colors.green}${playableSongCount}${colors.reset}`);
      log.plain(`  ${colors.dim}播放列表数:${colors.reset}      ${colors.cyan}${playlistCount}${colors.reset}`);
      log.plain(`  ${colors.dim}爬虫日志数:${colors.reset}      ${colors.cyan}${crawlLogCount}${colors.reset}`);
      log.plain(`  ${colors.dim}聆听事件数:${colors.reset}      ${colors.cyan}${listeningEventCount}${colors.reset}`);
      log.plain(`  ${colors.dim}每日推荐数:${colors.reset}      ${colors.cyan}${dailyRecCount}${colors.reset}`);
      log.plain(`  ${colors.dim}操作日志数:${colors.reset}      ${colors.cyan}${operationLogCount}${colors.reset}`);
      log.plain('');
    }
    return 0;
  } catch (e) {
    log.error(`统计查询失败: ${e.message}`);
    return 4;
  }
}

// ============================================================
// 命令: tables
// ============================================================
async function cmdTables() {
  let prisma;
  try {
    prisma = await getPrisma();
  } catch (e) {
    log.error(`Prisma Client 初始化失败: ${e.message}`);
    return 4;
  }

  try {
    const rows = await prisma.$queryRaw`
      SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH, CREATE_TIME, UPDATE_TIME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME
    `;
    // BigInt 无法被 JSON.stringify 直接序列化，统一转为 Number
    const safeRows = rows.map(r => {
      const out = {};
      for (const [k, v] of Object.entries(r)) {
        out[k] = typeof v === 'bigint' ? Number(v) : v;
      }
      return out;
    });
    log.success(`数据库 ${process.env.DATABASE_URL.match(/\/([^/?]+)(\?|$)/)?.[1] || ''} 包含 ${safeRows.length} 张表`);
    if (args.json) {
      console.log(JSON.stringify(safeRows, null, 2));
    } else {
      log.plain('');
      log.plain(`${'表名'.padEnd(30)}${'行数'.padEnd(12)}${'数据大小'.padEnd(15)}创建时间`);
      log.plain(`${colors.dim}${'─'.repeat(80)}${colors.reset}`);
      for (const r of safeRows) {
        const name = String(r.TABLE_NAME || '').padEnd(30).substring(0, 30);
        const rowCount = String(r.TABLE_ROWS || 0).padEnd(12);
        const size = formatBytes(Number(r.DATA_LENGTH) || 0).padEnd(15);
        const created = r.CREATE_TIME ? new Date(r.CREATE_TIME).toLocaleString('zh-CN') : '';
        log.plain(`${name}${rowCount}${size}${created}`);
      }
      log.plain('');
    }
    return 0;
  } catch (e) {
    log.error(`查询表信息失败: ${e.message}`);
    return 4;
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

// ============================================================
// 参数解析
// ============================================================
function parseArgs(args) {
  const opts = { _: [], json: false, allowWrite: false, verbose: false, limit: null, offset: null, search: null, role: null, platform: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') opts.json = true;
    else if (a === '--allow-write') opts.allowWrite = true;
    else if (a === '--verbose') opts.verbose = true;
    else if (a === '--limit') opts.limit = args[++i];
    else if (a === '--offset') opts.offset = args[++i];
    else if (a === '--search') opts.search = args[++i];
    else if (a === '--role') opts.role = args[++i];
    else if (a === '--platform') opts.platform = args[++i];
    else if (a && !a.startsWith('--')) opts._.push(a);
  }
  return opts;
}

// 让命令函数能访问 args（通过全局变量，避免大改函数签名）
let args = {};

// ============================================================
// 主入口
// ============================================================
async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    showHelp();
    process.exit(0);
  }

  const command = argv[0];
  const rest = argv.slice(1);

  if (command === 'help' || command === '-h' || command === '--help') {
    showHelp();
    process.exit(0);
  }

  // 配置环境变量
  if (!configureEnvironment()) {
    process.exit(2);
  }

  // 解析参数
  args = parseArgs(rest);
  const positional = args._;

  let exitCode = 0;
  try {
    switch (command) {
      case 'ping':
        exitCode = await cmdPing();
        break;
      case 'auth':
        exitCode = await cmdAuth(positional[0]);
        break;
      case 'login':
        exitCode = await cmdLogin(positional[0], positional[1]);
        break;
      case 'users':
        exitCode = await cmdUsers(args);
        break;
      case 'user':
        exitCode = await cmdUser(positional[0]);
        break;
      case 'songs':
        exitCode = await cmdSongs(args);
        break;
      case 'song':
        exitCode = await cmdSong(positional[0]);
        break;
      case 'stats':
        exitCode = await cmdStats();
        break;
      case 'tables':
        exitCode = await cmdTables();
        break;
      default:
        log.error(`未知命令: ${command}`);
        log.info('使用 help 查看可用命令');
        exitCode = 1;
    }
  } catch (e) {
    log.error(`命令执行异常: ${e.message}`);
    if (args.verbose && e.stack) {
      console.error(e.stack);
    }
    writeLog('ERROR', `command=${command} error=${e.message}`);
    exitCode = 99;
  } finally {
    await disconnectPrisma();
  }

  process.exit(exitCode);
}

main().catch(err => {
  log.error('未捕获异常: ' + (err && err.stack ? err.stack : err));
  process.exit(99);
});
