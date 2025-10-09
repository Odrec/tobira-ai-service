#!/bin/bash
EVENT_ID="-5264509497287317291"

echo "=== Final AI Service Test ==="
echo ""

echo "1. Upload transcript for event $EVENT_ID"
curl -s -X POST http://localhost:3001/api/transcripts/upload \
  -H "Content-Type: application/json" \
  -d "{
    \"eventId\": $EVENT_ID,
    \"content\": \"This is an educational video about closing remarks at a conference. The speaker thanks everyone for attending and discusses the key takeaways from the event. Topics covered include collaboration, innovation, and future directions for research in the field.\",
    \"language\": \"en\"
  }" | jq '.'

echo ""
echo "2. Generate AI summary"
curl -s -X POST http://localhost:3001/api/summaries/generate/$EVENT_ID \
  -H "Content-Type: application/json" \
  -d '{"language": "en"}' | jq '.'

echo ""
echo "3. Retrieve cached summary (should be fast!)"
curl -s http://localhost:3001/api/summaries/$EVENT_ID?language=en | jq '.'

echo ""
echo "=== Test Complete! ==="
