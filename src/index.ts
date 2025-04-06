import { Worker } from 'bullmq';
import "dotenv/config";
import express from 'express';
import { redis } from './db/redis';
import processData from './lib/processData';

const REDIS_QUEUE_NAME = process.env.REDIS_QUEUE_NAME || 'webhookQueue';

const webhookWorker = new Worker(
  REDIS_QUEUE_NAME,
  async (job) => {
    const { data } = job;
    await processData(data);
  },
  {
    connection: redis,
    concurrency: 2,
  }
);

webhookWorker.on("ready", () => {
  console.log("✅ BullMQ worker started");
});

webhookWorker.on("ioredis:close", () => {
  console.warn("⚠️ IO Redis connection closed");
});

webhookWorker.on('completed', (job) => {
  console.log(`✅ Job ${job.id} has completed.`);
});

webhookWorker.on('failed', (job, err) => {
  console.error(`❌ Job ${job?.id} failed with error:`, err);
});

webhookWorker.on('progress', (job, progress) => {
  console.log(`📊 Job ${job.id} progress:`, progress);
});

// Redis event listeners
redis.on("connect", () => console.log("🔌 Redis connected"));
redis.on("ready", () => console.log("🚀 Redis ready"));
redis.on("error", (err) => console.error("🔥 Redis error:", err));
redis.on("close", () => console.warn("🔒 Redis connection closed"));
redis.on("reconnecting", () => console.info("♻️ Redis reconnecting..."));

// Redis keep-alive ping every 1 minute
setInterval(async () => {
  try {
    await redis.ping();
    console.log(`[${new Date().toISOString()}] 🔄 Redis ping`);
  } catch (err) {
    console.error("❗ Redis ping failed:", err);
  }
}, 60_000);

// Worker heartbeat
setInterval(() => {
  console.log(`[${new Date().toISOString()}] ❤️ Worker heartbeat`);
}, 5 * 60_000);

const app = express();
app.get('/health', (req, res) => {
  res.send('✅ Worker is alive');
});
app.listen(5555, () => {
  console.log('Server Running');
});
