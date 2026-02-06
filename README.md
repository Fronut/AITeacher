# AI Teacher (Deepseek)

A small full-stack app that lets Deepseek (via MCP-style API calls) generate practice questions, grade answers with explanations, and support follow-up Q&A. The app keeps lightweight local memory to reduce repeated questions.

## Prerequisites
- Node.js 18+ (built-in `fetch` is used on the server)
- `.env` in the repo root containing `DEEPSEEK_API_KEY=...` (you already added this)
- Optionally: `DEEPSEEK_API_URL` and `DEEPSEEK_MODEL` (defaults to Deepseek chat completions endpoint and `deepseek-chat`).

## Install
```bash
npm install
```

## Run in development
Runs server (Express + TS) on `http://localhost:4000` and Vite React client on `http://localhost:5173` with API proxy.
```bash
npm run dev
```

## Build & start
```bash
npm run build
npm run start   # starts server from dist
```

## Project structure
- `server/` – Express + TypeScript API
  - `/api/quiz` generate questions
  - `/api/grade` grade answers + explanations
  - `/api/ask` follow-up chat
- `client/` – Vite + React (TS) UI with localStorage memory and quiz/chat views

## Notes
- Answers are hidden until after you submit; grading may trigger a short AI call for explanations.
- Local memory (question prompts) lives in `localStorage` key `quizMemory` to ask Deepseek to avoid duplicates.
- If Deepseek ever returns non-JSON, the server will surface an error; re-try or adjust the prompt.
