const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixDates() {
  try {
    console.log('Fixing invalid datetime values in database...');
    
    // Disable strict mode temporarily to allow invalid dates
    console.log('\n1. Setting SQL mode to allow invalid dates...');
    await prisma.$executeRaw`SET sql_mode = ''`;
    console.log('SQL mode set successfully');
    
    // Fix songs with invalid updated_at
    console.log('\n2. Fixing invalid updated_at values...');
    const result = await prisma.$executeRaw`
      UPDATE songs 
      SET updated_at = NOW() 
      WHERE updated_at IS NULL 
         OR updated_at = '0000-00-00 00:00:00'
         OR updated_at = '0000-00-00'
    `;
    console.log(`Fixed ${result} songs with invalid updated_at`);
    
    // Also fix created_at if needed
    console.log('\n3. Fixing invalid created_at values...');
    const result2 = await prisma.$executeRaw`
      UPDATE songs 
      SET created_at = NOW() 
      WHERE created_at IS NULL 
         OR created_at = '0000-00-00 00:00:00'
         OR created_at = '0000-00-00'
    `;
    console.log(`Fixed ${result2} songs with invalid created_at`);
    
    // Re-enable strict mode
    console.log('\n4. Re-enabling strict SQL mode...');
    await prisma.$executeRaw`SET sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'`;
    console.log('Strict mode re-enabled');
    
    // Verify the fix
    console.log('\n5. Verifying the fix...');
    const songs = await prisma.song.findMany({
      take: 5,
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    
    console.log('\nSample songs after fix:');
    songs.forEach(song => {
      console.log(`  - ${song.title}: created=${song.createdAt}, updated=${song.updatedAt}`);
    });
    
    // Test the getSongs query
    console.log('\n6. Testing getSongs query...');
    const testResult = await prisma.song.findMany({
      take: 3,
      orderBy: { hotScore: 'desc' },
    });
    console.log(`Successfully fetched ${testResult.length} songs`);
    
    console.log('\n✅ Date fix completed successfully!');
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

fixDates();
