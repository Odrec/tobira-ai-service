import { config } from './src/config';
import { openai } from './src/services/openai.service';

async function testOpenAI() {
  console.log('\n=================================');
  console.log('🧪 Testing OpenAI Connection');
  console.log('=================================\n');

  // Check if API key is configured
  if (!config.openai.apiKey) {
    console.error('❌ OPENAI_API_KEY not found in environment variables');
    console.log('Please check your .env file');
    process.exit(1);
  }

  console.log('✅ API Key found:', config.openai.apiKey.substring(0, 10) + '...');
  console.log(`📋 Default Model: ${config.openai.defaultModel}\n`);

  // Test 1: Connection Test
  console.log('Test 1: Testing API connection...');
  try {
    const connectionOk = await openai.testConnection();
    if (connectionOk) {
      console.log('✅ Connection successful!\n');
    } else {
      console.log('❌ Connection failed\n');
      process.exit(1);
    }
  } catch (error: any) {
    console.error('❌ Connection error:', error.message);
    process.exit(1);
  }

  // Test 2: List Available Models
  console.log('Test 2: Fetching available models...');
  try {
    const models = await openai.listModels();
    if (models.length > 0) {
      console.log(`✅ Found ${models.length} models`);
      console.log('Available models:', models.slice(0, 10).join(', '));
      if (models.length > 10) {
        console.log(`   ... and ${models.length - 10} more`);
      }
      console.log('');
    } else {
      console.log('⚠️  No models returned (this might be an API limitation)\n');
    }
  } catch (error: any) {
    console.error('❌ Failed to list models:', error.message, '\n');
  }

  // Test 3: Generate a test summary
  console.log('Test 3: Testing summary generation...');
  try {
    const testTranscript = `
      Welcome to this tutorial on TypeScript. TypeScript is a strongly typed 
      programming language that builds on JavaScript. It adds optional static 
      typing to the language, which can help catch errors early in development.
      TypeScript compiles to plain JavaScript, so it can run anywhere JavaScript runs.
    `.trim();

    console.log('Generating summary for test transcript...');
    const result = await openai.generateSummary(testTranscript);
    
    console.log('✅ Summary generated successfully!');
    console.log(`Model used: ${result.model}`);
    console.log(`Processing time: ${result.processingTime}ms`);
    console.log(`Tokens used: ${result.tokensUsed || 'N/A'}`);
    console.log('\nGenerated summary:');
    console.log('---');
    console.log(result.content);
    console.log('---\n');
  } catch (error: any) {
    console.error('❌ Summary generation failed:', error.message, '\n');
  }

  console.log('=================================');
  console.log('✨ All tests completed!');
  console.log('=================================\n');
}

testOpenAI().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});