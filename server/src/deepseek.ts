import type { ChatCompletionRequestMessage } from './openaiTypes';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const apiKey = process.env.DEEPSEEK_API_KEY;
const apiUrl = process.env.DEEPSEEK_API_URL ?? 'https://api.deepseek.com/v1/chat/completions';
const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';

if (!apiKey) {
  // eslint-disable-next-line no-console
  console.warn('DEEPSEEK_API_KEY is missing. Add it to .env to enable AI features.');
}

export interface DeepseekOptions {
  temperature?: number;
  json?: boolean;
}

export async function callDeepseek(
  messages: ChatCompletionRequestMessage[],
  options: DeepseekOptions = {}
): Promise<string> {
  if (!apiKey) {
    throw new Error('Deepseek API key not configured');
  }

  const body = {
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    response_format: options.json ? { type: 'json_object' } : undefined,
  };

  // log outgoing payload without credentials
  // eslint-disable-next-line no-console
  console.log('[deepseek][request]', JSON.stringify(body));

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Deepseek API error: ${response.status} ${text}`);
  }

  const text = await response.text();
  // eslint-disable-next-line no-console
  console.log('[deepseek][response]', response.status, text);

  const data = JSON.parse(text);
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('Deepseek returned empty content');
  }
  return content.trim();
}

export function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed;
  }

  const fenceMatch = trimmed.match(/```(?:json)?\n([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}
