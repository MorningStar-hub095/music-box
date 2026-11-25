/**
 * 清理全零 DNA 数据脚本
 *
 * 将所有用户的全零 emotionDna 和 social_dna 记录清除，
 * 让新的阈值逻辑生效（不足阈值时不持久化）
 */
const path = require('path');
const { PrismaClient } = require(path.resolve(__dirname, '..', 'server', 'node_modules', '@prisma', 'client'));
const prisma = new PrismaClient();

async function main() {
  console.log('========== 清理全零 DNA 数据 ==========\n');

  // 1. 清理全零 emotionDna
  const users = await prisma.user.findMany({
    where: { emotionDna: { not: null } },
    select: { id: true, username: true, emotionDna: true },
  });

  let clearedEmotion = 0;
  for (const u of users) {
    const dna = u.emotionDna;
    if (dna && dna.vector) {
      const isAllZero = Object.values(dna.vector).every((v) => v === 0);
      if (isAllZero || dna.eventCount === 0) {
        await prisma.user.update({
          where: { id: u.id },
          data: { emotionDna: null },
        });
        console.log(`  清理用户 ${u.username} (id=${u.id}) 的全零 emotionDna`);
        clearedEmotion++;
      }
    }
  }
  console.log(`\n清理 emotionDna: ${clearedEmotion} 条\n`);

  // 2. 清理全零 social_dna
  const socialDnas = await prisma.socialDna.findMany();
  let clearedSocial = 0;
  for (const sd of socialDnas) {
    const v = sd.vectorJson;
    const vector = v?.vector || v;
    if (Array.isArray(vector) && vector.every((x) => x === 0)) {
      await prisma.socialDna.delete({ where: { id: sd.id } });
      console.log(`  清理 social_dna id=${sd.id} userId=${sd.userId} 的全零向量`);
      clearedSocial++;
    }
  }
  console.log(`\n清理 social_dna: ${clearedSocial} 条\n`);

  // 3. 统计结果
  const totalUsers = await prisma.user.count();
  const withEmotionDna = await prisma.user.count({ where: { emotionDna: { not: null } } });
  const withSocialDna = await prisma.socialDna.count();
  console.log('========== 清理后统计 ==========');
  console.log(`  总用户数: ${totalUsers}`);
  console.log(`  有效 emotionDna: ${withEmotionDna}`);
  console.log(`  有效 social_dna: ${withSocialDna}`);

  // 4. 检查用户"111"的状态
  const user111 = await prisma.user.findFirst({
    where: { username: '111' },
    select: { id: true, username: true, emotionDna: true },
  });
  if (user111) {
    const socialDna111 = await prisma.socialDna.findUnique({ where: { userId: user111.id } });
    console.log('\n========== 用户"111"状态 ==========');
    console.log(`  id: ${user111.id}`);
    console.log(`  emotionDna: ${user111.emotionDna ? '已清理(待重新计算)' : '无(待生成)'}`);
    console.log(`  social_dna: ${socialDna111 ? '存在' : '已清理(待重新生成)'}`);
  }

  await prisma.$disconnect();
  console.log('\n========== 完成 ==========');
}

main().catch((e) => {
  console.error('清理失败:', e);
  process.exit(1);
});
