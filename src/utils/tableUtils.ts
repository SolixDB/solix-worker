import { PrismaClient } from "@prisma/client";

function validateTableName(tableName: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
}

async function withRetry(fn: () => Promise<void>, maxRetries = 5, delayMs = 10000) {
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      await fn();
      return;
    } catch (err) {
      if (err instanceof Error && err.message.includes("relation")) {
        console.warn("Table does not exist, retrying...");
      } else {
        console.error("Error occurred:", err);
      }
      attempt++;

      if (attempt >= maxRetries) {
        console.error("Max retries reached. Operation failed.");
        throw err;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function ensureTransferTableExists(db: PrismaClient, tableName: string) {
  validateTableName(tableName);

  await withRetry(async () => {
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "${tableName}" (
        id SERIAL PRIMARY KEY,
        slot BIGINT NOT NULL,
        signature TEXT NOT NULL UNIQUE,
        fee_payer TEXT NOT NULL,
        fee INTEGER NOT NULL,
        description TEXT,
        account_data JSONB NOT NULL,
        instructions JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  });
}

export async function insertTransferData(
  db: PrismaClient,
  tableName: string,
  data: any
) {
  validateTableName(tableName);

  await withRetry(async () => {
    await db.$connect();

    try {
      await db.$executeRawUnsafe(
        `INSERT INTO "${tableName}" (slot, signature, fee_payer, fee, description, account_data, instructions)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
        ON CONFLICT (signature) DO NOTHING;`,
        data.slot,
        data.signature,
        data.feePayer,
        data.fee,
        data.description,
        JSON.stringify(data.accountData),
        JSON.stringify(data.instructions)
      );
    } finally {
      await db.$disconnect();
    }
  });
}
