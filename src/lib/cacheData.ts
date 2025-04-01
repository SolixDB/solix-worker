import { redis } from "../db/redis";
import { Database, IndexParams, IndexType, User } from "@prisma/client";

export interface CachedSettings {
  databaseId: string;
  targetAddr: string;
  indexType: IndexType;
  indexParams: IndexParams[];
}

export async function cacheData(
  user: User,
  database: Database,
  targetAddr: string,
  indexType: IndexType,
  indexParams: IndexParams[]
) {
  const userKey = `user:${database.id}`;
  const dbKey = `database:${database.id}`;
  const settingsKey = `settings:${database.id}`;

  // Check if user is already cached
  const userExists = await redis.exists(userKey);
  if (!userExists) {
    await redis.set(userKey, JSON.stringify(user));
  }

  // Check if database is already cached
  const dbExists = await redis.exists(dbKey);
  if (!dbExists) {
    await redis.set(dbKey, JSON.stringify(database));
  }

  // Check if settings are already cached
  const settingsExists = await redis.exists(settingsKey);
  if (!settingsExists) {
    const settings: CachedSettings = { databaseId: database.id, targetAddr, indexType, indexParams };
    await redis.set(settingsKey, JSON.stringify(settings));
  }
}

export async function getCachedData() {
  const databaseKeys = await redis.keys("database:*");
  const settingsKeys = await redis.keys("settings:*");
  const userKeys = await redis.keys("user:*");

  // Single batch request
  const [dbValues, settingsValues, userValues] = await Promise.all([
    databaseKeys.length ? redis.mget(databaseKeys) : [],
    settingsKeys.length ? redis.mget(settingsKeys) : [],
    userKeys.length ? redis.mget(userKeys) : [],
  ]);

  // Parse only non-null values
  const databases: Database[] = dbValues.filter(Boolean).map((db) => JSON.parse(db as string));
  const settings: CachedSettings[] = settingsValues.filter(Boolean).map((s) => JSON.parse(s as string));
  const users: User[] = userValues.filter(Boolean).map((u) => JSON.parse(u as string));

  return { databases, settings, users };
}
