import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { db } from './services/database.service';
import { openai } from './services/openai.service';
import cache, { CacheService } from './services/cache.service';
import { monitoring } from './utils/monitoring';

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

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
    const defaultModel = await db.getDefaultModel();
    
    res.json({
      features: {
        enabled: featuresEnabled,
        summary: featuresEnabled,
        quiz: false, // Phase 2
      },
      config: {
        defaultModel,
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
    const { eventId, content, language = 'en', source = 'manual_upload' } = req.body;
    
    if (!eventId || !content) {
      return res.status(400).json({ 
        error: 'Missing required fields: eventId and content' 
      });
    }

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
    const eventId = parseInt(req.params.eventId);
    const language = (req.query.language as string) || 'en';
    
    if (isNaN(eventId)) {
      return res.status(400).json({ error: 'Invalid eventId' });
    }

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
    const eventId = parseInt(req.params.eventId);
    const language = req.body.language || 'en';
    const forceRegenerate = req.body.forceRegenerate === true;
    
    if (isNaN(eventId)) {
      return res.status(400).json({ error: 'Invalid eventId' });
    }

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
    const eventId = parseInt(req.params.eventId);
    const language = (req.query.language as string) || 'en';
    
    if (isNaN(eventId)) {
      return res.status(400).json({ error: 'Invalid eventId' });
    }

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
      console.log('=================================\n');
      console.log('Available endpoints:');
      console.log(`  GET  http://localhost:${PORT}/health`);
      console.log(`  GET  http://localhost:${PORT}/status`);
      console.log(`  POST http://localhost:${PORT}/api/transcripts/upload`);
      console.log(`  GET  http://localhost:${PORT}/api/transcripts/:eventId`);
      console.log(`  POST http://localhost:${PORT}/api/summaries/generate/:eventId`);
      console.log(`  GET  http://localhost:${PORT}/api/summaries/:eventId`);
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
  await db.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await db.close();
  process.exit(0);
});

start();