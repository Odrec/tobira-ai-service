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

-- Display success message
SELECT 'AI Service database schema created successfully!' AS status;