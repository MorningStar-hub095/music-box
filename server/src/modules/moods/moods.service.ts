import prisma from '../../lib/prisma';

interface MoodData {
  name: string;
  icon?: string;
}

export class MoodsService {
  async getMoods() {
    const moods = await prisma.mood.findMany({
      orderBy: { id: 'asc' },
    });
    return moods;
  }

  async createMood(data: MoodData) {
    const mood = await prisma.mood.create({
      data: {
        name: data.name,
        icon: data.icon,
      },
    });

    return mood;
  }

  async updateMood(id: number, data: Partial<MoodData>) {
    const existing = await prisma.mood.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('情绪不存在');
    }

    const mood = await prisma.mood.update({
      where: { id },
      data,
    });

    return mood;
  }

  async deleteMood(id: number) {
    const existing = await prisma.mood.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('情绪不存在');
    }

    const songCount = await prisma.songMood.count({
      where: { moodId: id },
    });
    if (songCount > 0) {
      throw new Error('该情绪下存在关联歌曲，无法删除');
    }

    await prisma.mood.delete({ where: { id } });
    return { message: '情绪已删除' };
  }
}
