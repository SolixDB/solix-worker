import { Redis } from '@upstash/redis';
import Bull from 'bull';
import "dotenv/config";
import express from 'express';
import processData from './lib/processData';

const REDIS_URL = process.env.REDIS_URL;
const REDIS_TOKEN = process.env.REDIS_TOKEN;
const REDIS_QUEUE_NAME = process.env.REDIS_QUEUE_NAME || 'webhookQueue';

export const redis = new Redis({
  url: REDIS_URL,
  token: REDIS_TOKEN,
});

// Create a Bull queue to process jobs
const webhookQueue = new Bull(REDIS_QUEUE_NAME, {
  redis: {
    host: REDIS_URL,
    password: REDIS_TOKEN,
    tls: {},
  },
});

// Health check endpoint for monitoring
const app = express();
app.get('/health', (req, res) => {
  res.send('Worker is alive');
});
app.listen(5555, () => {
  console.log('Health check server running on port 5555');
});

// Define the job processing function
webhookQueue.process(10, async (job) => { // Process up to 10 jobs concurrently
  console.log('Processing job:', job.id, 'Data:', job.data);
  try {
    const result = await processData(job.data);
    console.log(`✅ Job ${job.id} processed successfully.`);
    return result;
  } catch (error) {
    console.error(`❌ Job ${job.id} failed:`, error);
    throw error;
  }
});

// Listen for completed jobs
webhookQueue.on('completed', (job, result) => {
  console.log(`Job completed with result: ${result}`);
});

// Listen for failed jobs
webhookQueue.on('failed', (job, error) => {
  console.error(`Job failed with error: ${error.message}`);
});

// Gracefully handle shutdown
process.on('SIGINT', () => {
  console.log('Worker shutting down...');
  webhookQueue.close().then(() => {
    console.log('Worker gracefully shut down.');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('Worker shutting down...');
  webhookQueue.close().then(() => {
    console.log('Worker gracefully shut down.');
    process.exit(0);
  });
});
