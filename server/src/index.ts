import path from 'path';
import { randomUUID } from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { z } from 'zod';
import { callDeepseek, extractJson } from './deepseek';
import type { ChatCompletionRequestMessage } from './openaiTypes';
import { QuizQuestion, ChoiceQuestion, GradeResult } from './types';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const quizRequestSchema = z.object({
  topic: z.string().min(2, 'topic is required'),
  count: z.number().int().min(1).max(20).default(5),
  type: z.enum(['choice', 'blank']).default('choice'),
  history: z.array(z.string()).max(100).optional(),
});

const rawQuestionSchema = z.object({
  id: z.string().optional(),
  type: z.union([z.literal('choice'), z.literal('blank')]),
  prompt: z.string(),
  options: z.array(z.string()).optional(),
  answer: z.union([z.string(), z.array(z.string())]),
  explanation: z.string().optional(),
});

const quizResponseSchema = z.object({
  questions: z.array(rawQuestionSchema),
});

const gradeRequestSchema = z.object({
  question: rawQuestionSchema,
  userAnswer: z.union([z.string(), z.array(z.string())]),
});

const askSchema = z.object({
  message: z.string().min(1),
  history: z.array(z.object({ role: z.string(), content: z.string() })).optional(),
});

function normalizeQuestion(raw: z.infer<typeof rawQuestionSchema>): QuizQuestion {
  const id = raw.id ?? randomUUID();
  const explanation = raw.explanation;
  if (raw.type === 'choice') {
    const options = raw.options ?? [];
    const answer = Array.isArray(raw.answer) ? raw.answer[0] : raw.answer;
    return {
      id,
      type: 'choice',
      prompt: raw.prompt,
      options,
      answer,
      explanation,
    } as ChoiceQuestion;
  }

  return {
    id,
    type: 'blank',
    prompt: raw.prompt,
    answer: raw.answer,
    explanation,
  } as QuizQuestion;
}

function toHistoryText(history: string[] = []): string {
  const recent = history.slice(-30);
  if (!recent.length) return 'None available.';
  return recent.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

function isChoiceCorrect(questionAnswer: string, userAnswer: string, options: string[] = []): boolean {
  const normalizedCorrect = questionAnswer.trim().toLowerCase();
  const normalizedUser = userAnswer.trim().toLowerCase();
  if (!normalizedCorrect || !normalizedUser) return false;

  if (normalizedCorrect === normalizedUser) return true;

  // Accept match by option label (A/B/C/D) when options include the label.
  const labelMatch = normalizedCorrect.match(/^[a-d]/i);
  if (labelMatch && labelMatch[0].toLowerCase() === normalizedUser) {
    return true;
  }

  // Accept match by option text content.
  return options.some((opt) => opt.toLowerCase().includes(normalizedCorrect) && opt.toLowerCase().includes(normalizedUser));
}

async function getChoiceRationale(question: ChoiceQuestion, userAnswer: string, isCorrect: boolean): Promise<string> {
  const messages: ChatCompletionRequestMessage[] = [
    {
      role: 'system',
      content:
        'You are an instructor. Given a multiple-choice question, the correct answer, and the learner\'s choice, provide a concise explanation (max 4 sentences). Encourage and give one actionable tip. Use Markdown; render any math with LaTeX delimited by $...$ or $$...$$.',
    },
    {
      role: 'user',
      content: `Question: ${question.prompt}\nOptions:\n${question.options.join('\n')}\nCorrect answer: ${question.answer}\nUser answer: ${userAnswer}\nThe user is ${isCorrect ? 'correct' : 'incorrect'}. Respond with helpful feedback only.`,
    },
  ];

  const content = await callDeepseek(messages, { temperature: 0.2 });
  return content;
}

async function evaluateBlank(question: QuizQuestion, userAnswer: string): Promise<GradeResult> {
  const referenceAnswer = Array.isArray(question.answer) ? question.answer.join('; ') : question.answer;
  const messages: ChatCompletionRequestMessage[] = [
    {
      role: 'system',
      content:
        'You grade short answers. Compare the user answer to the reference answers. Return JSON: {"verdict":"correct|partial|incorrect","score":0-1,"explanation":"short"}. Penalize missing key ideas. Reward concise accuracy. Keep explanation in Markdown; for math use LaTeX delimited by $...$ or $$...$$.',
    },
    {
      role: 'user',
      content: `Question: ${question.prompt}\nReference answer(s): ${referenceAnswer}\nUser answer: ${userAnswer}`,
    },
  ];

  const raw = await callDeepseek(messages, { temperature: 0.2, json: true });
  let parsed: { verdict?: string; score?: number; explanation?: string } = {};
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Failed to parse blank grading response', err);
  }

  const verdict = parsed.verdict === 'partial' || parsed.verdict === 'correct' ? parsed.verdict : 'incorrect';
  const score = typeof parsed.score === 'number' ? Math.min(Math.max(parsed.score, 0), 1) : verdict === 'correct' ? 1 : 0;
  return {
    correct: verdict === 'correct',
    verdict,
    score,
    explanation: parsed.explanation ?? '我已记录你的答案。',
  };
}

