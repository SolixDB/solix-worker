import prisma from "../db/prisma";
import { TRANSFER } from "../types/params";
import { getDatabaseClient, pingPrismaDatabase, withRetry } from "../utils/dbUtils";
import { ensureTransferTableExists, insertTransferData } from "../utils/tableUtils";

interface FeedData {
  databaseId: string;
  transactions: any;
}

export default async function feedData(webhookData: FeedData) {
  console.time("Total feedData");
  const { databaseId, transactions } = webhookData;

  if (!databaseId || !transactions) return;

  const database = await prisma.database.findUnique({
    where: { id: databaseId },
  });
  if (!database) {
    console.error(`Database with ID ${databaseId} not found.`);
    return;
  }

  const db = await getDatabaseClient(database);
  const dbReady = await withRetry(() => pingPrismaDatabase(db), 5, 3000);
  if (!dbReady) {
    console.error(`Database ${databaseId} not ready after retries.`);
    return;
  }

  let transferTableChecked = false;
  for (const txn of transactions) {
    const type = txn.type;
    switch (type) {
      case TRANSFER:
        if (!transferTableChecked) {
          await ensureTransferTableExists(db, TRANSFER);
          transferTableChecked = true;
        }

        const data = {
          slot: txn.slot,
          signature: txn.signature,
          feePayer: txn.feePayer || txn.transaction?.message?.accountKeys[0] || "unknown",
          fee: txn.fee || 0,
          description: txn.description || null,
          accountData: txn.accountData || [],
          instructions: txn.instructions || [],
        };

        await insertTransferData(db, TRANSFER, data);
        break;
      default:
        break;
    }
  }

}