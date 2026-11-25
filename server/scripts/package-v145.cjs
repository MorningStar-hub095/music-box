/**
 * 打包同步（v1.4.5 · Jamendo-only 内置曲库版）
 * 步骤：
 *  1. 同步 server/dist 与重打 app.asar（版本 1.4.5）
 *  2. 复制 jamendo_*.mp3 → 部署包 resources/audio-library（仅 CC 授权曲目，合规）
 *  3. 打包库数据变体：netease/qq 歌曲 playable=false（无合法音源，标记不可播保留列表）
 *     —— 在真实库临时应用 → 生成 pgdata.zip + seed.sql → 立即回滚
 *  4. 全新安装回环验证
 */
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEPLOY = 'D:/music_box/部署包-20261111/MusicBox/resources';
const DEV_LIB = 'D:/music_box/data/audio-library';
const APPDATA = process.env.APPDATA;
const PGDATA = path.join(APPDATA, 'MusicBox/pgdata');
const PGBIN = 'D:/music_box/部署包-20261111/MusicBox/resources/pgbin/bin';
const PRISMA = 'postgresql://postgres:postgres@127.0.0.1:5432/music_box';
const SERVER = 'D:/music_box/server';

function sh(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit', ...opts });
  const rcOk = opts.rcOk ?? 1; // 失败阈值：status >= rcOk 视为失败（robocopy 传 8，0-7 成功）
  if (r.status === null || r.status >= rcOk) throw new Error(`命令失败(exit=${r.status}): ${cmd}`);
}

