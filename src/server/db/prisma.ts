import { PrismaClient } from "@/generated/prisma";

const prismaGlobal = globalThis as typeof globalThis & {
  __prisma?: PrismaClient;
};

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const verifiedConnectionString = connectionString;

function getPgAdapterConfig(connectionString: string) {
  try {
    const url = new URL(connectionString);
    const sslMode = (url.searchParams.get("sslmode") ?? "").toLowerCase();
    const shouldUseSupabaseSsl =
      sslMode === "require" ||
      url.hostname.endsWith(".supabase.co") ||
      url.hostname.endsWith(".pooler.supabase.com");

    if (!shouldUseSupabaseSsl) {
      return { connectionString };
    }

    url.searchParams.delete("sslmode");
    return {
      connectionString: url.toString(),
      ssl: {
        rejectUnauthorized: false,
      },
    };
  } catch {
    return { connectionString };
  }
}

type PrismaClientOptions = ConstructorParameters<typeof PrismaClient>[0];

function getPrismaClientOptions(): PrismaClientOptions | undefined {
  try {
    const runtimeRequire = eval("require") as (id: string) => unknown;
    const adapterModule = runtimeRequire("@prisma/adapter-pg") as {
      PrismaPg?: new (options: { connectionString: string }) => unknown;
    };

    if (typeof adapterModule?.PrismaPg !== "function") {
      return undefined;
    }

    return {
        adapter: new adapterModule.PrismaPg(getPgAdapterConfig(verifiedConnectionString)),
    } as PrismaClientOptions;
  } catch {
    return undefined;
  }
}

export const prisma = prismaGlobal.__prisma ?? new PrismaClient(getPrismaClientOptions());

if (process.env.NODE_ENV !== "production") prismaGlobal.__prisma = prisma;
