-- Migration: Add approval and edit tracking to AI tables
-- Run this on existing databases to add approval functionality

-- Add approval and edit tracking columns to ai_summaries
ALTER TABLE ai_summaries
ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS approved_by TEXT,
ADD COLUMN IF NOT EXISTS edited_by_human BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_edited_by TEXT;

-- Add approval and edit tracking columns to ai_quizzes
ALTER TABLE ai_quizzes
ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS approved_by TEXT,
ADD COLUMN IF NOT EXISTS edited_by_human BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_edited_by TEXT;

-- Display success message
SELECT 'Approval and edit tracking columns added successfully!' AS status;