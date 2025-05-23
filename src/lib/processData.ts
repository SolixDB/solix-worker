import { PrismaClient } from "@prisma/client";
import prisma from "../db/prisma";
import { redis } from "../db/redis";
import { getData } from "../lib/cacheData";
import { TRANSFER } from "../types/params";
import { getPrismaClient, pingPrismaDatabase, withRetry } from "../utils/dbUtils";
import { ensureTransferTableExists, insertTransferData } from "../utils/tableUtils";
import { globalCache } from "../cache/globalCache";

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
  const redisCalls = globalCache.reducedRedisCalls;
  startTimer("Total processData");

  const { accountData, trackedAddresses } = webhookData;
  if (!accountData || !trackedAddresses) return;

  await Promise.allSettled(
    trackedAddresses.map(async (address: string) => {
      try {
        const { user, database, settings } = await getData(address);

        const userLabel = `updateUserCredits:${user.id}`;
        startTimer(userLabel);
        const updatedUser = await updateUserCredits(user.id, database.id);
        endTimer(userLabel);

        if (!updatedUser || updatedUser.credits <= 100) {
          await handleLowCreditUser(settings, updatedUser);
          return;
        }

        const dbClientLabel = `getDatabaseClient:${database.id}`;
        startTimer(dbClientLabel);
        const dbClient = await getPrismaClient(database);
        endTimer(dbClientLabel);

        const dbReady = await withRetry(() => pingPrismaDatabase(dbClient), 5, 3000);
        if (!dbReady) {
          console.error(`Database ${database.id} not ready after retries.`);
          return;
        }

        const txnLabel = `handleTransaction:${database.id}:${webhookData.id ?? webhookData.signature}`;
        startTimer(txnLabel);
        await handleTransaction(dbClient, webhookData.type.toString().toUpperCase(), webhookData);
        endTimer(txnLabel);
      } catch (error) {
        console.error(`Error processing data for address ${address}:`, error);
      }
    })
  );

  console.log("Saved Redis Calls: ", globalCache.reducedRedisCalls - redisCalls);;
  endTimer("Total processData");
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