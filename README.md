# Tobira AI Service

AI-powered microservice for the Tobira video portal, providing automatic video summarization and quiz generation using OpenAI's GPT-5 API.

## Overview

This is a **separate microservice** that connects to Tobira's PostgreSQL database to provide AI features without modifying Tobira's core codebase. Perfect for prototyping and testing AI features before potential integration into main Tobira.

### Features

**Phase 1 (MVP) - Completed ✅**
- ✅ **Automatic Video Summarization** - AI-generated summaries using GPT-5
- ✅ **Transcript Management** - Extract and process video transcripts
- ✅ **Response Caching** - Fast responses with intelligent caching
- ✅ **Performance Monitoring** - Track API usage and response times
- ✅ **Feature Flags** - Easy enable/disable without code changes

**Phase 2 (Production Ready) - Completed ✅**
- ✅ **Automatic Caption Extraction** - Pull transcripts from Tobira's existing caption data
- ✅ **Quiz Generation** - Interactive quizzes from video content
- ✅ **Queue System** - BullMQ-based async processing with Redis
- ✅ **Batch Processing** - Process multiple videos efficiently
- ✅ **Admin Dashboard** - Web-based monitoring and management UI
- ✅ **Content Flagging & Moderation** - User-driven quality control with admin review

## Architecture

```
Tobira Backend (Rust) → PostgreSQL ← AI Service (Node.js/TypeScript)
                            ↓
                    Shared Database Tables:
                    - events (existing, has captions)
                    - video_transcripts (new, for AI processing)
                    - ai_summaries (new)
                    - ai_config (new)
```

## Transcript Workflow

### Manual Upload (Testing Mode)
For quick testing, you can manually upload transcript text:
```bash
curl -X POST http://localhost:3001/api/transcripts/upload \
  -d '{"eventId": 1, "content": "Transcript text..."}'
```

### Automatic Extraction (Production Mode) ✅
The service now automatically:
1. Queries `events.captions` and `event_texts` from Tobira database
2. Fetches caption files (VTT/SRT) from URIs
3. Parses and extracts plain text using industry-standard parser
4. Stores in `video_transcripts` table
5. Generates summaries and quizzes via queue system

**Status:** Both manual upload and automatic extraction are fully operational. See [`docs/PHASE2-FEATURES.md`](docs/PHASE2-FEATURES.md) for usage examples.

## Prerequisites

