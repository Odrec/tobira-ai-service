/**
 * Queue Service using BullMQ
 * Handles async processing of AI tasks (summaries, quizzes, caption extraction)
 */

import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { config } from '../config';
import db from './database.service';
import { openai } from './openai.service';
import cache from './cache.service';
import { CaptionExtractorService } from './caption-extractor.service';
import { logger } from '../utils/monitoring';

// Job data types
interface SummaryJobData {
  eventId: string;
  language: string;
  forceRegenerate?: boolean;
}

interface QuizJobData {
  eventId: string;
  language: string;
  forceRegenerate?: boolean;
}

interface CaptionExtractionJobData {
  eventId: number;
  language: string;
}

interface BatchCaptionExtractionJobData {
  limit: number;
}

// Redis connection
const connection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null, // Required for BullMQ
});

// Create queues
export const summaryQueue = new Queue('ai-summaries', { connection });
export const quizQueue = new Queue('ai-quizzes', { connection });
export const captionQueue = new Queue('caption-extraction', { connection });

// Queue events for monitoring
const summaryEvents = new QueueEvents('ai-summaries', { connection });
const quizEvents = new QueueEvents('ai-quizzes', { connection });
const captionEvents = new QueueEvents('caption-extraction', { connection });

// ========================================
// Workers
// ========================================

/**
 * Summary Generation Worker
 */
export const summaryWorker = new Worker<SummaryJobData>(
  'ai-summaries',
  async (job: Job<SummaryJobData>) => {
    const { eventId, language, forceRegenerate } = job.data;
    
    logger.info(`Processing summary job for event ${eventId}`, { language });

    try {
      // Check if already exists (unless force regenerate)
      if (!forceRegenerate) {
        const existing = await db.getSummary(eventId, language);
        if (existing) {
          logger.info(`Summary already exists for event ${eventId}, skipping`);
          return { status: 'skipped', reason: 'already_exists' };
        }
      }

      // Get transcript
      const transcript = await db.getTranscript(eventId, language);
      if (!transcript) {
        throw new Error('No transcript found');
      }

      // Update job progress
      await job.updateProgress(30);

      // Generate summary
      const result = await openai.generateSummary(transcript);

      await job.updateProgress(70);

      // Save to database
      await db.saveSummary(
        eventId,
        result.content,
        result.model,
        language,
        result.processingTime
      );

      // Cache the summary
      const cacheKey = `summary:${eventId}:${language}`;
      await cache.set(cacheKey, result.content);

      await job.updateProgress(100);

      logger.info(`Summary generated successfully for event ${eventId}`);

      return {
        status: 'completed',
        eventId,
        language,
        processingTime: result.processingTime,
        model: result.model,
      };
    } catch (error: any) {
      logger.error(`Failed to generate summary for event ${eventId}:`, error);
      throw error; // Will trigger retry
    }
  },
  {
    connection,
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '2', 10),
    limiter: {
      max: 10, // Max 10 jobs per duration
      duration: 60000, // Per minute
    },
  }
);

/**
 * Quiz Generation Worker
 */
export const quizWorker = new Worker<QuizJobData>(
  'ai-quizzes',
  async (job: Job<QuizJobData>) => {
    const { eventId, language, forceRegenerate } = job.data;
    
    logger.info(`Processing quiz job for event ${eventId}`, { language });

    try {
      // Check if already exists
      if (!forceRegenerate) {
        const existing = await db.query(
          'SELECT id FROM ai_quizzes WHERE event_id = $1 AND language = $2',
          [eventId, language]
        );
        if (existing.rows.length > 0) {
          logger.info(`Quiz already exists for event ${eventId}, skipping`);
          return { status: 'skipped', reason: 'already_exists' };
        }
      }

      // Get transcript
      const transcript = await db.getTranscript(eventId, language);
      if (!transcript) {
        throw new Error('No transcript found');
      }

      await job.updateProgress(30);

      // Generate quiz
      const result = await openai.generateQuiz(transcript);

      await job.updateProgress(70);

      // Save to database
      await db.query(
        `INSERT INTO ai_quizzes (event_id, language, quiz_data, model, processing_time_ms)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (event_id, language) 
         DO UPDATE SET 
           quiz_data = $3,
           model = $4,
           processing_time_ms = $5,
           updated_at = NOW()`,
        [eventId, language, JSON.stringify(result.quizData), result.model, result.processingTime]
      );

      // Cache the quiz
      const cacheKey = `quiz:${eventId}:${language}`;
      await cache.set(cacheKey, result.quizData);

      await job.updateProgress(100);

      logger.info(`Quiz generated successfully for event ${eventId}`);

      return {
        status: 'completed',
        eventId,
        language,
        processingTime: result.processingTime,
        model: result.model,
        questionCount: result.quizData.questions.length,
      };
    } catch (error: any) {
      logger.error(`Failed to generate quiz for event ${eventId}:`, error);
      throw error;
    }
  },
  {
    connection,
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '1', 10),
    limiter: {
      max: 5,
      duration: 60000,
    },
  }
);

/**
 * Caption Extraction Worker
 */
