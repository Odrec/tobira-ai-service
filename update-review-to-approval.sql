-- Migration: Rename review columns to approval and add human edit tracking
-- Run this to improve the review/approval workflow

-- Update ai_summaries table
ALTER TABLE ai_summaries 
RENAME COLUMN reviewed TO approved;

ALTER TABLE ai_summaries 
RENAME COLUMN reviewed_at TO approved_at;

ALTER TABLE ai_summaries 
RENAME COLUMN reviewed_by TO approved_by;

-- Add human edit tracking
ALTER TABLE ai_summaries 
ADD COLUMN IF NOT EXISTS edited_by_human BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_edited_by TEXT;

-- Update ai_quizzes table
ALTER TABLE ai_quizzes 
RENAME COLUMN reviewed TO approved;

ALTER TABLE ai_quizzes 
RENAME COLUMN reviewed_at TO approved_at;

ALTER TABLE ai_quizzes 
RENAME COLUMN reviewed_by TO approved_by;

-- Add human edit tracking
ALTER TABLE ai_quizzes 
ADD COLUMN IF NOT EXISTS edited_by_human BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_edited_by TEXT;

-- Display success message
SELECT 'Review columns renamed to approval, human edit tracking added!' AS status;