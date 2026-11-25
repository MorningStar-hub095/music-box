// 全库 JSON 备份（所有 public 表）
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRawUnsafe(
    `select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`
  );
  const outDir = path.join(__dirname, '..', '..', 'output', 'db-backup-20261117');
  fs.mkdirSync(outDir, { recursive: true });
  const summary = [];
  for (const { table_name } of tables) {
    const rows = await prisma.$queryRawUnsafe(`select * from "${table_name}"`);
    const file = path.join(outDir, table_name + '.json');
    const json = JSON.stringify(rows, (k, v) => typeof v === 'bigint' ? v.toString() : v);
    fs.writeFileSync(file, json);
    summary.push({ table: table_name, rows: rows.length, file });
    console.log(table_name, rows.length);
  }
  fs.writeFileSync(path.join(outDir, '_summary.json'), JSON.stringify(summary, null, 1));
  console.log('backup done ->', outDir);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
