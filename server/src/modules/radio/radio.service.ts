/**
 * Radio Service - 个人电台业务逻辑
 */

import { PrismaClient } from '@prisma/client';
import { chatWithAgent } from './agent';
import { isLLMConfigured } from '../../lib/llm-provider';

export class RadioService {
  constructor(private prisma: PrismaClient) {
    // BigInt 序列化支持
    if (typeof (BigInt.prototype as any).toJSON !== 'function') {
      (BigInt.prototype as any).toJSON = function () {
        return this.toString();
      };
    }
  }

  async createSession(userId: number) {
    return this.prisma.radioSession.create({
      data: { userId, title: null },
    });
  }

  async getSessions(userId: number) {
    return this.prisma.radioSession.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { content: true },
        },
      },
    });
  }

  async getSessionMessages(userId: number, sessionId: number) {
    const session = await this.prisma.radioSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) throw new Error('Session not found');

    return this.prisma.radioMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async deleteSession(userId: number, sessionId: number) {
    const session = await this.prisma.radioSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) throw new Error('Session not found');

    await this.prisma.radioSession.delete({ where: { id: sessionId } });
    return { success: true };
  }

  async sendMessage(userId: number, sessionId: number, input: string) {
    if (!isLLMConfigured()) {
      throw new Error('LLM not configured. Please set OPENAI_API_KEY or switch to Ollama (LLM_PROVIDER=ollama)');
    }

    // 验证会话属于当前用户
    const session = await this.prisma.radioSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) throw new Error('Session not found');

    // 保存用户消息
    await this.prisma.radioMessage.create({
      data: { sessionId, role: 'user', content: input },
    });

    // 获取聊天历史（只取最近 10 条，与 agent 侧保持一致）
    const history = await this.prisma.radioMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: 10,
      select: { role: true, content: true },
    });

    // 调用 Agent
    const result = await chatWithAgent(this.prisma, userId, input, history);

    // 保存 AI 回复（合并标题更新为单次写入）
    const aiMessage = await this.prisma.radioMessage.create({
      data: {
        sessionId,
        role: 'assistant',
        content: result.output,
        songs: result.songs.length > 0 ? result.songs : undefined,
      },
    });

    // 如果是第一条消息，自动生成会话标题（与消息保存并行）
    if (!session.title) {
      const title = input.length > 30 ? input.substring(0, 30) + '...' : input;
      // 不 await，让标题更新异步执行
      this.prisma.radioSession.update({
        where: { id: sessionId },
        data: { title },
      }).catch(() => {});
    }

    return {
      message: aiMessage,
      songs: result.songs,
    };
  }

  async quickRecommend(userId: number) {
    if (!isLLMConfigured()) {
      throw new Error('LLM not configured');
    }
    // 可达性预检（带 60s 缓存）：Ollama/云端不可达时秒级失败，
    // 避免用户请求挂起 30s+ 等底层连接超时
    const { checkLLMReachable } = await import('../../lib/llm-health');
    if (!(await checkLLMReachable())) {
      const err = new Error('LLM 服务暂不可达，请稍后重试或检查本地 Ollama 服务');
      (err as Error & { statusCode?: number }).statusCode = 503;
      throw err;
    }

    // 创建新会话
    const session = await this.createSession(userId);

    // 直接调用 sendMessage（它会处理消息保存、历史获取、agent调用）
    const result = await this.sendMessage(
      userId,
      Number(session.id),
      '请根据我的听歌历史和个性化数据，为我推荐一些歌曲。先了解我的音乐品味，然后推荐5-10首适合我当前状态的歌曲。',
    );

    return {
      sessionId: session.id.toString(),
      ...result,
    };
  }

  async updatePreference(userId: number, key: string, value: string, score: number) {
    return this.prisma.userPreferenceMemory.upsert({
      where: { userId_key: { userId, key } },
      update: { value, score },
      create: { userId, key, value, score },
    });
  }

  async getPreferences(userId: number) {
    return this.prisma.userPreferenceMemory.findMany({
      where: { userId },
      orderBy: { score: 'desc' },
    });
  }

  isConfigured(): boolean {
    return isLLMConfigured();
  }
}
