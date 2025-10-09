import OpenAI from 'openai';
import { config } from '../config';
import { db } from './database.service';

/**
 * Prompts optimized for educational video content
 */
const SUMMARY_PROMPT = `You are an educational content summarizer specialized in video lectures and educational materials.

Create a concise, informative summary of this video transcript.

Requirements:
- Length: 200-400 words
- Structure: Brief overview, 3-5 key points, brief conclusion
- Tone: Educational, clear, and engaging
- Focus: Main concepts, important insights, and actionable takeaways
- Format: Use clear paragraphs, no bullet points unless listing specific items

Transcript:
{transcript}

Summary:`;

const QUIZ_PROMPT = `You are an educational quiz generator. Create an interactive quiz from this video transcript.

Requirements:
- Generate 8-10 questions total
- Mix of question types: 60% multiple choice, 40% true/false
- Difficulty distribution: 30% easy, 50% medium, 20% hard
- Each question should include:
  - Question text
  - Options (for multiple choice)
  - Correct answer
  - Brief explanation
  - Approximate timestamp in seconds (when the topic appears in the video)
- Questions should test understanding, not just memorization

Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
  "questions": [
    {
      "id": "q1",
      "type": "multiple_choice",
      "question": "Question text here?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_answer": 0,
      "explanation": "Explanation why this is correct",
      "timestamp": 120,
      "difficulty": "easy"
    },
    {
      "id": "q2",
      "type": "true_false",
      "question": "Statement to verify",
      "correct_answer": true,
      "explanation": "Explanation",
      "timestamp": 350,
      "difficulty": "medium"
    }
  ]
}

Transcript:
{transcript}`;

interface GenerationResult {
  content: string;
  model: string;
  processingTime: number;
  tokensUsed?: number;
}

interface QuizData {
  questions: Array<{
    id: string;
    type: string;
    question: string;
    options?: string[];
    correct_answer: number | boolean;
    explanation: string;
    timestamp: number;
    difficulty: string;
  }>;
}

class OpenAIService {
  private client: OpenAI;
  private defaultModel: string;

  constructor() {
    this.client = new OpenAI({
      apiKey: config.openai.apiKey,
      timeout: config.performance.requestTimeoutMs,
    });
    this.defaultModel = config.openai.defaultModel;
  }

  /**
   * Generate AI summary of video transcript
   */
  async generateSummary(transcript: string, model?: string): Promise<GenerationResult> {
    const startTime = Date.now();
    const useModel = model || await db.getDefaultModel() || this.defaultModel;

    // Validate transcript length
    if (transcript.length === 0) {
      throw new Error('Transcript is empty');
    }

    if (transcript.length > 50000) {
      throw new Error('Transcript too long (max 50,000 characters)');
    }

    const prompt = SUMMARY_PROMPT.replace('{transcript}', transcript);

    try {
      const response = await this.client.chat.completions.create({
        model: useModel,
        messages: [
          {
            role: 'system',
            content: 'You are an expert educational content summarizer.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 1,
        max_completion_tokens: 600,
      });

      const summary = response.choices[0].message.content?.trim() || '';
      const processingTime = Date.now() - startTime;

      return {
        content: summary,
        model: useModel,
        processingTime,
        tokensUsed: response.usage?.total_tokens,
      };
    } catch (error: any) {
      console.error('OpenAI API error:', error);
      throw new Error(`Failed to generate summary: ${error.message}`);
    }
  }

  /**
   * Generate interactive quiz from transcript
   */
  async generateQuiz(transcript: string, model?: string): Promise<{
    quizData: QuizData;
    model: string;
    processingTime: number;
  }> {
    const startTime = Date.now();
    const useModel = model || await db.getDefaultModel() || this.defaultModel;

    if (transcript.length === 0) {
      throw new Error('Transcript is empty');
    }

    const prompt = QUIZ_PROMPT.replace('{transcript}', transcript);

    try {
      const response = await this.client.chat.completions.create({
        model: useModel,
        messages: [
          {
            role: 'system',
            content: 'You are an expert educational quiz generator. Return only valid JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 1,
        max_completion_tokens: 2500,
      });

      const content = response.choices[0].message.content?.trim() || '{}';
      
      // Clean up potential markdown code blocks
      const jsonContent = content
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const quizData = JSON.parse(jsonContent) as QuizData;
      const processingTime = Date.now() - startTime;

      // Validate quiz structure
      if (!quizData.questions || !Array.isArray(quizData.questions)) {
        throw new Error('Invalid quiz format: missing questions array');
      }

      if (quizData.questions.length < 5) {
        throw new Error('Quiz must have at least 5 questions');
      }

      return {
        quizData,
        model: useModel,
        processingTime,
      };
    } catch (error: any) {
      console.error('OpenAI quiz generation error:', error);
      throw new Error(`Failed to generate quiz: ${error.message}`);
    }
  }

  /**
   * Check if API key is valid by making a test request
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.client.models.list();
      console.log('OpenAI API connection successful');
      return true;
    } catch (error: any) {
      console.error('OpenAI API connection failed:', error.message);
      return false;
    }
  }

  /**
   * Get available models
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await this.client.models.list();
      return response.data.map(model => model.id);
    } catch (error) {
      console.error('Failed to list models:', error);
      return [];
    }
  }
}

// Export singleton instance
export const openai = new OpenAIService();
export default openai;