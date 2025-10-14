import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { config } from './config';
import { db } from './services/database.service';
import { openai } from './services/openai.service';
import cache, { CacheService } from './services/cache.service';
import { monitoring } from './utils/monitoring';
import { CaptionExtractorService } from './services/caption-extractor.service';
import * as queueService from './services/queue.service';
import { normalizeLanguageCode } from './utils/language';

const app = express();

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts for admin dashboard
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static files (admin dashboard)
app.use('/admin', express.static(path.join(__dirname, '../public')));

// Request timing and monitoring middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  // Store original send function
  const originalSend = res.send;
  
  // Override send to capture metrics
  res.send = function(data): Response {
    const responseTime = Date.now() - start;
    
    monitoring.logRequest({
      endpoint: req.path,
      method: req.method,
      statusCode: res.statusCode,
      responseTime,
      timestamp: new Date(),
      cached: res.get('X-Cache-Hit') === 'true',
    });
    
    return originalSend.call(this, data);
  };
  
  next();
});

// Health check endpoint
app.get('/health', async (req: Request, res: Response) => {
  try {
    const dbOk = await db.testConnection();
    const openaiOk = config.openai.apiKey ? true : false;
    
    res.json({
      status: dbOk && openaiOk ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: dbOk ? 'connected' : 'disconnected',
        openai: openaiOk ? 'configured' : 'not configured',
      },
      version: '0.1.0',
    });
  } catch (error: any) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
    });
  }
});

