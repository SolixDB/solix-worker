import { Status } from '@prisma/client';
import { Job, Worker } from 'bullmq';
import "dotenv/config";
import { globalCache } from './cache/globalCache';
import prisma from './db/prisma';
import { redis } from './db/redis';
import { CachedSettings, CachedUser } from './lib/cacheData';
import feedData from './lib/feedData';
import processData from './lib/processData';

// ==================
// 🔧 Queue Constants
// ==================
const REDIS_QUEUE_NAME = process.env.REDIS_QUEUE_NAME || 'webhookQueue';
const REDIS_FEEDING_QUEUE = process.env.REDIS_FEEDING_QUEUE || 'feedingQueue';

// ========================
// 🛠️ Worker Initialization
// ========================
const webhookWorker = new Worker(
  REDIS_QUEUE_NAME,
  async (job: Job) => {
    console.log(`📥 [WebhookWorker] Received Job ${job.id}`);
    await processData(job.data);
  },
  {
    connection: redis,
    concurrency: 2,
  }
);

const feedingWorker = new Worker(
  REDIS_FEEDING_QUEUE,
  async (job: Job) => {
    console.log(`📥 [FeedingWorker] Received Job ${job.id}`);
    const { transactions, databaseId } = job.data;
    await feedData({ transactions, databaseId });
  },
  {
    connection: redis,
    concurrency: 2,
  }
);

// ====================
// 🧠 Worker Event Logs
// ====================
function bindWorkerEvents(name: string, worker: Worker) {
  worker.on("ready", () => {
    console.log(`🚀 [${name}] Worker ready`);
  });

  worker.on("ioredis:close", () => {
    console.warn(`⚠️ [${name}] Redis connection closed`);
  });

  worker.on("completed", (job) => {
    console.log(`✅ [${name}] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`❌ [${name}] Job ${job?.id} failed with error:`, err);
  });

  worker.on("progress", (job, progress) => {
    console.log(`📊 [${name}] Job ${job.id} progress:`, progress);
  });
}

bindWorkerEvents("WebhookWorker", webhookWorker);
bindWorkerEvents("FeedingWorker", feedingWorker);

// ====================
// 🧪 Redis Event Logs
// ====================
redis.on("connect", () => console.log("🔌 Redis connected"));
redis.on("ready", () => console.log("🚀 Redis ready"));
redis.on("error", (err) => console.error("🔥 Redis error:", err));
redis.on("close", () => console.warn("🔒 Redis connection closed"));
redis.on("reconnecting", () => console.info("♻️ Redis reconnecting..."));

// ============================
// 🫀 Health Checks and Pingers
// ============================
setInterval(async () => {
  try {
    await redis.ping();
    console.log(`[${new Date().toISOString()}] 🔄 Redis ping`);
  } catch (err) {
    console.error("❗ Redis ping failed:", err);
  }
}, 60_000);

setInterval(() => {
  console.log(`[${new Date().toISOString()}] ❤️ Worker heartbeat`);
}, 5 * 60_000);


async function loadInMemoryData() {
  try {
    const indexSettings = await prisma.indexSettings.findMany({
      where: {
        status: Status.IN_PROGRESS,
      },
      include: {
        database: true,
        user: true,
      },
    });

    for (const s of indexSettings) {
      const { user, database } = s;

      // Prepare user for caching
      const cachedUser: CachedUser = {
        id: user.id,
        email: user.email,
        credits: user.credits,
        plan: user.plan,
        createdAt: user.createdAt,
        databases: [database],
      };

      // Avoid duplicate entries in memory
      const settingsKeyExists = [...globalCache.settings].some(setting => setting.targetAddr === s.targetAddr);
      const userExists = [...globalCache.users].some(u => u.id === user.id);
      const dbExists = [...globalCache.databases].some(d => d.id === database.id);

      if (!settingsKeyExists) {
        const cachedSettings: CachedSettings = {
          databaseId: database.id,
          targetAddr: s.targetAddr,
          indexType: s.indexType,
          indexParams: s.indexParams,
          cluster: s.cluster,
          userId: user.id,
        };
        globalCache.settings.add(cachedSettings);
      }

      if (!userExists) globalCache.users.add(cachedUser);
      if (!dbExists) globalCache.databases.add(database);

      return true
    }
  } catch (error) {
    console.error("Error loading in-memory data:", error);
  }
}

(async () => {
  await loadInMemoryData();
  if (true) {
    console.log("Loaded in-memory data");
  }
})();