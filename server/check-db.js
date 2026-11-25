const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkDatabase() {
  try {
    console.log('Checking database for invalid datetime values...');
    
    // Check songs with raw query
    const songs = await prisma.$queryRaw`SELECT id, title, updated_at, created_at FROM songs LIMIT 10`;
    console.log('\nSongs data:');
    songs.forEach(song => {
      console.log(`ID: ${song.id}, Title: ${song.title}`);
      console.log(`  created_at: ${song.created_at} (type: ${typeof song.created_at})`);
      console.log(`  updated_at: ${song.updated_at} (type: ${typeof song.updated_at})`);
    });
    
    // Check for invalid dates
    console.log('\nChecking for invalid dates...');
    const invalidDates = await prisma.$queryRaw`
      SELECT id, title, updated_at 
      FROM songs 
      WHERE updated_at IS NULL 
         OR updated_at = '0000-00-00 00:00:00'
         OR updated_at = '0000-00-00'
         OR YEAR(updated_at) = 0
         OR MONTH(updated_at) = 0
         OR DAY(updated_at) = 0
    `;
    
    if (invalidDates.length > 0) {
      console.log(`Found ${invalidDates.length} songs with invalid dates:`);
      invalidDates.forEach(song => {
        console.log(`  - ${song.id}: ${song.title} (updated_at: ${song.updated_at})`);
      });
    } else {
      console.log('No invalid dates found in updated_at column.');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkDatabase();
