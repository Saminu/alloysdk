import { GoogleGenAI } from '@google/genai';
import { Alloy } from './alloy.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const alloy = new Alloy({ defaultProvider: 'gemini' });

async function runGeminiQuery() {
  const rawMessages = [
    { 
      role: 'user', 
      content: `Here is the user profile data:
      {
        "userId": 94820,
        "preferences": {
          "notifications": true,
          "theme": "dark"
        }
      }` 
    },
    { 
      role: 'assistant', // Alloy will map this to 'model' for Gemini
      content: 'I have loaded the user preferences.' 
    },
    { 
      role: 'user', 
      content: 'Summarize the user configuration in one bullet point.' 
    }
  ];

  const response = await alloy.execute(
    async (payload) => {
      const geminiResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: payload.contents || payload.messages,
        config: {
          systemInstruction: payload.systemInstruction,
          maxOutputTokens: payload.maxOutputTokens || payload.max_tokens
        }
      });

      return geminiResponse;
    },
    {
      messages: [
        { role: 'system', content: 'You are an enterprise JSON data interpreter.' },
        ...rawMessages
      ]
    },
    { provider: 'gemini', maxTokens: 200 }
  );

  console.log('Gemini Response:', response.text);
  console.log('Alloy Telemetry:', response._alloyMeta);
}

runGeminiQuery();