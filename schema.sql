-- Tobira AI Service Database Schema
-- Run this in your Tobira PostgreSQL database

-- Configuration table for AI features
CREATE TABLE IF NOT EXISTS ai_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Video transcripts table
CREATE TABLE IF NOT EXISTS video_transcripts (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    language VARCHAR(10) NOT NULL DEFAULT 'en',
    content TEXT NOT NULL,
    source VARCHAR(50) DEFAULT 'unknown',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id, language)
);

-- AI-generated summaries table
CREATE TABLE IF NOT EXISTS ai_summaries (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    language VARCHAR(10) NOT NULL DEFAULT 'en',
    summary TEXT NOT NULL,
    model VARCHAR(50) NOT NULL,
    processing_time_ms INTEGER,
    approved BOOLEAN DEFAULT FALSE,
    approved_at TIMESTAMPTZ,
    approved_by TEXT,
    edited_by_human BOOLEAN DEFAULT FALSE,
    last_edited_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id, language)
);

-- AI-generated quizzes table
CREATE TABLE IF NOT EXISTS ai_quizzes (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    language VARCHAR(10) NOT NULL DEFAULT 'en',
    quiz_data JSONB NOT NULL,
    model VARCHAR(50) NOT NULL,
    processing_time_ms INTEGER,
    approved BOOLEAN DEFAULT FALSE,
    approved_at TIMESTAMPTZ,
    approved_by TEXT,
    edited_by_human BOOLEAN DEFAULT FALSE,
    last_edited_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id, language)
);

-- AI-generated cumulative quizzes table (Phase 3)
CREATE TABLE IF NOT EXISTS ai_cumulative_quizzes (
    id BIGSERIAL PRIMARY KEY,
    
    -- The video this cumulative quiz is accessed from
    event_id BIGINT NOT NULL,
    
    -- The series this quiz covers
    series_id BIGINT NOT NULL,
    
    -- Language for internationalization
    language VARCHAR(10) NOT NULL,
    
    -- AI model used for generation
    model VARCHAR(50) NOT NULL,
    processing_time_ms INTEGER,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Content moderation (consistent with ai_quizzes and ai_summaries)
    approved BOOLEAN NOT NULL DEFAULT FALSE,
    approved_at TIMESTAMPTZ,
    approved_by VARCHAR(255),
    edited_by_human BOOLEAN NOT NULL DEFAULT FALSE,
    last_edited_by VARCHAR(255),
    flagged BOOLEAN NOT NULL DEFAULT FALSE,
    flag_count INTEGER NOT NULL DEFAULT 0,
    
    -- Quiz content: array of questions with video context
    questions JSONB NOT NULL,
    
    -- Metadata for cache validation
    included_event_ids BIGINT[] NOT NULL,
    video_count INTEGER NOT NULL,
    
    -- Ensure one cumulative quiz per (event, language) combination
    UNIQUE(event_id, language),
    
    -- Validate JSON structure
    CHECK (jsonb_typeof(questions) = 'array'),
    CHECK (video_count > 0)
);

-- Insert default configuration
INSERT INTO ai_config (key, value, description) VALUES
    ('features_enabled', 'true', 'Master switch for AI features')
ON CONFLICT (key) DO NOTHING;

INSERT INTO ai_config (key, value, description) VALUES
    ('default_model', '"gpt-5"', 'Default OpenAI model for generation')
ON CONFLICT (key) DO NOTHING;

INSERT INTO ai_config (key, value, description) VALUES
    ('cache_ttl_seconds', '3600', 'Cache TTL in seconds (1 hour)')
ON CONFLICT (key) DO NOTHING;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_transcripts_event_lang ON video_transcripts(event_id, language);
CREATE INDEX IF NOT EXISTS idx_summaries_event_lang ON ai_summaries(event_id, language);
CREATE INDEX IF NOT EXISTS idx_quizzes_event_lang ON ai_quizzes(event_id, language);
CREATE INDEX IF NOT EXISTS idx_transcripts_created ON video_transcripts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_summaries_created ON ai_summaries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quizzes_created ON ai_quizzes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cumulative_quiz_event ON ai_cumulative_quizzes(event_id);
CREATE INDEX IF NOT EXISTS idx_cumulative_quiz_series ON ai_cumulative_quizzes(series_id);
CREATE INDEX IF NOT EXISTS idx_cumulative_quiz_language ON ai_cumulative_quizzes(language);
CREATE INDEX IF NOT EXISTS idx_cumulative_quiz_updated ON ai_cumulative_quizzes(updated_at);
CREATE INDEX IF NOT EXISTS idx_cumulative_quiz_flagged ON ai_cumulative_quizzes(flagged) WHERE flagged = true;

-- Display success message
SELECT 'AI Service database schema created successfully!' AS status;