export const captionWorker = new Worker<CaptionExtractionJobData | BatchCaptionExtractionJobData>(
  'caption-extraction',
  async (job: Job<CaptionExtractionJobData | BatchCaptionExtractionJobData>) => {
    logger.info(`Processing caption extraction job`, job.data);

    try {
      const extractor = new CaptionExtractorService(db);

      // Check if this is a batch job or single event job
      if ('limit' in job.data) {
        // Batch extraction
        const results = await extractor.extractBatch(job.data.limit);
        const successful = results.filter(r => r.success).length;

        logger.info(`Batch extraction complete: ${successful}/${results.length} successful`);

        return {
          status: 'completed',
          type: 'batch',
          total: results.length,
          successful,
          results,
        };
      } else {
        // Single event extraction
        const { eventId, language } = job.data;
        const result = await extractor.extractForEvent(eventId, language);

        if (result.success) {
          logger.info(`Caption extracted successfully for event ${eventId}`);
        } else {
          logger.warn(`Caption extraction failed for event ${eventId}: ${result.error}`);
        }

        return {
          status: result.success ? 'completed' : 'failed',
          type: 'single',
          ...result,
        };
      }
    } catch (error: any) {
      logger.error(`Caption extraction job failed:`, error);
      throw error;
    }
  },
  {
    connection,
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '3', 10),
  }
);

// ========================================
// Event Listeners for Monitoring
// ========================================

summaryEvents.on('completed', ({ jobId }) => {
  logger.info(`Summary job completed: ${jobId}`);
});

summaryEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error(`Summary job failed: ${jobId}`, { reason: failedReason });
});

quizEvents.on('completed', ({ jobId }) => {
  logger.info(`Quiz job completed: ${jobId}`);
});

quizEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error(`Quiz job failed: ${jobId}`, { reason: failedReason });
});

captionEvents.on('completed', ({ jobId }) => {
  logger.info(`Caption extraction job completed: ${jobId}`);
});

captionEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error(`Caption extraction job failed: ${jobId}`, { reason: failedReason });
});

// ========================================
// Helper Functions
// ========================================

/**
 * Add a summary generation job to the queue
 */
export async function enqueueSummaryGeneration(
  eventId: string,
  language: string = 'en',
  forceRegenerate: boolean = false
): Promise<string> {
  const job = await summaryQueue.add(
    'generate-summary',
    { eventId, language, forceRegenerate },
    {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100, // Keep last 100 completed jobs
      removeOnFail: 200, // Keep last 200 failed jobs
    }
  );

  return job.id!;
}

/**
 * Add a quiz generation job to the queue
 */
export async function enqueueQuizGeneration(
  eventId: string,
  language: string = 'en',
  forceRegenerate: boolean = false
): Promise<string> {
  const job = await quizQueue.add(
    'generate-quiz',
    { eventId, language, forceRegenerate },
    {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 200,
    }
  );

  return job.id!;
}

/**
 * Add a caption extraction job to the queue
 */
export async function enqueueCaptionExtraction(
  eventId: number,
  language: string = 'en'
): Promise<string> {
  const job = await captionQueue.add(
    'extract-caption',
    { eventId, language },
    {
      attempts: 2,
      backoff: {
        type: 'fixed',
        delay: 5000,
      },
      removeOnComplete: 50,
      removeOnFail: 100,
    }
  );

  return job.id!;
}

/**
 * Add a batch caption extraction job
 */
export async function enqueueBatchCaptionExtraction(limit: number = 10): Promise<string> {
  const job = await captionQueue.add(
    'extract-batch',
    { limit },
    {
      attempts: 1,
      removeOnComplete: 20,
    }
  );

  return job.id!;
}

/**
 * Get queue statistics
 */
export async function getQueueStats() {
  const [summaryWaiting, summaryActive, summaryCompleted, summaryFailed] = await Promise.all([
    summaryQueue.getWaitingCount(),
    summaryQueue.getActiveCount(),
    summaryQueue.getCompletedCount(),
    summaryQueue.getFailedCount(),
  ]);

  const [quizWaiting, quizActive, quizCompleted, quizFailed] = await Promise.all([
    quizQueue.getWaitingCount(),
    quizQueue.getActiveCount(),
    quizQueue.getCompletedCount(),
    quizQueue.getFailedCount(),
  ]);

  const [captionWaiting, captionActive, captionCompleted, captionFailed] = await Promise.all([
    captionQueue.getWaitingCount(),
    captionQueue.getActiveCount(),
    captionQueue.getCompletedCount(),
    captionQueue.getFailedCount(),
  ]);

  return {
    summaries: {
      waiting: summaryWaiting,
      active: summaryActive,
      completed: summaryCompleted,
      failed: summaryFailed,
    },
    quizzes: {
      waiting: quizWaiting,
      active: quizActive,
      completed: quizCompleted,
      failed: quizFailed,
    },
    captions: {
      waiting: captionWaiting,
      active: captionActive,
      completed: captionCompleted,
      failed: captionFailed,
    },
  };
}

/**
 * Graceful shutdown
 */
export async function closeQueues() {
  logger.info('Closing queues and workers...');
  
  await Promise.all([
    summaryWorker.close(),
    quizWorker.close(),
    captionWorker.close(),
    summaryQueue.close(),
    quizQueue.close(),
    captionQueue.close(),
    connection.quit(),
  ]);
  
  logger.info('Queues closed successfully');
}