export type QuestionType = 'choice' | 'blank';

export interface QuizQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  options?: string[];
  answer?: string | string[];
  explanation?: string;
   summary?: string;
}

export interface GradeResult {
  correct: boolean;
  verdict?: 'correct' | 'partial' | 'incorrect';
  score?: number;
  explanation?: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}
