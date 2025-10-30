-- Quick fix for missing ai_cumulative_quizzes table
-- Run this on your deployed server to fix the error

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

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_cumulative_quiz_event ON ai_cumulative_quizzes(event_id);
CREATE INDEX IF NOT EXISTS idx_cumulative_quiz_series ON ai_cumulative_quizzes(series_id);
CREATE INDEX IF NOT EXISTS idx_cumulative_quiz_language ON ai_cumulative_quizzes(language);
CREATE INDEX IF NOT EXISTS idx_cumulative_quiz_updated ON ai_cumulative_quizzes(updated_at);
CREATE INDEX IF NOT EXISTS idx_cumulative_quiz_flagged ON ai_cumulative_quizzes(flagged) WHERE flagged = true;

-- Verify the table was created
SELECT 'SUCCESS: ai_cumulative_quizzes table created!' AS status;
SELECT COUNT(*) AS table_count FROM information_schema.tables 
WHERE table_name = 'ai_cumulative_quizzes';