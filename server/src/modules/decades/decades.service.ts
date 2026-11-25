import prisma from '../../lib/prisma';

interface DecadeData {
  name: string;
  startYear?: number;
  endYear?: number;
}

export class DecadesService {
  async getDecades() {
    const decades = await prisma.decade.findMany({
      orderBy: { startYear: 'asc' },
    });
    return decades;
  }

  async createDecade(data: DecadeData) {
    const decade = await prisma.decade.create({
      data: {
        name: data.name,
        startYear: data.startYear,
        endYear: data.endYear,
      },
    });

    return decade;
  }

  async updateDecade(id: number, data: Partial<DecadeData>) {
    const existing = await prisma.decade.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('年代不存在');
    }

    const decade = await prisma.decade.update({
      where: { id },
      data,
    });

    return decade;
  }

  async deleteDecade(id: number) {
    const existing = await prisma.decade.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('年代不存在');
    }

    const songCount = await prisma.songDecade.count({
      where: { decadeId: id },
    });
    if (songCount > 0) {
      throw new Error('该年代下存在关联歌曲，无法删除');
    }

    await prisma.decade.delete({ where: { id } });
    return { message: '年代已删除' };
  }
}
