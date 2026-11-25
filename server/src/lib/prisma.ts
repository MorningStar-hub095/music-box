import { PrismaClient } from '@prisma/client';
import { config } from '../config';

const databaseUrl = config.databaseUrl;
const separator = databaseUrl.includes('?') ? '&' : '?';
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `${databaseUrl}${separator}connection_limit=20&pool_timeout=10`,
    },
  },
});

export default prisma;
