import { PrismaClient } from '@prisma/client'

// Esta é a melhor prática para evitar criar muitas conexões
// à base de dados, especialmente em ambientes de desenvolvimento.
const globalForPrisma = global as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    // (Opcional) Ative o log de todas as queries no terminal
    // log: ['query'], 
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma