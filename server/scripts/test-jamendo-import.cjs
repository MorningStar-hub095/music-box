/** 小批量 Jamendo 导入实测：验证 下载→校验→入库→license→标签 全链路 */
const path = require('path');
process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/music_box';
process.env.JAMENDO_CLIENT_ID = 'b50cfeff';

const { importByTag } = require(path.join('D:/', 'music_box', 'server', 'dist', 'modules', 'library', 'jamendo.service.js'));
const { PrismaClient } = require(path.join('D:/', 'music_box', 'server', 'node_modules', '@prisma', 'client'));

(async () => {
  const r = await importByTag('piano', 3);
  console.log('importByTag(piano,3) =>', JSON.stringify(r, null, 1));

  const p = new PrismaClient();
  const songs = await p.$queryRawUnsafe(`select id, title, artist, duration, url_source, playable from songs where id like 'jamendo:%'`);
  console.log('库内 jamendo 歌曲:', JSON.stringify(songs, (_, v) => typeof v === 'bigint' ? String(v) : v, 1));
  const lic = await p.$queryRawUnsafe(`select song_id, license_type, source_page from audio_licenses where source = 'jamendo'`);
  console.log('授权登记:', JSON.stringify(lic, null, 1));
  const tg = await p.$queryRawUnsafe(`select sg.song_id, g.name genre from song_genres sg join genres g on g.id = sg.genre_id where sg.song_id like 'jamendo:%'
    union all select sm.song_id, m.name mood from song_moods sm join moods m on m.id = sm.mood_id where sm.song_id like 'jamendo:%'`);
  console.log('标签映射:', JSON.stringify(tg, null, 1));
  await p.$disconnect();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
