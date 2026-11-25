const { PrismaClient } = require('../server/node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {
  // For songs with urlExpiresAt=null and playable=true, set urlExpiresAt to past
  // so URL manager treats them as expired and triggers refresh directly
  const r = await p.song.updateMany({
    where: { archived: false, urlExpiresAt: null, playable: true },
    data: { urlExpiresAt: new Date('2020-01-01'), urlSource: 'unknown' },
  });
  console.log('Updated songs with null expiry:', r.count);

  // Check remaining state
  const total = await p.song.count({ where: { archived: false } });
  const valid = await p.song.count({ where: { archived: false, playable: true, urlExpiresAt: { gt: new Date() } } });
  const expired = await p.song.count({ where: { archived: false, playable: true, urlExpiresAt: { lt: new Date() } } });
  const noExpiry = await p.song.count({ where: { archived: false, urlExpiresAt: null } });
  console.log(`\nState: Total=${total}, Valid=${valid}, Expired=${expired}, NoExpiry=${noExpiry}`);
  console.log('Valid rate:', (valid / total * 100).toFixed(1) + '%');

  await p.$disconnect();
})();
