import { Database, PrismaClient } from "@prisma/client";
import prisma from "../db/prisma";
import { redis } from "../db/redis";
import { cacheData, CachedUser, getCachedData } from "../lib/cacheData";
import { TRANSFER } from "../types/params";
import { getDatabaseClient, pingPrismaDatabase, withRetry } from "../utils/dbUtils";
import { ensureTransferTableExists, insertTransferData } from "../utils/tableUtils";

const HELIUS_API_URL = "https://api.helius.xyz/v0/webhooks";
const HELIUS_MAINNET_API_KEY = process.env.HELIUS_MAINNET_API_KEY;
const WEBHOOK_DEVNET_API_KEY = process.env.WEBHOOK_DEVNET_API_KEY;
const WEBHOOK_DEVNET_SECRET = process.env.WEBHOOK_DEVNET_SECRET;
const WEBHOOK_MAINNET_SECRET = process.env.WEBHOOK_MAINNET_SECRET;
const MAINNET_WEBHOOK_ID = process.env.MAINNET_WEBHOOK_ID;
const DEVNET_WEBHOOK_ID = process.env.DEVNET_WEBHOOK_ID;

const activeTimers = new Set<string>();

export function startTimer(label: string) {
  if (activeTimers.has(label)) {
    console.warn(`[Timer] '${label}' is already running.`);
    return;
  }
  activeTimers.add(label);
  console.time(label);
}

export function endTimer(label: string) {
  if (!activeTimers.has(label)) {
    console.warn(`[Timer] Tried to end unknown label '${label}'`);
    return;
  }
  console.timeEnd(label);
  activeTimers.delete(label);
}

export default async function processData(webhookData: any) {
  startTimer("Total processData");

  const { accountData } = webhookData;
  if (!accountData) return;

  startTimer("getCachedData");
  let data = await getCachedData();
  let { databases, users, settings = [] } = data;

  endTimer("getCachedData");

  const accounts: Set<string> = new Set(accountData.map((acc: any) => acc.account));
  const dbMap = Object.fromEntries(databases.map((db: Database) => [db.id, db]));
  const userMap = Object.fromEntries(users.map((u: any) => [u.id, u]));

  startTimer("settings loop");
  if (!settings.length) {
    await handleNoSettings(accounts);
  }

  data = await getCachedData();
  settings = data.settings

  if (!settings.length) return;

  await Promise.allSettled(
    settings.map(async (s) => {
      if (!accounts.has(s.targetAddr)) return;

      try {
        let user = userMap[s.userId];

        if (!user) {
          const userLabel = `getUser:${s.userId}`;
          startTimer(userLabel);
          user = await prisma.user.findUnique({
            where: { id: s.userId },
          });
          endTimer(userLabel);

          if (!user) {
            console.warn(`User with ID ${s.userId} not found in DB.`);
            return;
          }
        }

        const userLabel = `updateUserCredits:${s.userId}`;
        startTimer(userLabel);
        const updatedUser = await updateUserCredits(user.id, s.databaseId);
        endTimer(userLabel);

        if (!updatedUser || updatedUser.credits <= 100) {
          await handleLowCreditUser(s, updatedUser);
          return;
        }

        const dbConfig = dbMap[s.databaseId];
        if (!dbConfig) return;

        const dbClientLabel = `getDatabaseClient:${s.databaseId}`;
        startTimer(dbClientLabel);
        const db = await getDatabaseClient(dbConfig);
        endTimer(dbClientLabel);

        const dbReady = await withRetry(() => pingPrismaDatabase(db), 5, 3000);
        if (!dbReady) {
          console.error(`Database ${s.databaseId} not ready after retries.`);
          return;
        }

        const txnLabel = `handleTransaction:${s.databaseId}:${webhookData.id ?? webhookData.signature}`;
        startTimer(txnLabel);
        await handleTransaction(db, webhookData.type.toString().toUpperCase(), webhookData);
        endTimer(txnLabel);
      } catch (err) {
        console.error(`Error processing settings for database ${s.databaseId}:`, err);
      }
    })
  );

  endTimer("settings loop");

  endTimer("Total processData");
}

async function handleNoSettings(accounts: Set<string>) {
  const indexSettings = await prisma.indexSettings.findMany({
    where: {
      targetAddr: {
        in: Array.from(accounts)
      },
      status: "IN_PROGRESS"
    },
    include: {
      database: true,
      user: true
    }
  });

  indexSettings.forEach((s) => {
    const { user, database } = s;

    const cachedUser: CachedUser = {
      id: user.id,
      email: user.email,
      credits: user.credits,
      plan: user.plan,
      createdAt: user.createdAt,
      databases: [database]
    }

    cacheData(
      cachedUser,
      database,
      s.targetAddr,
      s.indexType,
      s.indexParams,
      s.cluster
    )
  })

}

async function handleLowCreditUser(s: any, user: any) {
  const webhookParams = await prisma.params.findFirst();
  const WEBHOOK_SECRET = s.cluster === "DEVNET" ? WEBHOOK_DEVNET_SECRET : WEBHOOK_MAINNET_SECRET;
  const WEBHOOK_ID = s.cluster === "DEVNET" ? DEVNET_WEBHOOK_ID : MAINNET_WEBHOOK_ID;
  const HELIUS_API_KEY = s.cluster === "DEVNET" ? WEBHOOK_DEVNET_API_KEY : HELIUS_MAINNET_API_KEY;

  const webhookBody = {
    transactionTypes: webhookParams?.transactionTypes,
    accountAddress: webhookParams?.accountAddresses.filter((addr: string) => addr !== s.targetAddr),
  };

  const res = await fetch(`${HELIUS_API_URL}/${WEBHOOK_ID}?api-key=${HELIUS_API_KEY}`, {
    method: "PUT",
    headers: {
      "Authorization": `${WEBHOOK_SECRET}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(webhookBody),
  });

  if (!res.ok) return;

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { credits: 0 } }),
    prisma.params.update({
      where: { id: webhookParams?.id },
      data: {
        transactionTypes: webhookParams?.transactionTypes,
        accountAddresses: webhookParams?.accountAddresses.filter((addr: string) => addr !== s.targetAddr),
      },
    }),
  ]);

  clearRedisCache(s.databaseId);
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

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { databases: true },
  });

  if (!user) {
    clearRedisCache(databaseId);
    console.error(`User not found for ID: ${userId}`);
    return null;
  }

  if (user.credits <= 0) {
    console.warn(`User ${userId} has insufficient credits: ${user.credits}`);
    return null;
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { credits: user.credits - 1 },
    include: { databases: true },
  });

  if (updatedUser.credits <= 0) {
    clearRedisCache(databaseId);
  } else {
    await redis.set(`user:${databaseId}`, JSON.stringify(updatedUser));
  }

  return updatedUser;
}

function clearRedisCache(databaseId: string) {
  redis.del(`user:${databaseId}`);
  redis.del(`settings:${databaseId}`);
  redis.del(`database:${databaseId}`);
}