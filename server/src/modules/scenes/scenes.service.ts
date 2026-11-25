import prisma from '../../lib/prisma';

interface SceneData {
  name: string;
  icon?: string;
}

export class ScenesService {
  async getScenes() {
    const scenes = await prisma.scene.findMany({
      orderBy: { id: 'asc' },
    });
    return scenes;
  }

  async createScene(data: SceneData) {
    const scene = await prisma.scene.create({
      data: {
        name: data.name,
        icon: data.icon,
      },
    });

    return scene;
  }

  async updateScene(id: number, data: Partial<SceneData>) {
    const existing = await prisma.scene.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('场景不存在');
    }

    const scene = await prisma.scene.update({
      where: { id },
      data,
    });

    return scene;
  }

  async deleteScene(id: number) {
    const existing = await prisma.scene.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('场景不存在');
    }

    const songCount = await prisma.songScene.count({
      where: { sceneId: id },
    });
    if (songCount > 0) {
      throw new Error('该场景下存在关联歌曲，无法删除');
    }

    await prisma.scene.delete({ where: { id } });
    return { message: '场景已删除' };
  }
}