// Status endpoint with metrics
app.get('/status', async (req: Request, res: Response) => {
  try {
    const featuresEnabled = await db.isFeatureEnabled();
    const quizEnabled = await db.getConfig('quiz_enabled');
    
    res.json({
      features: {
        enabled: featuresEnabled,
        summary: featuresEnabled,
        quiz: quizEnabled,
        captionExtraction: true,
      },
      config: {
        defaultModel: config.openai.defaultModel, // Read from .env, not database
        cacheTtl: config.performance.cacheTtlSeconds,
      },
      metrics: monitoring.getStats(),
      cache: cache.getStats(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Upload transcript
app.post('/api/transcripts/upload', async (req: Request, res: Response) => {
  try {
    const { eventId, content, source = 'manual_upload' } = req.body;
    
    if (!eventId || !content) {
      return res.status(400).json({
        error: 'Missing required fields: eventId, content, and language'
      });
    }

    if (!req.body.language) {
      return res.status(400).json({
        error: 'Language is required',
        message: 'Please specify a language code (e.g., "en-us", "de-de")'
      });
    }

    const language = normalizeLanguageCode(req.body.language);

    if (content.length > 50000) {
      return res.status(400).json({ 
        error: 'Transcript too long (max 50,000 characters)' 
      });
    }

    await db.saveTranscript(eventId, content, language, source);
    
    // Invalidate cached transcript
    await cache.invalidate(CacheService.transcriptKey(eventId, language));
    
    res.json({
      success: true,
      message: 'Transcript uploaded successfully',
      eventId,
      language,
      length: content.length,
    });
  } catch (error: any) {
    console.error('Transcript upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get transcript
app.get('/api/transcripts/:eventId', async (req: Request, res: Response) => {
  try {
    const eventId = req.params.eventId; // Keep as string to preserve BigInt precision
    
    if (!req.query.language) {
      return res.status(400).json({
        error: 'Language parameter is required',
        message: 'Add ?language=<code> to the URL (e.g., ?language=en-us)'
      });
    }

    const language = normalizeLanguageCode(req.query.language as string);

    // Check cache first
    const cacheKey = CacheService.transcriptKey(eventId, language);
    const cached = await cache.get<string>(cacheKey);
    
    if (cached) {
      res.set('X-Cache-Hit', 'true');
      return res.json({
        eventId,
        language,
        content: cached,
        cached: true,
      });
    }

    const transcript = await db.getTranscript(eventId, language);
    
    if (!transcript) {
      return res.status(404).json({ 
        error: 'Transcript not found',
        eventId,
        language,
      });
    }

    // Cache for future requests
    await cache.set(cacheKey, transcript);
    
    res.json({
      eventId,
      language,
      content: transcript,
      cached: false,
    });
  } catch (error: any) {
    console.error('Get transcript error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate summary
app.post('/api/summaries/generate/:eventId', async (req: Request, res: Response) => {
  try {
    const eventId = req.params.eventId; // Keep as string to preserve BigInt precision
    
    if (!req.body.language) {
      return res.status(400).json({
        error: 'Language is required',
        message: 'Please specify a language code in request body (e.g., "en-us", "de-de")'
      });
    }

    const language = normalizeLanguageCode(req.body.language);
    const forceRegenerate = req.body.forceRegenerate === true;

    // Check if features are enabled
    const enabled = await db.isFeatureEnabled();
    if (!enabled) {
      return res.status(403).json({ 
        error: 'AI features are disabled',
        message: 'Contact administrator to enable AI features',
      });
    }

    // Check if summary already exists (unless force regenerate)
    if (!forceRegenerate) {
      const existing = await db.getSummary(eventId, language);
      if (existing) {
        return res.json({
          eventId,
          language,
          summary: existing.summary,
          model: existing.model,
          cached: true,
          createdAt: existing.created_at,
        });
      }
    }

    // Get transcript
    const transcript = await db.getTranscript(eventId, language);
    if (!transcript) {
      return res.status(404).json({ 
        error: 'No transcript found for this video',
        message: 'Please upload a transcript first',
        eventId,
        language,
      });
    }

    // Generate summary using OpenAI
    const result = await openai.generateSummary(transcript);
    
    // Save to database
    await db.saveSummary(
      eventId,
      result.content,
      result.model,
      language,
      result.processingTime
    );

    // Cache the summary
    const cacheKey = CacheService.summaryKey(eventId, language);
    await cache.set(cacheKey, result.content);

    res.json({
      eventId,
      language,
      summary: result.content,
      model: result.model,
      processingTime: result.processingTime,
      tokensUsed: result.tokensUsed,
      cached: false,
    });
  } catch (error: any) {
    console.error('Summary generation error:', error);
    res.status(500).json({ 
      error: 'Failed to generate summary',
      message: error.message,
    });
  }
});

// Get summary
app.get('/api/summaries/:eventId', async (req: Request, res: Response) => {
  try {
    const eventId = req.params.eventId; // Keep as string to preserve BigInt precision
    
    if (!req.query.language) {
      return res.status(400).json({
        error: 'Language parameter is required',
        message: 'Add ?language=<code> to the URL (e.g., ?language=en-us)'
      });
    }

    const language = normalizeLanguageCode(req.query.language as string);

    // Check cache first
    const cacheKey = CacheService.summaryKey(eventId, language);
    const cached = await cache.get<string>(cacheKey);
    
    if (cached) {
      res.set('X-Cache-Hit', 'true');
      return res.json({
        eventId,
        language,
        summary: cached,
        cached: true,
      });
    }

    const summary = await db.getSummary(eventId, language);
    
    if (!summary) {
      return res.status(404).json({ 
        error: 'Summary not found',
        message: 'Generate a summary first',
        eventId,
        language,
      });
    }

    // Cache for future requests
    await cache.set(cacheKey, summary.summary);
    
    res.json({
      eventId,
      language,
      summary: summary.summary,
      model: summary.model,
      createdAt: summary.created_at,
      cached: false,
    });
  } catch (error: any) {
    console.error('Get summary error:', error);
    res.status(500).json({ error: error.message });
  }
});
// ========================================
// Quiz Generation Endpoints (Phase 2)
// ========================================

// Generate quiz
app.post('/api/quizzes/generate/:eventId', async (req: Request, res: Response) => {
  try {
    const eventId = req.params.eventId;
    
    if (!req.body.language) {
      return res.status(400).json({
        error: 'Language is required',
        message: 'Please specify a language code in request body (e.g., "en-us", "de-de")'
      });
    }

    const language = normalizeLanguageCode(req.body.language);
    const forceRegenerate = req.body.forceRegenerate === true;

    // Check if quiz feature is enabled
    const quizEnabled = await db.getConfig('quiz_enabled');
    if (!quizEnabled) {
      return res.status(403).json({
        error: 'Quiz feature is disabled',
        message: 'Enable quiz_enabled in ai_config to use this feature',
      });
    }

    // Check cache first
    const cacheKey = `quiz:${eventId}:${language}`;
    if (!forceRegenerate) {
      const cached = await cache.get<any>(cacheKey);
      if (cached) {
        res.set('X-Cache-Hit', 'true');
        return res.json({
          eventId,
          language,
          quiz: cached,
          cached: true,
        });
      }
    }

    // Get transcript
    const transcript = await db.getTranscript(eventId, language);
    if (!transcript) {
      return res.status(404).json({
        error: 'No transcript found for this video',
        message: 'Please upload a transcript first',
        eventId,
        language,
      });
    }

    // Generate quiz using OpenAI
    const result = await openai.generateQuiz(transcript);

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
    await cache.set(cacheKey, result.quizData);

    res.json({
      eventId,
      language,
      quiz: result.quizData,
      model: result.model,
      processingTime: result.processingTime,
      cached: false,
    });
  } catch (error: any) {
    console.error('Quiz generation error:', error);
    res.status(500).json({
      error: 'Failed to generate quiz',
      message: error.message,
    });
  }
});

// Get quiz
app.get('/api/quizzes/:eventId', async (req: Request, res: Response) => {
  try {
    const eventId = req.params.eventId;
    
    if (!req.query.language) {
      return res.status(400).json({
        error: 'Language parameter is required',
        message: 'Add ?language=<code> to the URL (e.g., ?language=en-us)'
      });
    }

    const language = normalizeLanguageCode(req.query.language as string);

    // Check cache first
    const cacheKey = `quiz:${eventId}:${language}`;
    const cached = await cache.get<any>(cacheKey);

    if (cached) {
      res.set('X-Cache-Hit', 'true');
      return res.json({
        eventId,
        language,
        quiz: cached,
        cached: true,
      });
    }

    const result = await db.query(
      'SELECT quiz_data, model, created_at FROM ai_quizzes WHERE event_id = $1 AND language = $2',
      [eventId, language]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Quiz not found',
        message: 'Generate a quiz first',
        eventId,
        language,
      });
    }

    const quiz = result.rows[0];

    // Cache for future requests
    await cache.set(cacheKey, quiz.quiz_data);

    res.json({
      eventId,
      language,
      quiz: quiz.quiz_data,
      model: quiz.model,
      createdAt: quiz.created_at,
      cached: false,
    });
  } catch (error: any) {
    console.error('Get quiz error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// Caption Extraction Endpoints (Phase 2)
// ========================================

// Extract captions for an event
app.post('/api/captions/extract/:eventId', async (req: Request, res: Response) => {
  try {
    const eventId = req.params.eventId; // Keep as string for BigInt precision
    
    if (!req.body.language) {
      return res.status(400).json({
        error: 'Language is required',
        message: 'Please specify a language code in request body (e.g., "en-us", "de-de")'
      });
    }

    const language = normalizeLanguageCode(req.body.language);

    const extractor = new CaptionExtractorService(db);

    const result = await extractor.extractForEvent(eventId, language);

    if (result.success) {
      res.json({
        success: true,
        eventId: result.eventId,
        language: result.language,
        transcriptLength: result.transcriptLength,
        source: result.source,
      });
    } else {
      res.status(404).json({
        success: false,
        eventId: result.eventId,
        error: result.error,
      });
    }
  } catch (error: any) {
    console.error('Caption extraction error:', error);
    res.status(500).json({
      error: 'Failed to extract captions',
      message: error.message,
    });
  }
});

// Batch extract captions
app.post('/api/captions/extract-batch', async (req: Request, res: Response) => {
  try {
    const { limit = 10 } = req.body;

    const extractor = new CaptionExtractorService(db);

    const results = await extractor.extractBatch(limit);

    const successful = results.filter(r => r.success).length;

    res.json({
      total: results.length,
      successful,
      failed: results.length - successful,
      results,
    });
  } catch (error: any) {
    console.error('Batch extraction error:', error);
    res.status(500).json({
      error: 'Failed to batch extract captions',
      message: error.message,
    });
  }
});

// Get caption extraction stats
app.get('/api/captions/stats', async (req: Request, res: Response) => {
  try {
    const extractor = new CaptionExtractorService(db);

    const stats = await extractor.getStats();

    res.json(stats);
  } catch (error: any) {
    console.error('Caption stats error:', error);
    res.status(500).json({
      error: 'Failed to get caption stats',
      message: error.message,
    });
  }
});

// ========================================
// Queue Management Endpoints (Phase 2)
// ========================================

// Enqueue summary generation
app.post('/api/queue/summary/:eventId', async (req: Request, res: Response) => {
  try {
    if (!queueService.isQueueEnabled()) {
      return res.status(503).json({
        error: 'Queue system unavailable',
        message: 'Redis is not connected. Please use direct endpoints instead.',
      });
    }

    const eventId = req.params.eventId;
    
    if (!req.body.language) {
      return res.status(400).json({
        error: 'Language is required',
        message: 'Please specify a language code in request body (e.g., "en-us", "de-de")'
      });
    }

    const language = normalizeLanguageCode(req.body.language);
    const forceRegenerate = req.body.forceRegenerate === true;

    const jobId = await queueService.enqueueSummaryGeneration(eventId, language, forceRegenerate);

    res.json({
      success: true,
      jobId,
      eventId,
      language,
      message: 'Summary generation job enqueued',
    });
  } catch (error: any) {
    console.error('Enqueue summary error:', error);
    res.status(500).json({
      error: 'Failed to enqueue summary generation',
      message: error.message,
    });
  }
});

// Enqueue quiz generation
app.post('/api/queue/quiz/:eventId', async (req: Request, res: Response) => {
  try {
    if (!queueService.isQueueEnabled()) {
      return res.status(503).json({
        error: 'Queue system unavailable',
        message: 'Redis is not connected. Please use direct endpoints instead.',
      });
    }

    const eventId = req.params.eventId;
    
    if (!req.body.language) {
      return res.status(400).json({
        error: 'Language is required',
        message: 'Please specify a language code in request body (e.g., "en-us", "de-de")'
      });
    }

    const language = normalizeLanguageCode(req.body.language);
    const forceRegenerate = req.body.forceRegenerate === true;

    const jobId = await queueService.enqueueQuizGeneration(eventId, language, forceRegenerate);

    res.json({
      success: true,
      jobId,
      eventId,
      language,
      message: 'Quiz generation job enqueued',
    });
  } catch (error: any) {
    console.error('Enqueue quiz error:', error);
    res.status(500).json({
      error: 'Failed to enqueue quiz generation',
      message: error.message,
    });
  }
});

// Enqueue caption extraction
app.post('/api/queue/caption/:eventId', async (req: Request, res: Response) => {
  try {
    if (!queueService.isQueueEnabled()) {
      return res.status(503).json({
        error: 'Queue system unavailable',
        message: 'Redis is not connected. Please use direct endpoints instead.',
      });
    }

    const eventId = parseInt(req.params.eventId, 10);
    
    if (!req.body.language) {
      return res.status(400).json({
        error: 'Language is required',
        message: 'Please specify a language code in request body (e.g., "en-us", "de-de")'
      });
    }

    const language = normalizeLanguageCode(req.body.language);

    const jobId = await queueService.enqueueCaptionExtraction(eventId, language);

    res.json({
      success: true,
      jobId,
      eventId,
      language,
      message: 'Caption extraction job enqueued',
    });
  } catch (error: any) {
    console.error('Enqueue caption error:', error);
    res.status(500).json({
      error: 'Failed to enqueue caption extraction',
      message: error.message,
    });
  }
});

// Enqueue batch caption extraction
app.post('/api/queue/caption-batch', async (req: Request, res: Response) => {
  try {
    if (!queueService.isQueueEnabled()) {
      return res.status(503).json({
        error: 'Queue system unavailable',
        message: 'Redis is not connected. Please use direct endpoints instead.',
      });
    }

    const { limit = 10 } = req.body;

    const jobId = await queueService.enqueueBatchCaptionExtraction(limit);

    res.json({
      success: true,
      jobId,
      limit,
      message: 'Batch caption extraction job enqueued',
    });
  } catch (error: any) {
    console.error('Enqueue batch caption error:', error);
    res.status(500).json({
      error: 'Failed to enqueue batch caption extraction',
      message: error.message,
    });
  }
});

// Get queue statistics
app.get('/api/queue/stats', async (req: Request, res: Response) => {
  try {
    const stats = await queueService.getQueueStats();

    res.json(stats);
  } catch (error: any) {
    console.error('Queue stats error:', error);
    res.status(500).json({
      error: 'Failed to get queue statistics',
      message: error.message,
    });
  }
});


// Admin: Get list of events/videos
app.get('/api/admin/events', async (req: Request, res: Response) => {
  try {
    const result = await db.query(
      `SELECT DISTINCT
         e.id,
         e.title,
         e.created,
         e.series,
         COALESCE(
           array_agg(DISTINCT c.lang) FILTER (WHERE c.lang IS NOT NULL),
           '{}'
         ) as caption_languages,
         COALESCE(
           array_agg(DISTINCT vt.language) FILTER (WHERE vt.language IS NOT NULL),
           '{}'
         ) as transcript_languages
       FROM all_events e
       LEFT JOIN LATERAL unnest(e.captions) AS c ON true
       LEFT JOIN video_transcripts vt ON vt.event_id = e.id
       WHERE e.state = 'ready'
         AND (
           array_length(e.captions, 1) > 0
           OR vt.id IS NOT NULL
         )
       GROUP BY e.id, e.title, e.created, e.series
       ORDER BY e.title`
    );
    
    res.json({
      events: result.rows.map((row: any) => ({
        id: row.id.toString(),
        title: row.title || `Event ${row.id}`,
        created: row.created,
        series: row.series,
        captionLanguages: row.caption_languages || [],
        transcriptLanguages: row.transcript_languages || []
      }))
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Get configuration
app.get('/api/admin/config', async (req: Request, res: Response) => {
  try {
    const featuresEnabled = await db.getConfig('features_enabled');
    const defaultModel = await db.getConfig('default_model');
    const cacheTtl = await db.getConfig('cache_ttl_seconds');
    
    res.json({
      features_enabled: featuresEnabled,
      default_model: defaultModel,
      cache_ttl_seconds: cacheTtl,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Get metrics
app.get('/api/admin/metrics', (req: Request, res: Response) => {
  res.json({
    server: monitoring.getStats(),
    cache: cache.getStats(),
  });
});
// ========================================
// Delete Endpoints
// ========================================

// Delete transcript for specific video
app.delete('/api/transcripts/:eventId', async (req: Request, res: Response) => {
  try {
    const eventId = req.params.eventId;
    
    if (!req.query.language) {
      return res.status(400).json({
        error: 'Language parameter is required',
        message: 'Add ?language=<code> to the URL (e.g., ?language=en-us)'
      });
    }

    const language = normalizeLanguageCode(req.query.language as string);
    
    const deleted = await db.deleteTranscript(eventId, language);
    
    if (!deleted) {
      return res.status(404).json({
        error: 'Transcript not found',
        eventId,
        language,
      });
    }

    // Invalidate cache
    await cache.invalidate(CacheService.transcriptKey(eventId, language));
    
    res.json({
      success: true,
      message: 'Transcript deleted successfully',
      eventId,
      language,
    });
  } catch (error: any) {
    console.error('Delete transcript error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete summary for specific video
app.delete('/api/summaries/:eventId', async (req: Request, res: Response) => {
  try {
    const eventId = req.params.eventId;
    
    if (!req.query.language) {
      return res.status(400).json({
        error: 'Language parameter is required',
        message: 'Add ?language=<code> to the URL (e.g., ?language=en-us)'
      });
    }

    const language = normalizeLanguageCode(req.query.language as string);
    
    const deleted = await db.deleteSummary(eventId, language);
    
    if (!deleted) {
      return res.status(404).json({
        error: 'Summary not found',
        eventId,
        language,
      });
    }

    // Invalidate cache
    await cache.invalidate(CacheService.summaryKey(eventId, language));
    
    res.json({
      success: true,
      message: 'Summary deleted successfully',
      eventId,
      language,
    });
  } catch (error: any) {
    console.error('Delete summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete quiz for specific video
app.delete('/api/quizzes/:eventId', async (req: Request, res: Response) => {
  try {
    const eventId = req.params.eventId;
    
    if (!req.query.language) {
      return res.status(400).json({
        error: 'Language parameter is required',
        message: 'Add ?language=<code> to the URL (e.g., ?language=en-us)'
      });
    }

    const language = normalizeLanguageCode(req.query.language as string);
    
    const deleted = await db.deleteQuiz(eventId, language);
    
    if (!deleted) {
      return res.status(404).json({
        error: 'Quiz not found',
        eventId,
        language,
      });
    }

    // Invalidate cache
    const cacheKey = `quiz:${eventId}:${language}`;
    await cache.invalidate(cacheKey);
    
    res.json({
      success: true,
      message: 'Quiz deleted successfully',
      eventId,
      language,
    });
  } catch (error: any) {
    console.error('Delete quiz error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete ALL transcripts
app.delete('/api/admin/transcripts/all', async (req: Request, res: Response) => {
  try {
    const count = await db.deleteAllTranscripts();
    
    // Clear all transcript caches
    await cache.clear();
    
    res.json({
      success: true,
      message: `Deleted ${count} transcript(s)`,
      count,
    });
  } catch (error: any) {
    console.error('Delete all transcripts error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete ALL summaries
app.delete('/api/admin/summaries/all', async (req: Request, res: Response) => {
  try {
    const count = await db.deleteAllSummaries();
    
    // Clear all summary caches
    await cache.clear();
    
    res.json({
      success: true,
      message: `Deleted ${count} summary/summaries`,
      count,
    });
  } catch (error: any) {
    console.error('Delete all summaries error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete ALL quizzes
app.delete('/api/admin/quizzes/all', async (req: Request, res: Response) => {
  try {
    const count = await db.deleteAllQuizzes();
    
    // Clear all quiz caches
    await cache.clear();
    
    res.json({
      success: true,
      message: `Deleted ${count} quiz(zes)`,
      count,
    });
  } catch (error: any) {
    console.error('Delete all quizzes error:', error);
    res.status(500).json({ error: error.message });
  }
});


// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ 
    error: 'Not found',
    path: req.path,
  });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message,
  });
});

// Start server
const PORT = config.server.port;

async function start() {
  try {
    // Test database connection
    const dbOk = await db.testConnection();
    if (!dbOk) {
      console.error('Failed to connect to database');
      process.exit(1);
    }

    // Initialize queue system (optional - will gracefully fail if Redis unavailable)
    const queueOk = await queueService.initializeQueues();

    // Start listening
    app.listen(PORT, () => {
      console.log('\n=================================');
      console.log('🚀 Tobira AI Service Started');
      console.log('=================================');
      console.log(`Environment: ${config.server.env}`);
      console.log(`Port: ${PORT}`);
      console.log(`Database: Connected`);
      console.log(`OpenAI: ${config.openai.apiKey ? 'Configured' : 'Not configured'}`);
      console.log(`Default Model: ${config.openai.defaultModel}`);
      console.log(`Queue System: ${queueOk ? 'Enabled (Redis connected)' : 'Disabled (Redis not available)'}`);
      console.log('=================================\n');
      console.log('Available endpoints:');
      console.log('  📊 Admin Dashboard:');
      console.log(`    http://localhost:${PORT}/admin/admin.html`);
      console.log('  Health & Status:');
      console.log(`    GET  http://localhost:${PORT}/health`);
      console.log(`    GET  http://localhost:${PORT}/status`);
      console.log('  Transcripts:');
      console.log(`    POST http://localhost:${PORT}/api/transcripts/upload`);
      console.log(`    GET  http://localhost:${PORT}/api/transcripts/:eventId`);
      console.log('  Summaries:');
      console.log(`    POST http://localhost:${PORT}/api/summaries/generate/:eventId`);
      console.log(`    GET  http://localhost:${PORT}/api/summaries/:eventId`);
      console.log('  Quizzes (Phase 2):');
      console.log(`    POST http://localhost:${PORT}/api/quizzes/generate/:eventId`);
      console.log(`    GET  http://localhost:${PORT}/api/quizzes/:eventId`);
      console.log('  Caption Extraction (Phase 2):');
      console.log(`    POST http://localhost:${PORT}/api/captions/extract/:eventId`);
      console.log(`    POST http://localhost:${PORT}/api/captions/extract-batch`);
      console.log(`    GET  http://localhost:${PORT}/api/captions/stats`);
      if (queueOk) {
        console.log('  Queue Management (Phase 2):');
        console.log(`    POST http://localhost:${PORT}/api/queue/summary/:eventId`);
        console.log(`    POST http://localhost:${PORT}/api/queue/quiz/:eventId`);
        console.log(`    POST http://localhost:${PORT}/api/queue/caption/:eventId`);
        console.log(`    GET  http://localhost:${PORT}/api/queue/stats`);
      }
      console.log('=================================\n');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await queueService.closeQueues();
  await db.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await queueService.closeQueues();
  await db.close();
  process.exit(0);
});

start();