app.post('/api/quiz', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { topic, count, type, history } = quizRequestSchema.parse(req.body);
    const historyText = toHistoryText(history);

    const messages: ChatCompletionRequestMessage[] = [
      {
        role: 'system',
        content:
          'You are a pedagogy-focused tutor who generates engaging practice questions. Avoid repeating near-duplicates. Balance conceptual understanding and application. Use Markdown; for math include LaTeX with $...$ or $$...$$ delimiters.',
      },
      {
        role: 'user',
        content: `Generate ${count} ${type === 'choice' ? 'multiple-choice' : 'fill-in-the-blank'} questions about "${topic}". Avoid questions similar to these past prompts:\n${historyText}\nRequirements:\n- Output ONLY type "${type}" questions; do NOT mix other types.\n- Vary difficulty from easy to moderate.\n- Keep options/answers concise.\n- For multiple-choice, provide 3-5 options and mark the correct option label (A, B, C, ...).\n- For fill-in, provide concise reference answers.\n- Use Markdown; math must use LaTeX with $...$ or $$...$$ delimiters.\nRespond ONLY with JSON matching: {"questions":[{"id":"string","type":"${type}" ,"prompt":"string","options":["A. ..."],"answer":"string or array","explanation":"short rationale"}]}.`,
      },
    ];

    const content = await callDeepseek(messages, { temperature: 0.4 });
    const jsonString = extractJson(content);
    const parsed = quizResponseSchema.parse(JSON.parse(jsonString));
    const normalized = parsed.questions.map(normalizeQuestion).filter((q) => q.type === type);
    if (!normalized.length) {
      throw new Error('未获取到指定题型的题目，请重试');
    }
    const questions = normalized.slice(0, count);
    res.json({ questions });
  } catch (error) {
    next(error);
  }
});

app.post('/api/grade', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { question: rawQuestion, userAnswer } = gradeRequestSchema.parse(req.body);
    const question = normalizeQuestion(rawQuestion);
    const userAnswerText = Array.isArray(userAnswer) ? userAnswer[0] ?? '' : userAnswer;

    if (question.type === 'choice') {
      const isCorrect = isChoiceCorrect(question.answer, userAnswerText, question.options);
      const rationale = await getChoiceRationale(question as ChoiceQuestion, userAnswerText, isCorrect);
      const result: GradeResult = {
        correct: isCorrect,
        verdict: isCorrect ? 'correct' : 'incorrect',
        score: isCorrect ? 1 : 0,
        explanation: rationale,
      };
      res.json(result);
      return;
    }

    const evaluated = await evaluateBlank(question, userAnswerText);
    res.json(evaluated);
  } catch (error) {
    next(error);
  }
});

app.post('/api/ask', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message, history } = askSchema.parse(req.body);
    const messages: ChatCompletionRequestMessage[] = [
      { role: 'system', content: 'You are a concise and encouraging tutor. Keep answers focused and clear.' },
      ...(history?.map((h) => ({ role: h.role as 'assistant' | 'user' | 'system', content: h.content })) ?? []),
      { role: 'user', content: message },
    ];

    const reply = await callDeepseek(messages, { temperature: 0.5 });
    res.json({ reply });
  } catch (error) {
    next(error);
  }
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(err);
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid request', details: err.errors });
    return;
  }
  const message = err instanceof Error ? err.message : 'Server error';
  res.status(500).json({ error: message });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`AI Teacher server listening on http://localhost:${port}`);
});
