# StudyPilot AI — PRD

## Problem
Convert uploaded PDF study material into professor-grade quiz (MCQs) + flashcards + an interactive AI tutor. Not a summarizer — a real exam-prep engine.

## Stack
- Backend: FastAPI + MongoDB (motor), pypdf, anthropic (Claude Sonnet 4.5) + openai (TTS + Whisper)
- Frontend: React 19, react-router, framer-motion, sonner, shadcn/ui, Tailwind, Outfit + Figtree fonts
- Design: Neo-Brutalist pastel (hard black borders, 4px offset shadows, no gradients)

## Implemented (2026-02)
- PDF upload → text extract → cleaner (strips page numbers, subject codes CS-501, copyright, references, URLs) → Claude Sonnet 4.5 pipeline with strict quality prompt → JSON validation
- Endpoints: POST /api/upload, GET /api/documents, GET/DELETE /api/documents/{id}, POST /api/documents/{id}/regenerate
- **AI Teacher chat**: GET/POST/DELETE /api/documents/{id}/chat with memory (last 8 turns recapped in prompt), grounded on the material
- Frontend routes: / (landing + drop), /library (grid + delete + status polling), /study/:id (Quiz | Flashcards | AI Teacher tabs)
- QuizPlayer: pick, check-answer reveal, per-question explanation, results screen with review + restart
- FlashcardPlayer: framer-motion 3D flip, prev/next, mark known/review
- TeacherChat: starter prompts, typing indicator, persistent history, clear chat

## Verified
- Backend pytest 12/12 pass
- Frontend E2E via testing subagent: all flows work
- Real end-to-end: 18 MCQs + 18 flashcards on distributed-systems PDF; grounded 1600-char CAP theorem lesson with memory

## Backlog (P1)
- Export quiz/flashcards as PDF
- Streaming teacher replies (SSE) for faster perceived response
- Spaced-repetition mode for flashcards
- Multi-PDF merge into one study set

## Backlog (P2)
- Auth + saved progress across devices
- Shareable study sets (public link)
- Voice mode for teacher chat
