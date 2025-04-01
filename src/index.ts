import { Redis } from '@upstash/redis';
import Bull from 'bull';
import "dotenv/config";
import processData from './lib/processData';

const REDIS_URL = process.env.REDIS_URL;
const REDIS_TOKEN = process.env.REDIS_TOKEN;
const REDIS_QUEUE_NAME = process.env.REDIS_QUEUE_NAME || 'webhookQueue';

export const redis = new Redis({
  url: REDIS_URL,
  token: REDIS_TOKEN,
})

// Create a Bull queue to process jobs
const webhookQueue = new Bull(REDIS_QUEUE_NAME, {
  redis: {
    host: REDIS_URL,
    password: REDIS_TOKEN,
    tls: {},
  },
});

console.log("Worker started");

// Define the job processing function
webhookQueue.process(async (job) => {
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