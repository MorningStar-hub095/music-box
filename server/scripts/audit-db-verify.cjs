// 数据库核查脚本（Prisma 版）：统计曲库真实记录数与 audio_url 状态
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const show = (label, rows) => { console.log('=== ' + label + ' ==='); console.table(rows); };

async function main() {
  const dbs = await prisma.$queryRawUnsafe("select datname from pg_database where datistemplate=false");
  console.log('databases:', dbs.map(r => r.datname).join(', '));

  show('songs 总数/平台分布', await prisma.$queryRawUnsafe(`
    select count(*)::int total,
      count(*) filter (where platform='netease')::int netease,
      count(*) filter (where platform='qq')::int qq,
      count(*) filter (where platform not in ('netease','qq') or platform is null)::int other
    from songs`));

  show('data_source', await prisma.$queryRawUnsafe(`select data_source, count(*)::int n from songs group by 1 order by 2 desc`));
  show('playable/archived', await prisma.$queryRawUnsafe(`select playable, coalesce(archived::text,'null') archived, count(*)::int n from songs group by 1,2 order by 1,2`));
  show('audio_url 有无', await prisma.$queryRawUnsafe(`select count(*)::int with_url, count(*) filter (where audio_url is null or audio_url='')::int no_url from songs`));
  show('URL 域名分布', await prisma.$queryRawUnsafe(`select case
      when audio_url is null or audio_url='' then 'no_url'
      when audio_url like '%126.net%' then 'netease-cdn'
      when audio_url like '%qq.com%' then 'qq-cdn'
      else 'other' end host, count(*)::int n
    from songs group by 1`));
  show('时长脏数据', await prisma.$queryRawUnsafe(`select
      (select count(*)::int from songs where duration is null) count_no_dur,
      (select count(*)::int from songs where duration > 7200) over_2h,
      (select max(duration)::int from songs) max_dur`));
  show('play_count', await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(sum(play_count),0)::bigint sum_play from songs`));

  // 缓存表探测
  const tables = await prisma.$queryRawUnsafe(`select table_name from information_schema.tables where table_schema='public' order by 1`);
  console.log('public tables:', tables.map(r => r.table_name).join(', '));
}
main().catch(e => { console.error(e.message.split('\n')[0]); process.exit(1); }).finally(() => prisma.$disconnect());
