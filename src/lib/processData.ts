import prisma from "../db/prisma";
import { redis } from "../db/redis";
import { getCachedData } from "../lib/cacheData";
import { Database, PrismaClient, User } from "@prisma/client";
import { decrypt } from "../lib/encrypt";

export default async function processData(webhookData: any) {
  const { accountAddress, transactionType, data } = webhookData;

  const { databases, settings, users } = await getCachedData();
  if (!databases || !settings) {
    return null;
  }

  for (const s of settings) {
    // Update users credits
    const user = users.find((u: User) => u.id === s.databaseId);

    // Updated User
    const updatedUser = await updateUserCredits(user?.id, s.databaseId)
    if (!updatedUser) {
      return null;
    } else {
      if (updatedUser.credits > 100) {
        if (s.targetAddr === accountAddress && s.indexParams.includes(transactionType)) {
          const cachedDatabase = databases.find((db: Database) => db.id === s.databaseId);
          if (cachedDatabase) {
            const db = await getDatabaseClient(cachedDatabase);

            try {
              await db.$connect();
              const tableName = s.indexType || "transactions";
              await ensureTableExists(db, tableName);
              await insertTransaction(db, tableName, accountAddress, transactionType, data);
            } catch (error) {
              console.error(`Error storing data in database ${cachedDatabase.name}:`, error);
            } finally {
              await db.$disconnect();
            }
          }
        }
      } else {
        // Update the webhook
        await redis.del(`user:${s.databaseId}`);
        await redis.del(`settings:${s.databaseId}`);
        await redis.del(`database:${s.databaseId}`);
      }
    }

  }
}

async function updateUserCredits(userId: string | undefined, databaseId: string) {
  let user = await prisma.user.findUnique({ where: { id: userId } });

  if (user) {
    user.credits -= 1;
    await prisma.user.update({
      where: { id: userId },
      data: { credits: user.credits },
    });
    redis.set(`user:${databaseId}`, JSON.stringify(user));
    return user;
  } else {
    redis.del(`user:${databaseId}`);
    redis.del(`database:${databaseId}`);
    redis.del(`settings:${databaseId}`);
    return null;
  }
}


async function getDatabaseClient(cachedDatabase: Database) {
  const decryptedPassword = decrypt(cachedDatabase.password);
  return new PrismaClient({
    datasources: {
      db: {
        url: `postgresql://${cachedDatabase.username}:${decryptedPassword}@${cachedDatabase.host}:${cachedDatabase.port}/${cachedDatabase.name}`,
      }
    }
  });
}

async function ensureTableExists(db: PrismaClient, tableName: string) {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id SERIAL PRIMARY KEY,
      account_address TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function insertTransaction(
  db: PrismaClient,
  tableName: string,
  accountAddress: string,
  transactionType: string,
  data: any
) {
  await db.$executeRawUnsafe(
    `INSERT INTO ${tableName} (account_address, transaction_type, data) VALUES ($1, $2, $3)`,
    accountAddress,
    transactionType,
    JSON.stringify(data)
  );
}
