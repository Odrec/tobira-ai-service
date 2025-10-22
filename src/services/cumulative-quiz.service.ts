import { Pool } from 'pg';
import { CacheService } from './cache.service';

export interface CumulativeQuiz {
  eventId: string;
  seriesId: string;
  language: string;
  model: string;
  questions: CumulativeQuizQuestion[];
  includedEventIds: string[];
  videoCount: number;
  processingTimeMs: number;
}

export interface CumulativeQuizQuestion {
  question: string;
  questionType: 'multiple_choice' | 'true_false';
  options?: string[];
  correctAnswer: string;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  videoContext: {
    eventId: string;
    videoTitle: string;
    videoNumber: number;
    timestamp?: number;
  };
}

interface SeriesEvent {
  id: string;
  title: string;
  position: number;
}

export class CumulativeQuizService {
  constructor(
    private pool: Pool,
    private cache: CacheService
  ) {}

  /**
   * Generate cumulative quiz for an event (includes all videos in series up to this point)
   */
  async generateCumulativeQuiz(
    eventId: string,
    language: string = 'en',
    forceRegenerate: boolean = false
  ): Promise<CumulativeQuiz> {
    const startTime = Date.now();
    
    console.log(`Generating cumulative quiz for event ${eventId}, language: ${language}`);
    
    // 1. Check cache first (unless force regenerate)
    if (!forceRegenerate) {
      const cached = await this.getCachedQuiz(eventId, language);
      if (cached && await this.isCacheValid(cached)) {
        console.log(`Using cached cumulative quiz for event ${eventId}`);
        return cached;
      }
    }
    
    // 2. Get event details and verify it's part of a series
    const eventQuery = `
      SELECT id, series, title
      FROM all_events
      WHERE id = $1 AND series IS NOT NULL AND state = 'ready'
    `;
    const eventResult = await this.pool.query(eventQuery, [eventId]);
    
    if (eventResult.rows.length === 0) {
      throw new Error('Event not found or not part of a series');
    }
    
    const event = eventResult.rows[0];
    const seriesId = event.series;
    
    console.log(`Event ${eventId} is part of series ${seriesId}`);
    
    // 3. Get all events in series up to and including this one (chronologically ordered)
    const seriesEvents = await this.getSeriesEventsUpTo(seriesId, eventId);
    
    console.log(`Found ${seriesEvents.length} events in series up to event ${eventId}`);
    
    if (seriesEvents.length === 0) {
      throw new Error('No events found in series');
    }
    
    // 4. Get or generate individual quizzes for each event
    const individualQuizzes = await Promise.all(
      seriesEvents.map(e => this.getOrGenerateIndividualQuiz(e.id, language))
    );
    
    console.log(`Retrieved/generated ${individualQuizzes.length} individual quizzes`);
    
    // 5. Combine quizzes with video context
    const questions = this.combineQuizzes(individualQuizzes, seriesEvents);
    
    console.log(`Combined ${questions.length} total questions from ${seriesEvents.length} videos`);
    
    // 6. Save cumulative quiz to database
    const quiz: CumulativeQuiz = {
      eventId,
      seriesId,
      language,
      model: process.env.DEFAULT_MODEL || 'gpt-4',
      questions,
      includedEventIds: seriesEvents.map(e => e.id),
      videoCount: seriesEvents.length,
      processingTimeMs: Date.now() - startTime
    };
    
    await this.saveCumulativeQuiz(quiz);
    
    console.log(`Cumulative quiz generated and saved in ${quiz.processingTimeMs}ms`);
    
    return quiz;
  }

  /**
   * Get series events up to a specific event, chronologically ordered
   * Uses proven ordering logic: metadata order field + created timestamp
   */
  private async getSeriesEventsUpTo(
    seriesId: string,
    upToEventId: string
  ): Promise<SeriesEvent[]> {
    const query = `
      WITH ordered_events AS (
        SELECT 
          id,
          title,
          ROW_NUMBER() OVER (
            ORDER BY 
              CASE 
                WHEN metadata->'http://ethz.ch/video/metadata'->>'order' IS NOT NULL 
                THEN (metadata->'http://ethz.ch/video/metadata'->>'order')::int
                ELSE 999999
              END,
              created
          ) as position
        FROM all_events
        WHERE series = $1 
          AND state = 'ready'
      ),
      target_position AS (
        SELECT position 
        FROM ordered_events 
        WHERE id = $2
      )
      SELECT 
        e.id,
        e.title,
        e.position
      FROM ordered_events e, target_position t
      WHERE e.position <= t.position
      ORDER BY e.position ASC
    `;
    
    const result = await this.pool.query(query, [seriesId, upToEventId]);
    return result.rows;
  }

