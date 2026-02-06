export type QuestionType = 'choice' | 'blank';

export interface BaseQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  answer: string | string[];
  explanation?: string;
  summary?: string;
}

export interface ChoiceQuestion extends BaseQuestion {
  type: 'choice';
  options: string[];
  answer: string;
}

export interface BlankQuestion extends BaseQuestion {
  type: 'blank';
  answer: string | string[];
}

export type QuizQuestion = ChoiceQuestion | BlankQuestion;

export interface GradeResult {
  correct: boolean;
  score?: number;
  verdict?: 'correct' | 'partial' | 'incorrect';
  explanation?: string;
  feedback?: string;
}
