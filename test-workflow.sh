#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

BASE_URL="http://localhost:3001"

echo -e "${BLUE}=================================${NC}"
echo -e "${BLUE}🧪 Testing Tobira AI Service${NC}"
echo -e "${BLUE}=================================${NC}\n"

# Test 1: Health Check
echo -e "${YELLOW}Test 1: Health Check${NC}"
curl -s ${BASE_URL}/health | jq '.'
echo -e "\n"

# Test 2: Status
echo -e "${YELLOW}Test 2: Service Status${NC}"
curl -s ${BASE_URL}/status | jq '.'
echo -e "\n"

# Test 3: Upload Test Transcript
echo -e "${YELLOW}Test 3: Upload Test Transcript (Event ID: 999)${NC}"
curl -s -X POST ${BASE_URL}/api/transcripts/upload \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": 999,
    "content": "Welcome to this educational video about artificial intelligence and machine learning. In this lecture, we will explore the fundamental concepts of neural networks. Neural networks are computational models inspired by biological neurons in the human brain. They consist of interconnected nodes organized in layers - input layer, hidden layers, and output layer. Each connection has a weight that adjusts during training through a process called backpropagation. The training process involves feeding the network with labeled data and adjusting the weights to minimize the prediction error. Common applications include image recognition, natural language processing, and autonomous systems. We will also discuss different types of neural networks such as convolutional neural networks for image processing and recurrent neural networks for sequential data. Understanding these concepts is crucial for anyone interested in modern AI development.",
    "language": "en",
    "source": "test_upload"
  }' | jq '.'
echo -e "\n"

# Wait a moment
sleep 1

# Test 4: Get Transcript
echo -e "${YELLOW}Test 4: Retrieve Uploaded Transcript${NC}"
curl -s ${BASE_URL}/api/transcripts/999?language=en | jq '.content | .[0:100]'
echo -e "\n"

# Test 5: Generate Summary
echo -e "${YELLOW}Test 5: Generate AI Summary (this will take ~10-15 seconds)${NC}"
echo "Calling OpenAI API..."
curl -s -X POST ${BASE_URL}/api/summaries/generate/999 \
  -H "Content-Type: application/json" \
  -d '{"language": "en"}' | jq '.'
echo -e "\n"

# Test 6: Get Cached Summary
echo -e "${YELLOW}Test 6: Retrieve Cached Summary (should be fast!)${NC}"
curl -s ${BASE_URL}/api/summaries/999?language=en | jq '.'
echo -e "\n"

# Test 7: Metrics
echo -e "${YELLOW}Test 7: Check Performance Metrics${NC}"
curl -s ${BASE_URL}/api/admin/metrics | jq '.'
echo -e "\n"

echo -e "${GREEN}=================================${NC}"
echo -e "${GREEN}✨ All tests completed!${NC}"
echo -e "${GREEN}=================================${NC}\n"

echo -e "${BLUE}Next Steps:${NC}"
echo "1. The summary was generated and cached"
echo "2. Try retrieving the summary again (Test 6) - it should be instant!"
echo "3. Check the database tables:"
echo "   ${YELLOW}SELECT * FROM video_transcripts WHERE event_id = 999;${NC}"
echo "   ${YELLOW}SELECT * FROM ai_summaries WHERE event_id = 999;${NC}"
echo -e "\n"