  /**
   * Get or generate individual quiz for a single event
   */
  private async getOrGenerateIndividualQuiz(
    eventId: string,
    language: string
  ): Promise<any> {
    // Try to get existing quiz from database
    const query = `
      SELECT quiz_data
      FROM ai_quizzes
      WHERE event_id = $1 AND language = $2
    `;
    
    const result = await this.pool.query(query, [eventId, language]);
    
    if (result.rows.length > 0) {
      const quizData = result.rows[0].quiz_data;
      return {
        eventId,
        questions: quizData.questions || []
      };
    }
    
    // Quiz doesn't exist - would need to generate it
    // For now, return empty questions array
    // In production, you'd call the OpenAI service here
    console.warn(`No quiz found for event ${eventId}, language ${language}`);
    return {
      eventId,
      questions: []
    };
  }

  /**
   * Combine individual quizzes into cumulative quiz with video context
   */
  private combineQuizzes(
    quizzes: any[],
    events: SeriesEvent[]
  ): CumulativeQuizQuestion[] {
    const combined: CumulativeQuizQuestion[] = [];
    
    quizzes.forEach((quiz, index) => {
      const event = events[index];
      
      // Add each question with video context
      if (quiz.questions && Array.isArray(quiz.questions)) {
        quiz.questions.forEach((q: any) => {
          combined.push({
            question: q.question,
            questionType: q.questionType || q.type,
            options: q.options,
            correctAnswer: String(q.correctAnswer),
            explanation: q.explanation,
            difficulty: q.difficulty,
            videoContext: {
              eventId: event.id,
              videoTitle: event.title,
              videoNumber: event.position,
              timestamp: q.timestamp
            }
          });
        });
      }
    });
    
    return combined;
  }

  /**
   * Save cumulative quiz to database
   */
  private async saveCumulativeQuiz(quiz: CumulativeQuiz): Promise<void> {
    const query = `
      INSERT INTO ai_cumulative_quizzes (
        event_id, series_id, language, model, processing_time_ms,
        questions, included_event_ids, video_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (event_id, language)
      DO UPDATE SET
        questions = EXCLUDED.questions,
        included_event_ids = EXCLUDED.included_event_ids,
        video_count = EXCLUDED.video_count,
        processing_time_ms = EXCLUDED.processing_time_ms,
        updated_at = now()
      RETURNING id
    `;
    
    await this.pool.query(query, [
      quiz.eventId,
      quiz.seriesId,
      quiz.language,
      quiz.model,
      quiz.processingTimeMs,
      JSON.stringify(quiz.questions),
      quiz.includedEventIds,
      quiz.videoCount
    ]);
    
    // Cache the result
    const cacheKey = `cumulative_quiz:${quiz.eventId}:${quiz.language}`;
    await this.cache.set(cacheKey, quiz, 604800); // 7 days TTL
    
    console.log(`Saved cumulative quiz to database for event ${quiz.eventId}`);
  }

  /**
   * Get cached cumulative quiz
   */
  async getCachedQuiz(
    eventId: string,
    language: string
  ): Promise<CumulativeQuiz | null> {
    // Try memory cache first
    const cacheKey = `cumulative_quiz:${eventId}:${language}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    // Try database
    const query = `
      SELECT 
        event_id, series_id, language, model, processing_time_ms,
        questions, included_event_ids, video_count
      FROM ai_cumulative_quizzes
      WHERE event_id = $1 AND language = $2
    `;
    
    const result = await this.pool.query(query, [eventId, language]);
    
    if (result.rows.length > 0) {
      const row = result.rows[0];
      const quiz: CumulativeQuiz = {
        eventId: row.event_id,
        seriesId: row.series_id,
        language: row.language,
        model: row.model,
        questions: row.questions,
        includedEventIds: row.included_event_ids,
        videoCount: row.video_count,
        processingTimeMs: row.processing_time_ms
      };
      
      // Re-cache it
      await this.cache.set(cacheKey, quiz, 604800);
      return quiz;
    }
    
    return null;
  }

  /**
   * Check if cached quiz is still valid (series hasn't changed)
   */
  private async isCacheValid(quiz: CumulativeQuiz): Promise<boolean> {
    try {
      // Get current list of events in series up to this point
      const currentEvents = await this.getSeriesEventsUpTo(
        quiz.seriesId,
        quiz.eventId
      );
      
      const currentEventIds = currentEvents.map(e => e.id).sort();
      const cachedEventIds = [...quiz.includedEventIds].sort();
      
      // Cache is valid if same events are included
      const isValid = JSON.stringify(currentEventIds) === JSON.stringify(cachedEventIds);
      
      if (!isValid) {
        console.log(`Cache invalid for event ${quiz.eventId} - series structure changed`);
      }
      
      return isValid;
    } catch (error) {
      console.error('Error validating cache:', error);
      return false; // Invalidate cache on error
    }
  }

  /**
   * Get statistics about cumulative quizzes
   */
  async getStats(): Promise<any> {
    const query = `
      SELECT 
        COUNT(*) as total_quizzes,
        COUNT(DISTINCT series_id) as total_series,
        AVG(video_count) as avg_videos_per_quiz,
        AVG(jsonb_array_length(questions)) as avg_questions_per_quiz
      FROM ai_cumulative_quizzes
    `;
    
    const result = await this.pool.query(query);
    return result.rows[0];
  }
}