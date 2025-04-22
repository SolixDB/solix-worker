import { Cluster, Database, IndexParams, IndexType, Plan } from "@prisma/client";
import { globalCache } from "../cache/globalCache";
import { redis } from "../db/redis";

export interface CachedSettings {
  databaseId: string;
  targetAddr: string;
  indexType: IndexType;
  indexParams: IndexParams[];
  cluster: Cluster;
  userId: string;
}

export interface CachedUser {
  id: string;
  email: string;
  credits: number;
  plan: Plan;
  createdAt: Date;
  databases: Database[];
}

export async function cacheData(
  user: CachedUser,
  database: Database,
  targetAddr: string,
  indexType: IndexType,
  indexParams: IndexParams[],
  cluster: Cluster,
) {
  const userKey = `user:${database.id}`;
  const dbKey = `database:${database.id}`;
  const settingsKey = `settings:${targetAddr}`;

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
    const settings: CachedSettings = { databaseId: database.id, targetAddr, indexType, indexParams, cluster, userId: user.id };
    await redis.set(settingsKey, JSON.stringify(settings));
  }
}

export async function getData(targetAddr: string) {
  // Check In-memory cache
  let settings: CachedSettings | undefined;
  for (const s of globalCache.settings) {
    if (s.targetAddr === targetAddr) {
      settings = s;
      globalCache.reducedRedisCalls++;
      break;
    }
  }

  // If not in-memory, fetch all settings from Redis ONCE
  if (!settings) {
    const keys = await redis.keys("settings:*");

    if (keys.length > 0) {
      const allSettings = await redis.mget(...keys);
      for (const val of allSettings) {
        if (!val) continue;
        const parsed: CachedSettings = JSON.parse(val);
        globalCache.settings.add(parsed);
        if (parsed.targetAddr === targetAddr) {
          settings = parsed;
        }
      }
    }
  }

  if (!settings) throw new Error(`Settings not found for targetAddr: ${targetAddr}`);

  // Try In-memory user
  let user: CachedUser | undefined;
  for (const u of globalCache.users) {
    if (u.id === settings.userId) {
      user = u;
      globalCache.reducedRedisCalls++;
      break;
    }
  }

  // Try In-memory database
  let database: Database | undefined;
  for (const db of globalCache.databases) {
    if (db.id === settings.databaseId) {
      database = db;
      globalCache.reducedRedisCalls++;
      break;
    }
  }

  // Fetch from Redis only if not in memory
  if (!user) {
    const userVal = await redis.get(`user:${settings.databaseId}`);
    if (userVal) {
      user = JSON.parse(userVal);
      if (user) globalCache.users.add(user);
    }
  }

  if (!database) {
    const dbVal = await redis.get(`database:${settings.databaseId}`);
    if (dbVal) {
      database = JSON.parse(dbVal);
      if (database) globalCache.databases.add(database);
    }
  }

  if (!user || !database) throw new Error("User or Database not found");

  return { user, database, settings };
}