import prisma from '../../lib/prisma';

export class AuditController {
  // 获取实体操作历史
  async getHistory(targetType: string, targetId: string, limit = 50) {
    try {
      console.log(`[AUDIT-INFO] 获取操作历史: targetType=${targetType}, targetId=${targetId}`);

      const history = await prisma.operationLog.findMany({
        where: {
          targetType,
          targetId: String(targetId),
        },
        include: {
          user: {
            select: { id: true, username: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      console.log(`[AUDIT-INFO] 返回 ${history.length} 条操作记录`);
      return history;
    } catch (error) {
      console.error('[AUDIT-ERROR] 获取操作历史失败:', error);
      throw error;
    }
  }

  // 获取用户操作历史
  async getUserHistory(userId: number, limit = 50) {
    try {
      console.log(`[AUDIT-INFO] 获取用户操作历史: userId=${userId}`);

      const history = await prisma.operationLog.findMany({
        where: {
          userId,
        },
        include: {
          user: {
            select: { id: true, username: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      console.log(`[AUDIT-INFO] 返回 ${history.length} 条操作记录`);
      return history;
    } catch (error) {
      console.error('[AUDIT-ERROR] 获取用户操作历史失败:', error);
      throw error;
    }
  }

  // 获取最近操作记录
  async getRecent(limit = 20) {
    try {
      console.log(`[AUDIT-INFO] 获取最近操作记录: limit=${limit}`);

      const history = await prisma.operationLog.findMany({
        include: {
          user: {
            select: { id: true, username: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      console.log(`[AUDIT-INFO] 返回 ${history.length} 条操作记录`);
      return history;
    } catch (error) {
      console.error('[AUDIT-ERROR] 获取最近操作记录失败:', error);
      throw error;
    }
  }

  // 获取操作统计
  async getStats(days = 30) {
    try {
      console.log(`[AUDIT-INFO] 获取操作统计: days=${days}`);

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // 按操作类型统计
      const actionStats = await prisma.operationLog.groupBy({
        by: ['action'],
        where: {
          createdAt: { gte: startDate },
        },
        _count: true,
      });

      // 按目标类型统计
      const targetTypeStats = await prisma.operationLog.groupBy({
        by: ['targetType'],
        where: {
          createdAt: { gte: startDate },
        },
        _count: true,
      });

      // 每日操作数量
      const dailyStats = await prisma.$queryRaw`
        SELECT
          DATE(created_at) as date,
          COUNT(*) as count
        FROM operation_logs
        WHERE created_at >= ${startDate}
        GROUP BY DATE(created_at)
        ORDER BY date DESC
        LIMIT 30
      `;

      return {
        actionStats: actionStats.map(a => ({
          action: a.action,
          count: a._count,
        })),
        targetTypeStats: targetTypeStats.map(t => ({
          targetType: t.targetType,
          count: t._count,
        })),
        dailyStats,
        period: {
          start: startDate.toISOString(),
          end: new Date().toISOString(),
          days,
        },
      };
    } catch (error) {
      console.error('[AUDIT-ERROR] 获取操作统计失败:', error);
      throw error;
    }
  }
}

export const auditController = new AuditController();
