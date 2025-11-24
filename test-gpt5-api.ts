import { openai } from './src/services/openai.service';

/**
 * Test script to verify GPT-5.1 integration with new responses API
 * and fallback to chat completions API for older models
 */

async function testGPT5Integration() {
  console.log('🧪 Testing GPT-5.1 Integration\n');
  console.log('='.repeat(50));

  const testTranscript = `
    Welcome to this lesson on JavaScript promises.
    A promise is an object representing the eventual completion or failure of an asynchronous operation.
    Promises have three states: pending, fulfilled, and rejected.
    We use .then() to handle successful results and .catch() to handle errors.
  `;

  try {
    // Test 1: GPT-5.1 with new responses API
    console.log('\n✅ Test 1: GPT-5.1 (new responses API)');
    console.log('-'.repeat(50));
    const gpt5Result = await openai.generateSummary(testTranscript, 'gpt-5.1');
    console.log('Model:', gpt5Result.model);
    console.log('Processing Time:', gpt5Result.processingTime, 'ms');
    console.log('Summary Preview:', gpt5Result.content.substring(0, 100) + '...');
    console.log('✅ GPT-5.1 test passed!\n');

    // Test 2: Fallback to chat completions API (GPT-4)
    console.log('✅ Test 2: GPT-4 (fallback to chat completions API)');
    console.log('-'.repeat(50));
    const gpt4Result = await openai.generateSummary(testTranscript, 'gpt-4');
    console.log('Model:', gpt4Result.model);
    console.log('Processing Time:', gpt4Result.processingTime, 'ms');
    console.log('Tokens Used:', gpt4Result.tokensUsed);
    console.log('Summary Preview:', gpt4Result.content.substring(0, 100) + '...');
    console.log('✅ GPT-4 fallback test passed!\n');

    console.log('='.repeat(50));
    console.log('✅ All tests completed successfully!');
    console.log('\nImplementation Summary:');
    console.log('• GPT-5.1 uses the new responses.create() API');
    console.log('• Other models use chat.completions.create() API');
    console.log('• Both APIs work correctly with different parameters');

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the tests
testGPT5Integration().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});