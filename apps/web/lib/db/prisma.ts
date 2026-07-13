import { PrismaClient } from "@prisma/client";

// SHARED (Phase 0). Single Prisma client instance, reused across hot reloads in
// dev to avoid exhausting the connection pool. Import from here everywhere —
// never `new PrismaClient()` in feature code.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
