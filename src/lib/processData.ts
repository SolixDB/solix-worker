import { Database, PrismaClient } from "@prisma/client";
import prisma from "../db/prisma";
import { redis } from "../db/redis";
import { getDatabaseClient } from "../utils/dbUtils";
import { ensureTransferTableExists, insertTransferData } from "../utils/tableUtils";
import { CachedUser, getCachedData } from "../lib/cacheData";
import { TRANSFER } from "../types/params";

const HELIUS_API_URL = "https://api.helius.xyz/v0/webhooks";
const HELIUS_MAINNET_API_KEY = process.env.HELIUS_MAINNET_API_KEY;
const WEBHOOK_DEVNET_API_KEY = process.env.WEBHOOK_DEVNET_API_KEY;
const WEBHOOK_DEVNET_SECRET = process.env.WEBHOOK_DEVNET_SECRET;
const WEBHOOK_MAINNET_SECRET = process.env.WEBHOOK_MAINNET_SECRET;
const MAINNET_WEBHOOK_ID = process.env.MAINNET_WEBHOOK_ID;
const DEVNET_WEBHOOK_ID = process.env.DEVNET_WEBHOOK_ID;

export default async function processData(webhookData: any) {
  const { accountData } = webhookData;

  if (!accountData) {
    console.error("Missing required fields for TRANSFER job");
    return;
  }

  const { databases, settings, users } = await getCachedData();
  const accounts = accountData.map((acc: any) => acc.account) || [];

  for (const s of settings) {
    let db: PrismaClient | null = null;

    if (accounts.includes(s.targetAddr)) {
      try {
        let user = users.find((u: CachedUser) => u.databases[0].id === s.databaseId);

        const updatedUser = await updateUserCredits(user?.id, s.databaseId)
        if (!updatedUser) {
          return null;
        }
        user = updatedUser;

        if (user.credits > 100) {
          const databaseId = s.databaseId;
          const database = databases.find((db: Database) => db.id === databaseId);

          if (!database) {
            console.error(`Database not found for ID: ${databaseId}`);
            return;
          }

          db = await getDatabaseClient(database);

          await handleTransaction(db, TRANSFER, webhookData);
        } else {
          const webhookParams = await prisma.params.findFirst();

          const webhookBody = {
            transactionTypes: webhookParams?.transactionTypes,
            accountAddress: webhookParams?.accountAddresses.filter((address: string) => address !== s.targetAddr),
          }

          const WEBHOOK_SECRET = s.cluster === "DEVNET" ? WEBHOOK_DEVNET_SECRET : WEBHOOK_MAINNET_SECRET;
          const WEBHOOK_ID = s.cluster === "DEVNET" ? DEVNET_WEBHOOK_ID : MAINNET_WEBHOOK_ID;
          const HELIUS_API_KEY = s.cluster === "DEVNET" ? WEBHOOK_DEVNET_API_KEY : HELIUS_MAINNET_API_KEY;

          const res = await fetch(`${HELIUS_API_URL}/${WEBHOOK_ID}?api-key=${HELIUS_API_KEY}`, {
            method: "PUT",
            headers: {
              "Authorization": `${WEBHOOK_SECRET}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(webhookBody),
          });
          if (!res.ok) {
            throw new Error(`Webhook update failed with status: ${res.status}`);
          }

          await prisma.$transaction([
            prisma.user.update({
              where: { id: updatedUser.id },
              data: { credits: 0 },
            }),
            prisma.params.update({
              where: { id: webhookParams?.id },
              data: {
                transactionTypes: webhookParams?.transactionTypes,
                accountAddresses: webhookParams?.accountAddresses.filter((address: string) => address !== s.targetAddr),
              },
            }),
          ]);

          clearRedisCache(s.databaseId);
        }
      } catch (error) {
        console.error("Error processing transfer:", error);
      }
      finally {
        if (db) {
          await db.$disconnect();
        }
      }
    }
  }
}

async function handleTransaction(db: PrismaClient, type: string, data: any) {
  switch (type) {
    case TRANSFER:
      const { slot, signature, feePayer, fee, description, accountData, instructions } = data;

      if (!slot || !signature || !feePayer || !fee || !accountData || !instructions) {
        console.error("Missing required fields for TRANSFER job");
        return;
      }

      const tableName = TRANSFER;
      await ensureTransferTableExists(db, tableName);

      await insertTransferData(db, tableName, { slot, signature, feePayer, fee, description, accountData, instructions });
      break;
    default:
      break;
  }
}

async function updateUserCredits(userId: string | undefined, databaseId: string) {
  if (!userId) return null;

  let user = await prisma.user.findUnique({
    where: { id: userId },
    include: { databases: true },
  });

  if (user) {
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { credits: user.credits - 1 },
      include: { databases: true },
    });

    await redis.set(`user:${databaseId}`, JSON.stringify(updatedUser));
    return updatedUser;
  } else {
    clearRedisCache(databaseId);
    console.error(`User not found for ID: ${userId}`);
    return null;
  }
}

function clearRedisCache(databaseId: string) {
  redis.del(`user:${databaseId}`);
  redis.del(`settings:${databaseId}`);
  redis.del(`database:${databaseId}`);
}