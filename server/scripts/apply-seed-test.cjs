// 在临时库 music_box_seedtest 中应用 seed-new.sql 并验证（引号感知分割）
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const prisma = new PrismaClient({ datasources: { db: { url: 'postgresql://postgres:postgres@127.0.0.1:5432/music_box_seedtest' } } });

function splitStatements(sql) {
  // 逐行剥离注释：跨行跟踪字符串字面量状态，字面量内部的 '--' 行不动
  const lines = [];
  let inStr = false;
  for (const line of sql.split('\n')) {
    if (!inStr && line.trim().startsWith('--')) continue; // 注释行
    let l = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      l += ch;
      if (inStr) {
        if (ch === "'") {
          if (line[i + 1] === "'") { l += "'"; i++; }
          else inStr = false;
        }
      } else if (ch === "'") inStr = true;
    }
    lines.push(l);
  }
  const cleaned = lines.join('\n');
  const stmts = [];
  let cur = '';
  inStr = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        if (cleaned[i + 1] === "'") { cur += "'"; i++; }
        else inStr = false;
      }
    } else {
      if (ch === "'") { inStr = true; cur += ch; }
      else if (ch === ';') { stmts.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts.filter(s => s.length > 0);
}

async function main() {
  const sql = fs.readFileSync('D:/music_box/output/seed-new.sql', 'utf8');
  const stmts = splitStatements(sql);
  console.log('statements:', stmts.length);
  let ok = 0;
  for (let i = 0; i < stmts.length; i++) {
    try {
      await prisma.$executeRawUnsafe(stmts[i]);
      ok++;
    } catch (e) {
      console.error(`FAIL @${i}: ${stmts[i].slice(0, 120)}\n  ${e.message.split('\n')[0]}`);
      process.exit(1);
    }
    if ((i + 1) % 1000 === 0) console.log('applied', i + 1);
  }
  console.log('applied all:', ok);

  const counts = await prisma.$queryRawUnsafe(`select
    (select count(*)::int from songs) songs,
    (select count(*)::int from song_features) feats,
    (select count(*)::int from users) users,
    (select count(*)::int from daily_recommendations) daily`);
  console.table(counts);
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
