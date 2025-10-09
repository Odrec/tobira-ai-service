import { Pool, QueryResult } from 'pg';
import { config } from '../config';

interface Transcript {
  id: number;
  event_id: number;
  language: string;
  content: string;
  source: string;
  created_at: Date;
  updated_at: Date;
}

interface Summary {
  id: number;
  event_id: number;
  language: string;
  summary: string;
  model: string;
  processing_time_ms: number | null;
  created_at: Date;
  updated_at: Date;
}

interface ConfigValue {
  key: string;
  value: any;
  description: string | null;
}

class DatabaseService {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: config.database.url,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Test connection on startup
    this.pool.on('error', (err) => {
      console.error('Unexpected database error:', err);
    });
  }

  /**
   * Execute a query with optional parameters
   */
  async query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    const start = Date.now();
    try {
      const res = await this.pool.query<T>(text, params);
      const duration = Date.now() - start;
      console.log('Query executed', { 
        duration, 
        rows: res.rowCount,
        query: text.substring(0, 100) 
      });
      return res;
    } catch (error) {
      console.error('Database query error:', { text, error });
      throw error;
    }
  }

  /**
   * Get transcript for a video
   */
  async getTranscript(eventId: number, language: string = 'en'): Promise<string | null> {
    const result = await this.query<Transcript>(
      'SELECT content FROM video_transcripts WHERE event_id = $1 AND language = $2',
      [eventId, language]
    );
    return result.rows[0]?.content || null;
  }

  /**
   * Save or update transcript for a video
   */
  async saveTranscript(
    eventId: number,
    content: string,
    language: string = 'en',
    source: string = 'manual_upload'
  ): Promise<void> {
    await this.query(
      `INSERT INTO video_transcripts (event_id, language, content, source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id, language)
       DO UPDATE SET 
         content = EXCLUDED.content, 
         source = EXCLUDED.source,
         updated_at = NOW()`,
      [eventId, language, content, source]
    );
  }

  /**
   * Check if transcript exists for a video
   */
  async hasTranscript(eventId: number, language: string = 'en'): Promise<boolean> {
    const result = await this.query(
      'SELECT EXISTS(SELECT 1 FROM video_transcripts WHERE event_id = $1 AND language = $2)',
      [eventId, language]
    );
    return result.rows[0].exists;
  }

  /**
   * Get summary for a video
   */
  async getSummary(eventId: number, language: string = 'en'): Promise<Summary | null> {
    const result = await this.query<Summary>(
      'SELECT * FROM ai_summaries WHERE event_id = $1 AND language = $2',
      [eventId, language]
    );
    return result.rows[0] || null;
  }

  /**
   * Save or update AI-generated summary
   */
  async saveSummary(
    eventId: number,
    summary: string,
    model: string,
    language: string = 'en',
    processingTimeMs?: number
  ): Promise<void> {
    await this.query(
      `INSERT INTO ai_summaries (event_id, language, summary, model, processing_time_ms)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id, language)
       DO UPDATE SET 
         summary = EXCLUDED.summary,
         model = EXCLUDED.model,
         processing_time_ms = EXCLUDED.processing_time_ms,
         updated_at = NOW()`,
      [eventId, language, summary, model, processingTimeMs || null]
    );
  }

  /**
   * Check if summary exists for a video
   */
  async hasSummary(eventId: number, language: string = 'en'): Promise<boolean> {
    const result = await this.query(
      'SELECT EXISTS(SELECT 1 FROM ai_summaries WHERE event_id = $1 AND language = $2)',
      [eventId, language]
    );
    return result.rows[0].exists;
  }

  /**
   * Get configuration value from database
   */
  async getConfig(key: string): Promise<any> {
    const result = await this.query<ConfigValue>(
      'SELECT value FROM ai_config WHERE key = $1',
      [key]
    );
    return result.rows[0]?.value;
  }

  /**
   * Check if AI features are enabled
   */
  async isFeatureEnabled(): Promise<boolean> {
    try {
      const enabled = await this.getConfig('features_enabled');
      return enabled === true || enabled === 'true';
    } catch (error) {
      console.error('Error checking feature flag:', error);
      // Fall back to environment variable
      return config.features.enabled;
    }
  }

  /**
   * Get default model from database config
   */
  async getDefaultModel(): Promise<string> {
    try {
      const model = await this.getConfig('default_model');
      return model || config.openai.defaultModel;
    } catch (error) {
      return config.openai.defaultModel;
    }
  }

  /**
   * Close database pool
   */
  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Test database connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      console.log('Database connection successful');
      return true;
    } catch (error) {
      console.error('Database connection failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const db = new DatabaseService();
export default db;