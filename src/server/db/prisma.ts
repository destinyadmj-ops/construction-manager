import { PrismaClient } from "@/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const prismaGlobal = globalThis as typeof globalThis & {
  __prisma?: PrismaClient;
};

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const adapter = new PrismaPg({ connectionString });

export const prisma = prismaGlobal.__prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") prismaGlobal.__prisma = prisma;
