import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { ChatTurn, GradeResult, QuestionType, QuizQuestion } from './types';

interface QuizResponse {
  questions: QuizQuestion[];
}

interface AskResponse {
  reply: string;
}

function useLocalMemory(key: string, fallback: string[] = []) {
  const [value, setValue] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored) return JSON.parse(stored);
    } catch (err) {
      console.warn('Failed to read local memory', err);
    }
    return fallback;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn('Failed to persist local memory', err);
    }
  }, [key, value]);

  return [value, setValue] as const;
}

function App() {
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(5);
  const [quizType, setQuizType] = useState<QuestionType>('choice');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, GradeResult>>({});
  const [loadingQuiz, setLoadingQuiz] = useState(false);
  const [gradingId, setGradingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [askInput, setAskInput] = useState('');
  const [askLoading, setAskLoading] = useState(false);
  const [chat, setChat] = useState<ChatTurn[]>([]);

  const [quizMemory, setQuizMemory] = useLocalMemory('quizMemory', []);

  const recentMemoryPreview = useMemo(() => quizMemory.slice(-5), [quizMemory]);

  const updateMemory = (newPrompts: string[]) => {
    setQuizMemory((prev) => {
      const merged = [...prev, ...newPrompts].slice(-80);
      return merged;
    });
  };

  const generateQuiz = async () => {
    setLoadingQuiz(true);
    setError(null);
    setQuestions([]);
    setResults({});
    setUserAnswers({});
    try {
      const response = await fetch('/api/quiz', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ topic, count, type: quizType, history: quizMemory }),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || '请求失败');
      }

      const data = (await response.json()) as QuizResponse;
      setQuestions(data.questions);
      updateMemory(data.questions.map((q) => q.prompt));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : '生成试题失败');
    } finally {
      setLoadingQuiz(false);
    }
  };

  const submitAnswer = async (question: QuizQuestion, userAnswer: string) => {
    setGradingId(question.id);
    setError(null);
    try {
      const response = await fetch('/api/grade', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question, userAnswer }),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || '判题失败');
      }

      const result = (await response.json()) as GradeResult;
      setResults((prev) => ({ ...prev, [question.id]: result }));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : '判题失败');
    } finally {
      setGradingId(null);
    }
  };

  const handleChoice = (question: QuizQuestion, answer: string) => {
    if (gradingId || results[question.id]) return;
    setUserAnswers((prev) => ({ ...prev, [question.id]: answer }));
    void submitAnswer(question, answer);
  };

  const handleBlankSubmit = (e: FormEvent, question: QuizQuestion) => {
    e.preventDefault();
    if (gradingId || results[question.id]) return;
    const answer = userAnswers[question.id]?.trim();
    if (!answer) {
      setError('请先填写答案');
      return;
    }
    void submitAnswer(question, answer);
  };

  const handleAsk = async () => {
    if (!askInput.trim()) return;
    setAskLoading(true);
    setError(null);
    const newChat: ChatTurn[] = [...chat, { role: 'user', content: askInput }];
    setChat(newChat);
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: askInput, history: chat }),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || '提问失败');
      }

      const data = (await response.json()) as AskResponse;
      setChat((prev) => [...prev, { role: 'assistant', content: data.reply }]);
      setAskInput('');
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : '提问失败');
    } finally {
      setAskLoading(false);
    }
  };

  const renderQuestion = (question: QuizQuestion, index: number) => {
    const result = results[question.id];
    const userAnswer = userAnswers[question.id];
    const graded = Boolean(result);
    const isChoice = question.type === 'choice';
    return (
      <div key={question.id} className="card">
        <div className="card-header">
          <span className="badge">Q{index + 1}</span>
          <p className="prompt">{question.prompt}</p>
        </div>

        {isChoice && question.options && (
          <div className="options">
            {question.options.map((opt) => {
              const label = opt.slice(0, 1);
              const isSelected = userAnswer === label || userAnswer === opt;
              return (
                <button
                  key={opt}
                  className={`pill ${isSelected ? 'selected' : ''}`}
                  disabled={graded || Boolean(gradingId)}
                  onClick={() => handleChoice(question, label)}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        )}

        {!isChoice && (
          <form onSubmit={(e) => handleBlankSubmit(e, question)} className="blank-form">
            <textarea
              rows={3}
              placeholder="请输入你的回答"
              value={userAnswer ?? ''}
              onChange={(e) => setUserAnswers((prev) => ({ ...prev, [question.id]: e.target.value }))}
              disabled={graded || Boolean(gradingId)}
            />
            <button type="submit" disabled={graded || Boolean(gradingId)}>
              提交答案
            </button>
          </form>
        )}

        {graded && result && (
          <div className="result">
            <div className={`verdict ${result.correct ? 'good' : result.verdict === 'partial' ? 'neutral' : 'bad'}`}>
              {result.correct ? '✅ 回答正确' : result.verdict === 'partial' ? '🟡 部分正确' : '❌ 回答不正确'}
            </div>
            <p className="answer">正确答案：{Array.isArray(question.answer) ? question.answer.join(' / ') : question.answer}</p>
            <p className="explanation">解析：{result.explanation ?? 'AI 未提供解析'}</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Deepseek MCP 教学助手</p>
          <h1>生成练习 · 即时判题 · 追问解析</h1>
          <p className="sub">输入主题与题型，AI 会生成题目并在作答后即时给出判题和解析；同时提供对话模式满足你的追问。</p>
          <div className="memory">
            <span>本地记忆 (用于避免重复)：</span>
            {recentMemoryPreview.length ? (
              <ul>
                {recentMemoryPreview.map((m, idx) => (
                  <li key={idx}>{m}</li>
                ))}
              </ul>
            ) : (
              <span className="muted">暂无历史</span>
            )}
          </div>
        </div>
        <div className="panel">
          <label>
            话题 / 领域
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="例如：线性回归" />
          </label>
          <label>
            题目数量
            <input
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
          <label>
            题型
            <select value={quizType} onChange={(e) => setQuizType(e.target.value as QuestionType)}>
              <option value="choice">选择题</option>
              <option value="blank">填空题</option>
            </select>
          </label>
          <button onClick={generateQuiz} disabled={loadingQuiz || !topic.trim()}>
            {loadingQuiz ? '生成中...' : '生成试题'}
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      </header>

      <main>
        <section className="grid">
          <div className="column">
            <h2>练习区</h2>
            {!questions.length && <p className="muted">先输入话题并生成试题</p>}
            {questions.map((q, idx) => renderQuestion(q, idx))}
          </div>

          <div className="column chat">
            <h2>提问 / 追问</h2>
            <div className="chat-window">
              {chat.map((turn, idx) => (
                <div key={idx} className={`bubble ${turn.role === 'user' ? 'user' : 'assistant'}`}>
                  <span className="role">{turn.role === 'user' ? '你' : 'AI'}</span>
                  <p>{turn.content}</p>
                </div>
              ))}
              {!chat.length && <p className="muted">在这里向 AI 提问或追问解析。</p>}
            </div>
            <div className="chat-input">
              <textarea
                rows={4}
                placeholder="请输入你的问题"
                value={askInput}
                onChange={(e) => setAskInput(e.target.value)}
              />
              <button onClick={handleAsk} disabled={askLoading}>
                {askLoading ? '发送中...' : '发送'}
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
