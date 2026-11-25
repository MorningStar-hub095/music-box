import prisma from '../../lib/prisma';

interface GenreData {
  name: string;
  parentId?: number;
  sortOrder?: number;
}

export class GenresService {
  async getGenres() {
    const genres = await prisma.genre.findMany({
      include: {
        children: true,
      },
      orderBy: { sortOrder: 'asc' },
    });

    // 构建树形结构：只返回顶级分类，children作为嵌套
    const topLevel = genres.filter((g) => !g.parentId);

    const buildTree = (items: any[]): any[] => {
      return items.map((item) => ({
        ...item,
        children: genres
          .filter((g) => g.parentId === item.id)
          .map((child) => ({
            ...child,
            children: genres
              .filter((g) => g.parentId === child.id)
              .map((grandchild) => ({
                ...grandchild,
                children: genres.filter((g) => g.parentId === grandchild.id),
              })),
          })),
      }));
    };

    return buildTree(topLevel);
  }

  async createGenre(data: GenreData) {
    let level = 1;
    if (data.parentId) {
      const parent = await prisma.genre.findUnique({
        where: { id: data.parentId },
      });
      if (!parent) {
        throw new Error('父级流派不存在');
      }
      level = parent.level + 1;
    }

    const genre = await prisma.genre.create({
      data: {
        name: data.name,
        parentId: data.parentId,
        level,
        sortOrder: data.sortOrder || 0,
      },
    });

    return genre;
  }

  async updateGenre(id: number, data: Partial<GenreData>) {
    const existing = await prisma.genre.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('流派不存在');
    }

    let level = existing.level;
    if (data.parentId !== undefined) {
      if (data.parentId === id) {
        throw new Error('不能将流派设为自己的子分类');
      }
      if (data.parentId) {
        const parent = await prisma.genre.findUnique({
          where: { id: data.parentId },
        });
        if (!parent) {
          throw new Error('父级流派不存在');
        }
        level = parent.level + 1;
      } else {
        level = 1;
      }
    }

    const genre = await prisma.genre.update({
      where: { id },
      data: {
        ...data,
        level,
      },
    });

    return genre;
  }

  async deleteGenre(id: number) {
    const existing = await prisma.genre.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('流派不存在');
    }

    // 检查是否有子分类
    const childrenCount = await prisma.genre.count({
      where: { parentId: id },
    });
    if (childrenCount > 0) {
      throw new Error('该流派下存在子分类，无法删除');
    }

    // 检查是否有关联歌曲
    const songCount = await prisma.songGenre.count({
      where: { genreId: id },
    });
    if (songCount > 0) {
      throw new Error('该流派下存在关联歌曲，无法删除');
    }

    await prisma.genre.delete({ where: { id } });
    return { message: '流派已删除' };
  }
}