function prisma(sql) {
  // SQL 经环境变量传递，避免 shell 引号转义问题
  const script = 'const {PrismaClient}=require("D:/music_box/server/node_modules/@prisma/client");const p=new PrismaClient({datasources:{db:{url:process.env.DB_URL}}});p.$queryRawUnsafe(process.env.SQL_TEXT).then(n=>{console.log("OK rows:",Array.isArray(n)?n.length:n);return p.$disconnect();}).catch(e=>{console.error(e.message);process.exit(1)});';
  const r = spawnSync('node', ['-e', script], {
    env: { ...process.env, DB_URL: PRISMA, SQL_TEXT: sql },
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error('SQL 失败: ' + sql);
}

(async () => {
  const step = process.argv[2] || 'all';
  if (step === 'all' || step === 'assets') {
    // ---- 1. server/dist 同步 + asar 重打 ----
    // 目录复制用 robocopy（fs.cpSync 在本机 Node v22 触发段错误 exit=139）；
    // robocopy 退出码 0-7 均为成功
    execSync(`npm run build`, { cwd: SERVER, stdio: 'inherit' });
    sh(`robocopy "${SERVER}\\dist" "${DEPLOY}\\server\\dist" /MIR /NFL /NDL /NJH /NJS /NP`, { rcOk: 8 });

    const tmp = `D:/music_box/deploy-tmp-v145-${Date.now()}`;
    fs.mkdirSync(path.join(tmp, 'asar-src'), { recursive: true });
    sh(`npx --yes @electron/asar extract "${DEPLOY}/app.asar" "${tmp}/asar-src"`);
    fs.copyFileSync('D:/music_box/desktop/main.js', path.join(tmp, 'asar-src/main.js'));
    fs.writeFileSync(path.join(tmp, 'asar-src/package.json'),
      JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(tmp, 'asar-src/package.json'), 'utf8')), version: '1.4.7' }, null, 2));
    sh(`npx --yes @electron/asar pack "${tmp}/asar-src" "${tmp}/app-new.asar"`);
    // 备份上一版 asar（v1.4.5/v1.4.6 备份已存在则跳过，避免覆盖历史；v1.4.7 起追加 v1.4.6 备份）
    const bak = path.join(DEPLOY, 'app.asar.bak-v1.4.6');
    if (!fs.existsSync(bak)) fs.copyFileSync(path.join(DEPLOY, 'app.asar'), bak);
    const bak145 = path.join(DEPLOY, 'app.asar.bak-v1.4.5');
    if (!fs.existsSync(bak145)) fs.copyFileSync(path.join(DEPLOY, 'app.asar'), bak145);
    fs.copyFileSync(path.join(tmp, 'app-new.asar'), path.join(DEPLOY, 'app.asar'));
    // 打包临时目录清理（node fs 删除，不经过 shell 回收站钩子）
    fs.rmSync(tmp, { recursive: true, force: true });

    // ---- 1b. web/dist 同步（v1.4.6 起纳入打包：useSearch 线上结果合并改动）----
    // 服务端静态目录解析为 resources/web/dist（SERVER_DIR/../web/dist），必须落在 dist 子目录
    const webDeploy = path.join(DEPLOY, 'web', 'dist');
    fs.rmSync(path.join(DEPLOY, 'web'), { recursive: true, force: true });
    fs.mkdirSync(webDeploy, { recursive: true });
    sh(`robocopy "D:\\music_box\\web\\dist" "${webDeploy}" /MIR /NFL /NDL /NJH /NJS /NP`, { rcOk: 8 });

    // ---- 1c. 打包内置默认配置（v1.4.6：JAMENDO_CLIENT_ID 出厂注入）----
    fs.copyFileSync('D:/music_box/desktop/server.env.bundle', path.join(DEPLOY, 'server.env'));

    console.log('[1] server/dist + app.asar(1.4.7) + web/dist + server.env 同步完成');

    // ---- 2. jamendo 曲目复制进部署包 ----
    fs.mkdirSync(path.join(DEPLOY, "audio-library"), { recursive: true });
    const files = fs.readdirSync(DEV_LIB).filter(f => f.startsWith('jamendo_') && f.endsWith('.mp3'));
    let copied = 0;
    for (const f of files) {
      fs.copyFileSync(path.join(DEV_LIB, f), path.join(DEPLOY, 'audio-library', f));
      copied++;
    }
    console.log(`[2] jamendo 曲目打包: ${copied} 首`);
  }

  if (step === 'all' || step === 'db') {
    // ---- 3. 打包库数据变体（临时改 → 导出 seed → 快照 → 回滚）----
    // 顺序关键：seed 导出必须在"playable=false 窗口"内且数据库在线时完成
    // PG 常被前台失败中断后遗留停止态：先确保在线
    const alive = spawnSync('netstat', ['-ano'], { shell: true }).output.toString().includes(':5432');
    if (!alive) {
      console.log('[pg] 5432 未监听，自动启动...');
      sh(`"${PGBIN}/pg_ctl.exe" -D "${PGDATA}" -o "-p 5432" -l "${APPDATA.replace(/\\/g, '/')}/MusicBox/pg.log" start`);
      spawnSync('ping', ['-n', '6', '127.0.0.1'], { stdio: 'ignore' });
    }
    prisma(`update songs set playable = false where url_source = 'self-hosted' and id not like 'jamendo:%'`);
    sh(`npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > output/schema-new.sql`, { cwd: SERVER });
    sh(`node scripts/gen-seed-sql.cjs`, { cwd: SERVER });
    sh(`"${PGBIN}/pg_ctl.exe" -D "${PGDATA}" -m fast stop`);
    const snap = path.join(APPDATA, 'MusicBox/pgdata-tmp');
    sh(`robocopy "${PGDATA}" "${snap}" /MIR /NFL /NDL /NJH /NJS /NP`, { rcOk: 8 });
    fs.rmSync(path.join(snap, 'postmaster.pid'), { force: true });
    fs.rmSync(path.join(APPDATA, 'MusicBox/pgdata-new.zip'), { force: true });
    // spawnSync 的 shell 是 cmd.exe：必须用反斜杠路径的 cmd 形式调用 tar
    sh(`C:\\Windows\\System32\\tar.exe -a -cf "${APPDATA}\\MusicBox\\pgdata-new.zip" -C "${snap}" .`);
    const dbDirs = [
      `${DEPLOY}/db`,
      'D:/music_box/desktop/release-new/win-unpacked/resources/db',
      'D:/music_box/desktop/release-pkg/win-unpacked/resources/db',
      'D:/music_box/desktop/release2/win-unpacked/resources/db',
    ];
    for (const d of dbDirs) fs.copyFileSync(path.join(APPDATA, 'MusicBox/pgdata-new.zip'), path.join(d, 'pgdata.zip'));
    // seed.sql 导出发生在 playable=false 窗口内，天然体现打包变体
    const seedOut = 'D:/music_box/output/seed-new.sql';
    const header = `-- 音乐盒子 种子库（打包变体，重新生成于 ${new Date().toLocaleString('zh-CN')}）：schema + 曲库数据\n-- 内置音频 = Jamendo CC 授权曲目（resources/audio-library）；netease/qq 旧曲标记不可播（无合法音源）\n`;
    fs.writeFileSync(seedOut, header + fs.readFileSync(`${SERVER}/output/schema-new.sql`, 'utf8') + '\n-- ===== 数据 =====\n' + fs.readFileSync('D:/music_box/output/seed-data-new.sql', 'utf8'));
    for (const d of dbDirs) fs.copyFileSync(seedOut, path.join(d, 'seed.sql'));
    sh(`"${PGBIN}/pg_ctl.exe" -D "${PGDATA}" -o "-p 5432" -l "${APPDATA.replace(/\\/g, '/')}/MusicBox/pg.log" start`);
    spawnSync('ping', ['-n', '6', '127.0.0.1'], { stdio: 'ignore' });
    prisma(`update songs set playable = true where url_source = 'self-hosted' and id not like 'jamendo:%'`);
    spawnSync('cmd', ['/c', `rmdir /s /q "${snap}"`], { stdio: 'ignore' });
    console.log('[3] pgdata.zip + seed.sql（打包变体）已同步 4 处，真实库已回滚 playable');
  }
  console.log('DONE');
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
