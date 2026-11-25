import prisma from '../lib/prisma';

interface AuditLogData {
  userId?: number;
  action: string;
  targetType: string;
  targetId: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  changedFields?: string[];
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditService {
  // 记录操作日志
  async log(data: AuditLogData) {
    return prisma.operationLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        targetType: data.targetType,
        targetId: data.targetId,
        oldValues: data.oldValues || undefined,
        newValues: data.newValues || undefined,
        changedFields: data.changedFields || undefined,
        details: data.details || undefined,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      },
    });
  }

  // 计算变更字段
  calculateChanges(
    oldData: Record<string, any>,
    newData: Record<string, any>
  ): { changedFields: string[]; oldValues: Record<string, any>; newValues: Record<string, any> } {
    const changedFields: string[] = [];
    const oldValues: Record<string, any> = {};
    const newValues: Record<string, any> = {};

    for (const key of Object.keys(newData)) {
      if (oldData[key] !== newData[key]) {
        changedFields.push(key);
        oldValues[key] = oldData[key];
        newValues[key] = newData[key];
      }
    }

    return { changedFields, oldValues, newValues };
  }

  // 获取实体的操作历史
  async getHistory(targetType: string, targetId: string, limit = 50) {
    return prisma.operationLog.findMany({
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
  }

  // 获取用户操作统计
  async getUserStats(userId: number, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return prisma.operationLog.groupBy({
      by: ['action'],
      where: {
        userId,
        createdAt: { gte: startDate },
      },
      _count: true,
    });
  }
}

export const auditService = new AuditService();
