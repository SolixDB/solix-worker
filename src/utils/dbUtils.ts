import { decrypt } from "../lib/encrypt";
import { Database, Prisma, PrismaClient } from "@prisma/client";

export async function createDatabaseIfNotExists(dbConfig: Database) {
  const rootClient = new PrismaClient({
    datasources: {
      db: {
        url: `postgresql://${dbConfig.username}:${decrypt(dbConfig.password)}@${dbConfig.host}:${dbConfig.port}/postgres?sslmode=require`,
      },
    },
  });

  try {
    await rootClient.$connect();

    const [{ exists }] = await rootClient.$queryRaw<{ exists: boolean }[]>(Prisma.sql`SELECT EXISTS (SELECT FROM pg_database WHERE datname = ${dbConfig.name}) AS "exists";`);

    if (!exists) {
      await rootClient.$executeRawUnsafe(`CREATE DATABASE "${dbConfig.name}";`);
      console.log(`Database ${dbConfig.name} created.`);
    }
  } finally {
    await rootClient.$disconnect();
  }
}

export async function getDatabaseClient(dbConfig: Database) {
  await createDatabaseIfNotExists(dbConfig);
  return new PrismaClient({
    datasources: {
      db: {
        url: `postgresql://${dbConfig.username}:${decrypt(dbConfig.password)}@${dbConfig.host}:${dbConfig.port}/${dbConfig.name}?sslmode=require`,
      },
    },
  });
}

export async function pingPrismaDatabase(db: PrismaClient): Promise<boolean> {
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      console.warn("Prisma DB ping failed:", err.message);
    }
    return false;
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 5,
  delayMs = 2000
): Promise<T | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < retries) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          console.warn("Prisma DB ping failed:", err.message);
        }
        await new Promise((res) => setTimeout(res, delayMs));
      } else {
        console.error(`All ${retries} attempts failed.`);
      }
    }
  }
  return null;
}