- **Node.js** 18+ 
- **PostgreSQL** access to Tobira database
- **OpenAI API Key** ([Get one here](https://platform.openai.com/api-keys))
- **Tobira** running with AI database migrations applied

## Documentation

- **[Phase 2 Features](docs/PHASE2-FEATURES.md)** - Complete Phase 2 features documentation (caption extraction, quizzes, queue system, admin dashboard)
- **[Quick Start Guide](docs/QUICKSTART.md)** - Get started in 5 minutes (if available)
- **[Architecture](../../docs/ai-features-architecture.md)** - System design and architecture (if available)
- **[Implementation Plan](../../docs/ai-features-implementation-plan.md)** - Development roadmap (if available)

## Quick Start

### 1. Install Dependencies

```bash
cd /home/odrec/Projects/tobira-ai-service
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add your OpenAI API key:

```bash
OPENAI_API_KEY=your-actual-openai-api-key-here
DATABASE_URL=postgresql://tobira:tobira@localhost:5432/tobira
DEFAULT_MODEL=gpt-5
```

### 3. Ensure Database Migrations Applied

Make sure Tobira's database has the AI feature tables. The migrations should already be applied in your Tobira fork (migration `47-ai-features.sql`).

### 4. Start the Service

```bash
# Development mode with hot reload
npm run dev

# Or build and run production
npm run build
npm start
```

The service will start on `http://localhost:3001`

### 5. Test the Service

```bash
# Health check
curl http://localhost:3001/health

# Status and metrics
curl http://localhost:3001/status
```

## Usage Examples

### For MVP Testing: Upload a Transcript

```bash
curl -X POST http://localhost:3001/api/transcripts/upload \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": 1,
    "content": "This is a lecture about machine learning. First, we discuss supervised learning where we have labeled training data. The algorithm learns to map inputs to outputs based on example input-output pairs...",
    "language": "en"
  }'
```

### Generate AI Summary

```bash
curl -X POST http://localhost:3001/api/summaries/generate/1 \
  -H "Content-Type: application/json" \
  -d '{"language": "en"}'
```

**Response:**
```json
{
  "eventId": 1,
  "language": "en",
  "summary": "This lecture provides an introduction to machine learning...",
  "model": "gpt-5",
  "processingTime": 3247,
  "tokensUsed": 542
}
```

### Get Cached Summary

```bash
curl http://localhost:3001/api/summaries/1?language=en
```

Second request is super fast (<100ms) thanks to caching!

## API Endpoints

### Health & Status

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check and service status |
| `/status` | GET | Feature flags, metrics, and cache stats |

### Transcripts

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/transcripts/upload` | POST | Upload transcript (testing only) |
| `/api/transcripts/:eventId` | GET | Get transcript (with caching) |

**Upload Request Body:**
```json
{
  "eventId": 1,
  "content": "Full transcript text here...",
  "language": "en",
  "source": "manual_upload"
}
```

### Summaries

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/summaries/generate/:eventId` | POST | Generate AI summary from transcript |
| `/api/summaries/:eventId` | GET | Get existing summary (cached) |

**Generate Request Body:**
```json
{
  "language": "en",
  "forceRegenerate": false
}
```

**forceRegenerate:** Set to `true` to regenerate even if summary exists (costs OpenAI tokens).

### Quizzes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/quizzes/generate/:eventId` | POST | Generate AI quiz from transcript |
| `/api/quizzes/:eventId` | GET | Get existing quiz (cached) |
| `/api/quizzes/:eventId` | PUT | Update quiz content |

### Flagged Content (Moderation)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/flags` | GET | Get flagged content (filter by status) |
| `/api/admin/flags/:id` | PUT | Update flag status (resolve/dismiss) |
| `/api/admin/flags/stats` | GET | Get flag statistics by status |

**Query Parameters for GET /api/admin/flags:**
```bash
?status=pending    # Default, shows content awaiting review
?status=resolved   # Shows resolved flags
?status=dismissed  # Shows dismissed flags
```

**Update Flag Request Body:**
```json
{
  "status": "resolved",  // or "dismissed" or "pending"
  "adminNotes": "Content has been corrected",
  "resolvedBy": "admin_username"
}
```

**How Flagging Works:**
1. Users flag problematic AI content in Tobira UI
2. Flags appear in admin dashboard with user feedback
3. Admins review and resolve/dismiss flags
4. System automatically unflags content when all pending flags are addressed
5. Report button reactivates for users

### Admin

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/config` | GET | Get AI configuration from database |
| `/api/admin/metrics` | GET | Get performance metrics |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | *required* | Your OpenAI API key |
| `DATABASE_URL` | *required* | PostgreSQL connection string |
| `PORT` | 3001 | Service port |
| `NODE_ENV` | development | Environment mode |
| `CACHE_TTL_SECONDS` | 3600 | Cache duration (1 hour) |
| `MAX_CONCURRENT_REQUESTS` | 5 | Rate limit |
| `REQUEST_TIMEOUT_MS` | 30000 | OpenAI API timeout |
| `AI_FEATURES_ENABLED` | true | Master feature switch |
| `DEFAULT_MODEL` | gpt-5 | OpenAI model to use |

### Database Configuration

Feature flags and settings can also be controlled via the `ai_config` table:

```sql
-- Enable/disable AI features
UPDATE ai_config SET value = 'true' WHERE key = 'features_enabled';

-- Change default model
UPDATE ai_config SET value = '"gpt-4-turbo"' WHERE key = 'default_model';

-- Adjust cache TTL
UPDATE ai_config SET value = '7200' WHERE key = 'cache_ttl_seconds';
```

## Performance

### Caching Strategy

- **Summaries**: Cached for 1 hour by default (configurable)
- **Transcripts**: Cached indefinitely until updated
- **Cache Hit Rate**: Typically >90% after initial generation
- **Cache Storage**: In-memory (use Redis for production)

### Response Times

- **Cached Summary**: <100ms
- **New Summary Generation**: 2-5 seconds (depends on transcript length)
- **Transcript Upload**: <50ms
- **Caption Extraction** (Phase 2): 100-500ms

### Cost Optimization

- Summaries are cached - only pay once per video
- GPT-5 is efficient for educational content
- Estimated cost: ~$0.01-0.05 per video summary
- No costs for cached responses (99% of requests after first generation)

## Development

### Project Structure

```
tobira-ai-service/
├── src/
│   ├── config/
│   │   └── index.ts         # Environment & configuration
│   ├── services/
│   │   ├── database.service.ts   # PostgreSQL client
│   │   ├── openai.service.ts     # GPT-5 integration
│   │   └── cache.service.ts      # Response caching
│   ├── utils/
│   │   └── monitoring.ts         # Performance tracking
│   └── index.ts                  # Express server & routes
├── tests/
│   └── integration/         # Integration tests
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

### Running Tests

```bash
npm test
```

### Code Quality

```bash
# Type checking
npm run build

# Watch mode during development
npm run dev
```

## Troubleshooting

### "Cannot connect to database"

- Ensure Tobira's PostgreSQL is running
- Check `DATABASE_URL` in `.env` matches your Tobira database
- Verify network connectivity to database

### "OpenAI API error"

- Check your API key is valid and active
- Verify you have sufficient credits in your OpenAI account
- Check OpenAI API status: https://status.openai.com

### "Features are disabled"

Check the database configuration:
```sql
SELECT * FROM ai_config WHERE key = 'features_enabled';
```

Or set environment variable override:
```bash
AI_FEATURES_ENABLED=true npm run dev
```

### "No transcript found"

For MVP testing, you need to upload transcripts manually:
```bash
curl -X POST http://localhost:3001/api/transcripts/upload \
  -H "Content-Type: application/json" \
  -d '{"eventId": 1, "content": "Your transcript here..."}'
```

In Phase 2, this will be automatic from Tobira's caption data.

### TypeScript Errors Before npm install

The TypeScript errors in the code are expected before running `npm install`. They'll disappear once dependencies are installed.

## Integration with Tobira

### Current Setup (Separate Service)

- ✅ Database tables in Tobira's PostgreSQL
- ✅ Independent deployment and scaling
- ✅ Easy to enable/disable via feature flags
- ✅ No changes to Tobira core code
- ✅ Performance isolated from Tobira

### Future Integration Options

If Tobira maintainers want to adopt this:

**Option 1: Keep as Microservice** (Recommended)
- Move this repo as subdirectory in Tobira
- Deploy both services together
- Add GraphQL endpoints in Tobira that call this service
- Minimal changes needed

**Option 2: Full Integration**
- Port code to Rust
- Add GraphQL endpoints directly to Tobira backend
- Integrate into main Tobira service
- More work but tighter integration

See [`INTEGRATION.md`](./INTEGRATION.md) for detailed migration guide (to be created).

## Monitoring & Metrics

### View Current Metrics

```bash
curl http://localhost:3001/api/admin/metrics
```

**Example Response:**
```json
{
  "server": {
    "totalRequests": 156,
    "avgResponseTime": 234,
    "errorRate": "1.28%",
    "cacheHitRate": "89.10%",
    "errors": 2,
    "cached": 139
  },
  "cache": {
    "size": 45,
    "hits": 139,
    "misses": 17,
    "hitRate": "89.10%"
  }
}
```

### Key Metrics to Monitor

- **Cache Hit Rate**: Should be >80% after warmup
- **Average Response Time**: <200ms for cached, <5s for new
- **Error Rate**: Should be <5%
- **OpenAI Token Usage**: Track costs

## Security Considerations

- ✅ OpenAI API key stored in `.env` (never commit!)
- ✅ Database uses standard PostgreSQL authentication
- ✅ Input validation on all endpoints
- ✅ Rate limiting prevents abuse
- ⚠️ No authentication on API endpoints (add if exposing publicly)
- ⚠️ CORS enabled for development (restrict in production)

## Next Steps (Phase 3)

**Current Status:** Phase 2 complete with queue system, Redis, caption extraction, and admin dashboard all operational.

**Recommended Next Steps:**
1. **Add Authentication**: Protect API endpoints
2. **GraphQL API**: Create GraphQL layer for Tobira integration
3. **Frontend Components**: React components for video portal
4. **Automatic Transcription**: Integrate Whisper API for videos without captions
5. **Error Tracking**: Integrate Sentry or similar
6. **Comprehensive Tests**: Unit + integration tests
7. **CI/CD Pipeline**: Automated deployment
8. **Vector Search**: Implement RAG for "chat with video" feature

## Roadmap

### Phase 1 (MVP) - Completed ✅
- [x] Database schema
- [x] Basic transcript handling
- [x] Summary generation with GPT-5
- [x] Response caching
- [x] Performance monitoring
- [x] Feature flags
- [x] RESTful API

### Phase 2 (Production Ready) - Completed ✅ (2025-10-09)
- [x] Automatic caption extraction from Tobira events
- [x] VTT/SRT parser for caption files
- [x] Quiz generation
- [x] Queue system (BullMQ + Redis)
- [x] Batch processing for existing videos
- [x] Admin dashboard UI
- [x] Content review and approval system
- [x] Content flagging and moderation (2025-10-16)

See [`docs/PHASE2-FEATURES.md`](docs/PHASE2-FEATURES.md) for detailed Phase 2 documentation and usage examples.

### Phase 3 (Next - Advanced Features)
- [ ] GraphQL API for Tobira integration
- [ ] Frontend React components
- [ ] Automatic transcription (Whisper API)
- [ ] Chat with video (RAG/vector search)
- [ ] Multi-language support
- [ ] Advanced analytics

## License

Same as Tobira - check main project for license details.

## Support & Resources

- **Tobira Documentation**: https://elan-ev.github.io/tobira
- **OpenAI API Docs**: https://platform.openai.com/docs
- **This Project**: Part of Tobira fork for AI features prototyping

---

**Current Status (October 2025):** Phase 2 complete! The service now includes automatic caption extraction, quiz generation, queue-based processing, admin dashboard with content review/approval, and user-driven content flagging/moderation. Ready for production testing.

**Built for the Tobira video portal community** 🚀