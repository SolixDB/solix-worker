import { Database } from "@prisma/client";
import { CachedSettings, CachedUser } from "../lib/cacheData";

export const globalCache = {
  reducedRedisCalls: 0,
  users: new Set<CachedUser>(),
  databases: new Set<Database>(),
  settings: new Set<CachedSettings>(),
};
