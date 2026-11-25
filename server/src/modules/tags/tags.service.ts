import prisma from '../../lib/prisma';

interface TagData {
  name: string;
  parentId?: number;
  userId?: number;
}

export class TagsService {
  async getTags() {
    const tags = await prisma.tag.findMany({
      include: {
        children: true,
      },
      orderBy: { id: 'asc' },
    });

    // 构建树形结构：只返回顶级标签，children作为嵌套
    const topLevel = tags.filter((t) => !t.parentId);

    const buildTree = (items: any[]): any[] => {
      return items.map((item) => ({
        ...item,
        children: tags
          .filter((t) => t.parentId === item.id)
          .map((child) => ({
            ...child,
            children: tags
              .filter((t) => t.parentId === child.id)
              .map((grandchild) => ({
                ...grandchild,
                children: tags.filter((t) => t.parentId === grandchild.id),
              })),
          })),
      }));
    };

    return buildTree(topLevel);
  }

  async createTag(data: TagData) {
    let level = 1;
    if (data.parentId) {
      const parent = await prisma.tag.findUnique({
        where: { id: data.parentId },
      });
      if (!parent) {
        throw new Error('父级标签不存在');
      }
      level = parent.level + 1;
    }

    const tag = await prisma.tag.create({
      data: {
        name: data.name,
        parentId: data.parentId,
        level,
        userId: data.userId,
      },
    });

    return tag;
  }

  async updateTag(id: number, data: Partial<TagData>) {
    const existing = await prisma.tag.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('标签不存在');
    }

    let level = existing.level;
    if (data.parentId !== undefined) {
      if (data.parentId === id) {
        throw new Error('不能将标签设为自己的子分类');
      }
      if (data.parentId) {
        const parent = await prisma.tag.findUnique({
          where: { id: data.parentId },
        });
        if (!parent) {
          throw new Error('父级标签不存在');
        }
        level = parent.level + 1;
      } else {
        level = 1;
      }
    }

    const tag = await prisma.tag.update({
      where: { id },
      data: {
        ...data,
        level,
      },
    });

    return tag;
  }

  async deleteTag(id: number) {
    const existing = await prisma.tag.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('标签不存在');
    }

    // 检查是否有子标签
    const childrenCount = await prisma.tag.count({
      where: { parentId: id },
    });
    if (childrenCount > 0) {
      throw new Error('该标签下存在子标签，无法删除');
    }

    // 检查是否有关联歌曲
    const songCount = await prisma.songTag.count({
      where: { tagId: id },
    });
    if (songCount > 0) {
      throw new Error('该标签下存在关联歌曲，无法删除');
    }

    await prisma.tag.delete({ where: { id } });
    return { message: '标签已删除' };
  }
}
