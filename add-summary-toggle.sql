-- Add separate summary_enabled toggle to ai_config
-- This allows independent control of summaries and quizzes

INSERT INTO ai_config (key, value, description) VALUES
    ('summary_enabled', 'true', 'Enable/disable AI summary generation')
ON CONFLICT (key) DO NOTHING;

-- Add quiz_enabled if it doesn't exist (should already exist from schema.sql)
INSERT INTO ai_config (key, value, description) VALUES
    ('quiz_enabled', 'true', 'Enable/disable AI quiz generation')
ON CONFLICT (key) DO NOTHING;

-- Display current settings
SELECT key, value, description 
FROM ai_config 
WHERE key IN ('features_enabled', 'summary_enabled', 'quiz_enabled')
ORDER BY key;