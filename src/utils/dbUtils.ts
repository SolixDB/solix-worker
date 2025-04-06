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
