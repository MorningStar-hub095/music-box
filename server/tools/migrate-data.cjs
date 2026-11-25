const mysql = require('mysql2/promise');
const { PrismaClient } = require('@prisma/client');

// 表级别：需要 cast 为 enum 的字段（仅限真正的 PostgreSQL enum 类型）
const enumOverrides = {
  'users': { role: '"UserRole"', status: '"UserStatus"' },
  'songs': { data_source: '"DataSource"' },
  'crawl_logs': { status: '"CrawlStatus"' },
};

// 表级别：需要转为 boolean 的字段（MySQL tinyint -> boolean）
const boolOverrides = {
  'songs': ['playable', 'archived'],
  'url_refresh_logs': ['success'],
  'url_alerts': ['resolved'],
};

async function migrateTable(pg, conn, mysqlTable, pgTable) {
  const [rows] = await conn.execute('SELECT * FROM `' + mysqlTable + '`');
  if (rows.length === 0) {
    console.log('  ' + mysqlTable + ': 0 rows (skip)');
    return 0;
  }

  const pgColumns = Object.keys(rows[0]);
  const enums = enumOverrides[mysqlTable] || {};
  const bools = new Set(boolOverrides[mysqlTable] || []);
  const BATCH_SIZE = 200;

  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);

    const processed = batch.map(row => {
      return pgColumns.map(col => {
        let val = row[col];
        // BigInt -> string
        if (typeof val === 'bigint') val = val.toString();
        if (Buffer.isBuffer(val)) val = val.toString();
        // boolean 字段：MySQL tinyint(1) 返回 bigint 0/1，转为 JS boolean
        if (bools.has(col)) val = val === 1 || val === '1' || val === true;
        return val;
      });
    });

    const placeholders = processed.map((_, i) =>
      '(' + pgColumns.map((_, j) => {
        const idx = i * pgColumns.length + j + 1;
        const col = pgColumns[j];
        if (enums[col]) return '$' + idx + '::' + enums[col];
        return '$' + idx;
      }).join(',') + ')'
    ).join(',');

    const flatValues = processed.flat();
    const sql = `INSERT INTO "${pgTable}" (${pgColumns.map(c => '"' + c + '"').join(',')}) VALUES ${placeholders} ON CONFLICT DO NOTHING`;

    await pg.$executeRawUnsafe(sql, ...flatValues);
  }

  console.log('  ' + mysqlTable + ' -> ' + pgTable + ': ' + rows.length + ' rows');
  return rows.length;
}

async function main() {
  const pg = new PrismaClient();
  console.log('=== Music Box Data Migration: MySQL -> PostgreSQL ===\n');

  const existingSongs = await pg.song.count();
  if (existingSongs > 0) {
    console.log('PostgreSQL already has ' + existingSongs + ' songs.');
    await pg.$disconnect();
    return;
  }

  const conn = await mysql.createConnection({
    host: 'localhost', port: 3306, user: 'root',
    password: 'Jmx20040813+', database: 'music_box',
  });
  console.log('Connected to MySQL\n');

  const tables = [
    ['users', 'users'],
    ['songs', 'songs'],
    ['genres', 'genres'],
    ['languages', 'languages'],
    ['scenes', 'scenes'],
    ['moods', 'moods'],
    ['decades', 'decades'],
    ['tags', 'tags'],
    ['song_genres', 'song_genres'],
    ['song_languages', 'song_languages'],
    ['song_scenes', 'song_scenes'],
    ['song_moods', 'song_moods'],
    ['song_decades', 'song_decades'],
    ['song_tags', 'song_tags'],
    ['playlists', 'playlists'],
    ['playlist_songs', 'playlist_songs'],
    ['social_dna', 'social_dna'],
    ['song_features', 'song_features'],
    ['comments', 'comments'],
    ['comment_likes', 'comment_likes'],
    ['comment_reports', 'comment_reports'],
    ['audio_error_logs', 'audio_error_logs'],
    ['url_refresh_logs', 'url_refresh_logs'],
    ['url_alerts', 'url_alerts'],
    ['operation_logs', 'operation_logs'],
    ['crawl_logs', 'crawl_logs'],
    ['listening_events', 'listening_events'],
    ['daily_recommendations', 'daily_recommendations'],
    ['recommendation_feedback', 'recommendation_feedback'],
  ];

  let totalMigrated = 0;
  for (const [mysqlTable, pgTable] of tables) {
    try {
      const count = await migrateTable(pg, conn, mysqlTable, pgTable);
      totalMigrated += count;
    } catch (err) {
      console.error('  ' + mysqlTable + ': ERROR - ' + (err.message || '').substring(0, 200));
    }
  }

  console.log('\n=== Migration complete: ' + totalMigrated + ' total rows ===');
  await conn.end();
  await pg.$disconnect();
}

main().catch(err => { console.error('Migration failed:', err.message); process.exit(1); });
