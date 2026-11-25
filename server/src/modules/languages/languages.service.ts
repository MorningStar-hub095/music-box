import prisma from '../../lib/prisma';

interface LanguageData {
  name: string;
  code: string;
}

export class LanguagesService {
  async getLanguages() {
    const languages = await prisma.language.findMany({
      orderBy: { id: 'asc' },
    });
    return languages;
  }

  async createLanguage(data: LanguageData) {
    const existing = await prisma.language.findUnique({
      where: { code: data.code },
    });
    if (existing) {
      throw new Error('语言代码已存在');
    }

    const language = await prisma.language.create({
      data: {
        name: data.name,
        code: data.code,
      },
    });

    return language;
  }

  async updateLanguage(id: number, data: Partial<LanguageData>) {
    const existing = await prisma.language.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('语言不存在');
    }

    if (data.code && data.code !== existing.code) {
      const codeExists = await prisma.language.findUnique({
        where: { code: data.code },
      });
      if (codeExists) {
        throw new Error('语言代码已存在');
      }
    }

    const language = await prisma.language.update({
      where: { id },
      data,
    });

    return language;
  }

  async deleteLanguage(id: number) {
    const existing = await prisma.language.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('语言不存在');
    }

    const songCount = await prisma.songLanguage.count({
      where: { languageId: id },
    });
    if (songCount > 0) {
      throw new Error('该语言下存在关联歌曲，无法删除');
    }

    await prisma.language.delete({ where: { id } });
    return { message: '语言已删除' };
  }
}
