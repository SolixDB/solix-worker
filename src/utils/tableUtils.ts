import { PrismaClient } from "@prisma/client";

function validateTableName(tableName: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
}

export async function ensureTransferTableExists(db: PrismaClient, tableName: string) {
  validateTableName(tableName);

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
}

export async function insertTransferData(
  db: PrismaClient,
  tableName: string,
  data: any
) {
  validateTableName(tableName);

  try {
    await db.$executeRawUnsafe(
      `INSERT INTO "${tableName}" (slot, signature, fee_payer, fee, description, account_data, instructions)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (signature) DO NOTHING;`,
      data.slot,
      data.signature,
      data.feePayer,
      data.fee,
      data.description,
      JSON.stringify(data.accountData),
      JSON.stringify(data.instructions)
    );
  } catch (error) {
    console.error("Error inserting TRANSFER data:", error);
  }
}