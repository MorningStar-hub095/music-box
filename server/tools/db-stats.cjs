const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  const models = ['user','song','playlist','playlistSong','playHistory','userPreference','searchHistory','capsule','capsuleSong','socialDna','songInteraction','audioErrorLog','comment','commentLike','commentReport'];
  let total = 0;
  for (const m of models) {
    try {
      const count = await p[m].count();
      if (count > 0) {
        console.log(m + ': ' + count);
        total += count;
      }
    } catch(e) { /* skip */ }
  }
  console.log('---');
  console.log('Total rows: ' + total);
  await p.$disconnect();
}
main().catch(e => { console.error(e.message); p.$disconnect(); });
