import { Worker } from 'bullmq';
import "dotenv/config";
import express from 'express';
import { redis } from './db/redis';
import processData from './lib/processData';

const REDIS_QUEUE_NAME = process.env.REDIS_QUEUE_NAME || 'webhookQueue';

// Create a BullMQ Worker to listen to the queue
const webhookWorker = new Worker(
  REDIS_QUEUE_NAME,
  async (job) => {
    const { data } = job;

    await processData(data)
  },
  { connection: redis }
);

webhookWorker.on("ready", () => {
  console.log("BullMQ worker started");
})

webhookWorker.on("ioredis:close", () => {
  console.log("IO Redis connection closed");
})

webhookWorker.on('completed', (job) => {
  console.log(`Job ${job.id} has completed.`);
});

webhookWorker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed with error:`, err);
});

// Health check endpoint for monitoring
const app = express();
app.get('/health', (req, res) => {
  res.send('Worker is alive');
});
app.listen(5555, () => {
  console.log('Health check server running on port 5555');
});