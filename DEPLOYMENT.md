# Tobira AI Service - Deployment Guide

This guide explains how to deploy the Tobira AI Service to your server.

## Prerequisites

1. Access to the Tobira PostgreSQL database
2. Node.js 18+ installed on the server
3. OpenAI API key
4. Redis server (for queue processing)

## Database Setup

### Method 1: Run the Complete Schema (Recommended for new deployments)

If you're setting up the AI service for the first time, run the complete schema:

```bash
# Connect to your Tobira database
psql -U tobira -d tobira -h localhost

# Run the schema file
\i /path/to/tobira-ai-service/schema.sql
```

Or from the command line:

```bash
psql -U tobira -d tobira -h localhost -f /path/to/tobira-ai-service/schema.sql
```

### Method 2: Apply Missing Table Only (For existing deployments)

If you already have the basic AI tables but are missing the `ai_cumulative_quizzes` table, you can apply just that migration:

```bash
# SSH into your server
ssh user@your-server

# Run the SQL to create the missing table
psql -U tobira -d tobira << 'EOF'
-- AI-generated cumulative quizzes table (Phase 3)
CREATE TABLE IF NOT EXISTS ai_cumulative_quizzes (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL,
    series_id BIGINT NOT NULL,
    language VARCHAR(10) NOT NULL,
    model VARCHAR(50) NOT NULL,
    processing_time_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved BOOLEAN NOT NULL DEFAULT FALSE,
    approved_at TIMESTAMPTZ,
    approved_by VARCHAR(255),
    edited_by_human BOOLEAN NOT NULL DEFAULT FALSE,
    last_edited_by VARCHAR(255),
    flagged BOOLEAN NOT NULL DEFAULT FALSE,
    flag_count INTEGER NOT NULL DEFAULT 0,
    questions JSONB NOT NULL,
    included_event_ids BIGINT[] NOT NULL,
    video_count INTEGER NOT NULL,
    UNIQUE(event_id, language),
    CHECK (jsonb_typeof(questions) = 'array'),
    CHECK (video_count > 0)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_cumulative_quiz_event ON ai_cumulative_quizzes(event_id);
CREATE INDEX IF NOT EXISTS idx_cumulative_quiz_series ON ai_cumulative_quizzes(series_id);
CREATE INDEX IF NOT EXISTS idx_cumulative_quiz_language ON ai_cumulative_quizzes(language);
CREATE INDEX IF NOT EXISTS idx_cumulative_quiz_updated ON ai_cumulative_quizzes(updated_at);
CREATE INDEX IF NOT EXISTS idx_cumulative_quiz_flagged ON ai_cumulative_quizzes(flagged) WHERE flagged = true;

SELECT 'ai_cumulative_quizzes table created successfully!' AS status;
EOF
```

### Method 3: Using the Tobira Migration System

If you're using the main Tobira repository, the migration is already included in:
- `backend/src/db/migrations/50-cumulative-quizzes.sql`

Apply it through Tobira's migration system:

```bash
cd /path/to/tobira/backend
# Follow Tobira's migration process
```

## Service Deployment

### 1. Copy Files to Server

```bash
# From your local machine
scp -r /home/odrec/Projects/tobira-ai-service user@server:/path/to/deployment/
```

### 2. Install Dependencies

```bash
# On the server
cd /path/to/deployment/tobira-ai-service
npm install --production
```

### 3. Configure Environment

```bash
# Create .env file
cat > .env << 'EOF'
# OpenAI Configuration
OPENAI_API_KEY=your-actual-api-key-here
DEFAULT_MODEL=gpt-4o

# Database Configuration
DATABASE_URL=postgresql://tobira:password@localhost:5432/tobira

# Redis Configuration (for queue processing)
REDIS_HOST=localhost
REDIS_PORT=6379

# Service Configuration
PORT=3001
NODE_ENV=production
CACHE_TTL_SECONDS=3600

# Logging
LOG_LEVEL=info
EOF
```

### 4. Create Systemd Service

```bash
sudo nano /etc/systemd/system/tobira-ai-service.service
```

Add this content:

```ini
[Unit]
Description=Tobira AI Service
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=tobira
WorkingDirectory=/path/to/deployment/tobira-ai-service
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tobira-ai-service

# Environment
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### 5. Start the Service

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable tobira-ai-service

# Start the service
sudo systemctl start tobira-ai-service

# Check status
sudo systemctl status tobira-ai-service
```

## Verification

### 1. Check Service Logs

```bash
# View recent logs
sudo journalctl -u tobira-ai-service --since "5 minutes ago" --no-pager

# Follow logs in real-time
sudo journalctl -u tobira-ai-service -f

# Check for errors
sudo journalctl -u tobira-ai-service --since "5 minutes ago" --no-pager | grep -i error
```

### 2. Test API Endpoints

```bash
# Check health status
curl http://localhost:3001/status

# Check database connection
curl http://localhost:3001/api/captions/stats
```

### 3. Verify Database Tables

```bash
psql -U tobira -d tobira -c "\dt ai_*"
```

You should see:
- `ai_config`
- `ai_summaries`
- `ai_quizzes`
- `ai_cumulative_quizzes`
- `video_transcripts`

## Troubleshooting

### Error: "relation ai_cumulative_quizzes does not exist"

This means the database table hasn't been created. Apply the schema using Method 1 or Method 2 above.

### Service Won't Start

1. Check logs: `sudo journalctl -u tobira-ai-service -n 50`
2. Verify database connection in `.env`
3. Ensure PostgreSQL is running: `sudo systemctl status postgresql`
4. Ensure Redis is running: `sudo systemctl status redis`

### Connection Issues

1. Check firewall rules
2. Verify database credentials
3. Test database connection: `psql -U tobira -d tobira -h localhost`

### Permission Issues

Ensure the service user has permission to:
- Read the service directory
- Write to log files
- Connect to the database

## Monitoring

### View Service Status

```bash
sudo systemctl status tobira-ai-service
```

### Monitor Resource Usage

```bash
# CPU and memory
top -p $(pgrep -f "tobira-ai-service")

# Detailed stats
ps aux | grep tobira-ai-service
```

### Check API Performance

Access the admin dashboard (if enabled):
```
http://your-server:3001/admin
```

## Updates

To update the service:

```bash
# Stop the service
sudo systemctl stop tobira-ai-service

# Pull latest code or copy new files
cd /path/to/deployment/tobira-ai-service
git pull  # or scp from local

# Install dependencies
npm install --production

# Run migrations if needed
psql -U tobira -d tobira -f schema.sql

# Restart service
sudo systemctl start tobira-ai-service

# Verify
sudo systemctl status tobira-ai-service
```

## Security Considerations

1. **API Key**: Never commit your OpenAI API key. Use environment variables.
2. **Database**: Use a dedicated database user with limited permissions.
3. **Firewall**: Restrict access to the service port (3001) if needed.
4. **HTTPS**: Use a reverse proxy (nginx) for HTTPS in production.

## Support

For issues:
1. Check logs: `sudo journalctl -u tobira-ai-service -f`
2. Verify database schema is up to date
3. Ensure all environment variables are set correctly