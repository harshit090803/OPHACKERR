# StudyPilot AI

> Drop a PDF. Walk out with an exam-ready video class, quiz, and flashcard deck.

StudyPilot AI turns any study PDF into a full learning experience: an animated **video professor** who delivers voiced lessons with a chalkboard, an **interactive quiz** with real explanations, a **flashcard deck** for spaced practice, and a **Q&A chat** grounded in your material. It thinks like a 20-year university professor, not a summarizer.

---

## Features

### Video Class (the star of the show)
- Illustrated **Prof. StudyPilot** avatar whose mouth lip-syncs to real audio via the Web Audio API
- Dark chalkboard reveals bullet points one by one as the professor speaks
- **Play / Pause / Prev / Next** slide controls and progress dots
- **Voice narration** with free **edge-tts** (Microsoft neural voices, no API key)
- **Pop-quiz** modal at the end of select slides — pick, check, see the explanation, continue
- **Raise your hand** — click the mic, speak your question, Whisper transcribes it, Claude answers, and the professor speaks the reply aloud
- **Homework** panel at the end of class with 3-5 practice questions and guidance

### Quiz Mode
- Multiple-choice questions with 4 meaningful options, one correct answer, three plausible distractors
- Reveal-based feedback: pick → check → see explanation and correct answer
- Balanced difficulty mix (40% Easy / 40% Medium / 20% Hard)
- End-of-quiz results screen with per-question review and retry

### Flashcard Mode
- 3D flip animation (Framer Motion)
- Prev / Next navigation, mark **Got it** / **Review**, running "known" counter
- Colored pastel cards, per-card difficulty and topic tags

### Q&A Chat
- Text chat with the professor persona, grounded in your PDF
- Persistent history, starter prompts, typing indicator, clear-chat

### Library
- Every uploaded PDF is stored with generation status (`pending` → `processing` → `ready` / `error`)
- Grid view with status badges, counts (MCQs / cards), delete, and open actions

---

## Pipeline

```
PDF Upload
   ↓
pypdf text extraction
   ↓
Cleaner: strip page numbers, subject codes (CS-101),
         copyright, references, URLs, running headers
   ↓
Claude Sonnet 4.5 — quiz + flashcards (strict quality prompt)
Claude Sonnet 4.5 — structured lesson plan (scale with material depth)
   ↓
edge-tts (Microsoft neural) — free voice narration per slide
Raise-hand STT is optional (local Whisper or OpenAI)
   ↓
Beautiful, interactive UI
```

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React 19, React Router, Framer Motion, Tailwind CSS, shadcn/ui, sonner |
| Fonts | Outfit (display) + Figtree (body) |
| Design | Neo-brutalist pastel — hard 2px black borders, 4px offset drop shadows, no gradients |
| Backend | FastAPI, Motor (async MongoDB), pypdf |
| AI | Claude Sonnet 4.5 (Anthropic API) + edge-tts |
| Database | MongoDB (documents, generated content, chat history, lesson cache) |

---

## Repository Layout

```
/
├── backend/
│   ├── server.py           # FastAPI app, all /api routes, pipeline
│   ├── requirements.txt
│   └── tests/              # pytest suites (chat + video teacher)
├── frontend/
│   ├── src/
│   │   ├── App.js
│   │   ├── pages/          # Landing, Dashboard (Library), Study
│   │   ├── components/     # VideoTeacher, TeacherAvatar, QuizPlayer,
│   │   │                   #   FlashcardPlayer, TeacherChat, NavBar, ui/
│   │   ├── lib/apiClient.js
│   │   ├── App.css
│   │   └── index.css       # Design tokens + brutal-shadow utilities
│   ├── package.json
│   └── tailwind.config.js
├── memory/PRD.md           # Living product doc
└── README.md
```

---

## API Reference

All endpoints are prefixed with `/api`.

### Documents
| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/upload` | Upload a PDF (multipart `file`, max 15 MB). Returns `{id, status:"pending"}`. Background job runs quiz + flashcard generation. |
| `GET` | `/api/documents` | List all uploaded documents (newest first). |
| `GET` | `/api/documents/{id}` | Fetch a document with its `quiz`, `flashcards`, `topics`. |
| `DELETE` | `/api/documents/{id}` | Delete a document. |
| `POST` | `/api/documents/{id}/regenerate` | Rerun the quiz + flashcard pipeline. |

### Video Teacher
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/documents/{id}/lesson` | Get (or build + cache) the structured lesson plan: `{title, slides[], homework[]}`. |
| `POST` | `/api/documents/{id}/lesson/regenerate` | Wipe and rebuild the lesson. |
| `POST` | `/api/tts` | `{text}` → `{audio_base64, mime:"audio/mp3"}` via edge-tts. |
| `POST` | `/api/stt` | Upload audio blob → STT backend (optional). |
| `POST` | `/api/documents/{id}/voice-ask` | `{text}` → `{answer, audio_base64}`. Student's question → Claude → edge-tts reply. |

### Chat
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/documents/{id}/chat` | Load chat history. |
| `POST` | `/api/documents/{id}/chat` | `{message}` → grounded reply, memory preserved. |
| `DELETE` | `/api/documents/{id}/chat` | Clear chat history. |

---

## Local Setup

### Prereqs
- Python 3.11+
- Node 18+ and Yarn
- MongoDB running locally (or a connection string)

### Backend
```bash
cd backend
pip install -r requirements.txt

# Create backend/.env
cat > .env <<'EOF'
MONGO_URL="mongodb://localhost:27017"
DB_NAME="studypilot"
CORS_ORIGINS="*"
ANTHROPIC_API_KEY=your-anthropic-api-key
ANTHROPIC_MODEL=claude-sonnet-4-5
EDGE_TTS_VOICE=en-US-GuyNeural
EOF

uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

### Frontend
```bash
cd frontend
yarn install

echo 'REACT_APP_BACKEND_URL=http://localhost:8001' > .env

yarn start
```

Open http://localhost:3000, drop a PDF, and start class.

---

## Environment Variables

**backend/.env**
| Key | Description |
|---|---|
| `MONGO_URL` | MongoDB connection string |
| `DB_NAME` | Database name |
| `CORS_ORIGINS` | Comma-separated allowed origins (`*` for local dev) |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `ANTHROPIC_MODEL` | Claude model name (default: `claude-sonnet-4-5`) |
| `EDGE_TTS_VOICE` | Optional Microsoft Edge voice (default: `en-US-GuyNeural`) |

**frontend/.env**
| Key | Description |
|---|---|
| `REACT_APP_BACKEND_URL` | Base URL of the backend (e.g. `http://localhost:8001`) |

> `.env` files are **not** committed. Recreate them anywhere you deploy.

---

## What's Verified

- Backend tests cover upload, generation, chat, video teacher, TTS, STT and voice-ask flows.
- Claude Sonnet 4.5 is used for quiz, flashcard, lesson-plan and teacher-chat generation.
- edge-tts remains the free voice layer.

---

## Roadmap

- **Streaming Narration** — first token in <1 s instead of waiting for the full TTS blob
- **Multiple Teachers** — pick a persona and voice
- **Whiteboard Drawings** — professor sketches diagrams while explaining
- **Class Recording** — save the whole video class as a shareable replay link
- **Spaced Repetition** — resurface weak flashcards on a smart schedule
- **PDF Export** — printable study pack with quiz, flashcards, and lesson transcript

---

## License

Personal / educational use.

---

Powered by Anthropic Claude + free edge-tts (Microsoft voices).
