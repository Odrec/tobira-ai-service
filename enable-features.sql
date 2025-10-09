-- Enable AI features
UPDATE ai_config SET value = 'true' WHERE key = 'features_enabled';

-- Check what event IDs exist
SELECT id, title FROM all_events LIMIT 5;
