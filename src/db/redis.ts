import Redis, { RedisOptions } from "ioredis";

const REDIS_URL = process.env.REDIS_URL;

const redisOptions: RedisOptions = {
  maxRetriesPerRequest: null,
};

let redis: Redis;

if (REDIS_URL) {
  redis = new Redis(REDIS_URL, redisOptions);
} else {
  console.error("REDIS_URL environment variable is not set.");
  process.exit(1);
}

export { redis };
