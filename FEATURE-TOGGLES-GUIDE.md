# Feature Toggles Guide

## Overview

You now have **independent toggles** for Summary and Quiz generation. This gives you fine-grained control over which AI features are active.

## Quick Setup

### 1. Apply Database Migration

Run this SQL script to add the `summary_enabled` toggle:

```bash
psql -U tobira -d tobira -h localhost -f add-summary-toggle.sql
```

This adds the `summary_enabled` configuration key to your database.

## Using the Feature Toggles

### Method 1: Admin Dashboard (Most User-Friendly) ✨

**This is the recommended way to toggle features!**

1. **Open the Admin Dashboard**
   ```
   http://localhost:3001/admin/admin.html
   ```

2. **Find the "Feature Toggles" Card**
   - Located in the top row of the dashboard
   - Shows three toggle switches with real-time status

3. **Toggle Features with One Click**
   - **🎛️ Master Switch**: Enables/disables ALL AI features
     - When OFF: Summaries and Quizzes are automatically disabled
     - When ON: Individual toggles become active
   
   - **📝 Summary Generation**: Enable/disable AI summaries
     - Only works when Master Switch is ON
     - Toggles independently from quizzes
   
   - **❓ Quiz Generation**: Enable/disable AI quizzes
     - Only works when Master Switch is ON
     - Toggles independently from summaries

4. **Visual Feedback**
   - Green toggle = Feature enabled
   - Gray toggle = Feature disabled
   - Dimmed toggle = Disabled because Master Switch is OFF
   - Success/error messages appear in the activity log

### Method 2: SQL Commands (Direct Database Access)

#### Enable/Disable Master Switch
```sql
-- Enable all AI features
UPDATE ai_config SET value = 'true' WHERE key = 'features_enabled';

-- Disable all AI features
UPDATE ai_config SET value = 'false' WHERE key = 'features_enabled';
```

#### Enable/Disable Summaries
```sql
-- Enable summaries
UPDATE ai_config SET value = 'true' WHERE key = 'summary_enabled';

-- Disable summaries
UPDATE ai_config SET value = 'false' WHERE key = 'summary_enabled';
```

#### Enable/Disable Quizzes
```sql
-- Enable quizzes
UPDATE ai_config SET value = 'true' WHERE key = 'quiz_enabled';

-- Disable quizzes
UPDATE ai_config SET value = 'false' WHERE key = 'quiz_enabled';
```

#### Check Current Settings
```sql
SELECT key, value, description 
FROM ai_config 
WHERE key IN ('features_enabled', 'summary_enabled', 'quiz_enabled')
ORDER BY key;
```

### Method 3: API Endpoints (For Automation)

#### Get Current Feature Status
```bash
curl http://localhost:3001/api/admin/features
```

**Response:**
```json
{
  "masterSwitch": true,
  "summary": true,
  "quiz": false
}
```

#### Toggle a Feature
```bash
# Enable summaries
curl -X PUT http://localhost:3001/api/admin/features \
  -H "Content-Type: application/json" \
  -d '{"feature": "summary_enabled", "enabled": true}'

# Disable quizzes
curl -X PUT http://localhost:3001/api/admin/features \
  -H "Content-Type: application/json" \
  -d '{"feature": "quiz_enabled", "enabled": false}'

# Disable all features (master switch)
curl -X PUT http://localhost:3001/api/admin/features \
  -H "Content-Type: application/json" \
  -d '{"feature": "features_enabled", "enabled": false}'
```

## How It Works

### Feature Hierarchy

```
Master Switch (features_enabled)
├── Summary Generation (summary_enabled)
└── Quiz Generation (quiz_enabled)
```

- **Master Switch = OFF**: Both summaries and quizzes are disabled, regardless of individual settings
- **Master Switch = ON**: Individual features follow their own toggle settings

### Examples

#### Example 1: Only Summaries
```sql
UPDATE ai_config SET value = 'true' WHERE key = 'features_enabled';
UPDATE ai_config SET value = 'true' WHERE key = 'summary_enabled';
UPDATE ai_config SET value = 'false' WHERE key = 'quiz_enabled';
```
✅ Summary generation works  
❌ Quiz generation blocked

#### Example 2: Only Quizzes
```sql
UPDATE ai_config SET value = 'true' WHERE key = 'features_enabled';
UPDATE ai_config SET value = 'false' WHERE key = 'summary_enabled';
UPDATE ai_config SET value = 'true' WHERE key = 'quiz_enabled';
```
❌ Summary generation blocked  
✅ Quiz generation works

#### Example 3: Everything Disabled
```sql
UPDATE ai_config SET value = 'false' WHERE key = 'features_enabled';
```
❌ All AI features disabled (individual toggles don't matter)

#### Example 4: Both Enabled
```sql
UPDATE ai_config SET value = 'true' WHERE key = 'features_enabled';
UPDATE ai_config SET value = 'true' WHERE key = 'summary_enabled';
UPDATE ai_config SET value = 'true' WHERE key = 'quiz_enabled';
```
✅ Summary generation works  
✅ Quiz generation works

## API Behavior When Disabled

### Summary Generation Disabled
```bash
POST /api/summaries/generate/123
```
**Response (403 Forbidden):**
```json
{
  "error": "Summary feature is disabled",
  "message": "Contact administrator to enable summary generation"
}
```

### Quiz Generation Disabled
```bash
POST /api/quizzes/generate/123
```
**Response (403 Forbidden):**
```json
{
  "error": "Quiz feature is disabled",
  "message": "Contact administrator to enable quiz generation"
}
```

## Monitoring

### Check Feature Status
Visit the `/status` endpoint to see current configuration:
```bash
curl http://localhost:3001/status
```

**Response:**
```json
{
  "features": {
    "enabled": true,
    "summary": true,
    "quiz": false,
    "captionExtraction": true
  }
}
```

### Watch the Admin Dashboard
The Feature Toggles card updates in real-time (refreshes every 5 seconds) showing:
- Current state of each toggle
- Visual indicators (green/gray)
- Whether features can be toggled (based on master switch)

## Best Practices

1. **Use the Admin Dashboard** for quick toggles during development/testing
2. **Use SQL commands** for permanent configuration changes in production
3. **Use API endpoints** for automation or integration with other systems
4. **Keep Master Switch ON** unless you want to disable all AI features
5. **Test after toggling** to ensure the expected behavior

## Troubleshooting

### Toggles Don't Change
- Check browser console for errors
- Verify the backend is running on port 3001
- Check database connection

### Features Still Work When Disabled
- Clear cache: The service might be serving cached results
- Restart the service to ensure new settings are loaded
- Check the database to verify settings were saved

### Individual Toggles Are Grayed Out
- This is normal when Master Switch is OFF
- Enable the Master Switch first, then individual features will become active

## Files Modified

- `add-summary-toggle.sql` - Database migration script
- `src/services/database.service.ts` - Added `isSummaryEnabled()` and `isQuizEnabled()` methods
- `src/index.ts` - Added API endpoints and updated feature checks
- `public/admin.html` - Added toggle switches UI

## Support

Need help? Check:
- `README.md` for general setup
- `docs/PHASE2-FEATURES.md` for feature documentation
- Database logs for configuration issues