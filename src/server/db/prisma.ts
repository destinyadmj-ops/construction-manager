import { PrismaClient } from "@/generated/prisma";

const prismaGlobal = globalThis as typeof globalThis & {
  __prisma?: PrismaClient;
};

export const prisma = prismaGlobal.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") prismaGlobal.__prisma = prisma;
