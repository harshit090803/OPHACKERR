"""StudyPilot AI backend - Anthropic Claude + fast teacher startup."""

import base64
import io
import json
import logging
import os
import random
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Optional

import anthropic
import certifi
import edge_tts
import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from pypdf import PdfReader
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-5")
EDGE_TTS_VOICE = os.environ.get("EDGE_TTS_VOICE", "en-US-GuyNeural")
TEACHER_MAX_TOKENS = int(os.environ.get("TEACHER_MAX_TOKENS", "900"))
TEACHER_TIMEOUT = float(os.environ.get("TEACHER_TIMEOUT", "45"))

anthropic_client: Optional[anthropic.AsyncAnthropic] = None
anthropic_http_client: Optional[httpx.AsyncClient] = None

app = FastAPI(title="StudyPilot")
api_router = APIRouter(prefix="/api")
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


class Document(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    filename: str
    status: str = "pending"
    error: Optional[str] = None
    text_length: int = 0
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    quiz: List[dict] = []
    flashcards: List[dict] = []
    topics: List[str] = []
    chat_history: List[dict] = []


class ChatMessage(BaseModel):
    message: str


class TTSRequest(BaseModel):
    text: str


class VoiceAskRequest(BaseModel):
    text: str


class DocumentSummary(BaseModel):
    id: str
    filename: str
    status: str
    created_at: str
    quiz_count: int = 0
    flashcard_count: int = 0
    error: Optional[str] = None


# ============================================================
# ANTHROPIC CLIENT
# ============================================================

def _get_anthropic_client(timeout: float = 60.0) -> anthropic.AsyncAnthropic:
    global anthropic_client, anthropic_http_client

    if not ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY is not configured.")

    if anthropic_client is None:
        # Keep TLS verification enabled. Explicitly use certifi and ignore
        # broken Windows/Python SSL_* and proxy environment configuration.
        ca_bundle = certifi.where()
        logger.info("Anthropic CA bundle: %s", ca_bundle)
        logger.info("Anthropic HTTPX trust_env: False")
        anthropic_http_client = httpx.AsyncClient(
            verify=ca_bundle,
            trust_env=False,
            timeout=httpx.Timeout(timeout, connect=20.0),
            follow_redirects=True,
            http2=False,
        )
        anthropic_client = anthropic.AsyncAnthropic(
            api_key=ANTHROPIC_API_KEY,
            http_client=anthropic_http_client,
            max_retries=1,
        )

    return anthropic_client


async def _llm_text(
    system: str,
    user: str,
    max_tokens: int = 8000,
    *,
    timeout: Optional[float] = None,
) -> str:
    response = await _get_anthropic_client(timeout or 60.0).messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=max_tokens,
        temperature=0.4,
        system=system,
        messages=[{"role": "user", "content": user}],
    )

    text = "".join(
        block.text
        for block in response.content
        if getattr(block, "type", None) == "text"
    ).strip()

    if not text:
        raise RuntimeError("Anthropic returned an empty response.")

    return text


def _extract_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON object found in Anthropic output")
    return json.loads(text[start:end + 1])


async def _llm_json(system: str, user: str, max_tokens: int = 8000) -> dict:
    return _extract_json(await _llm_text(system, user, max_tokens=max_tokens))


# ============================================================
# TTS
# ============================================================

async def _edge_tts_base64(text: str, voice: str = None) -> str:
    text = text.strip()[:5000]
    communicate = edge_tts.Communicate(text, voice or EDGE_TTS_VOICE)
    buf = io.BytesIO()

    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])

    return base64.b64encode(buf.getvalue()).decode("utf-8")


# ============================================================
# PDF PIPELINE
# ============================================================

def extract_pdf_text(pdf_bytes: bytes) -> str:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    parts = []

    for page in reader.pages:
        try:
            parts.append(page.extract_text() or "")
        except Exception as exc:
            logger.warning("Page extraction failed: %s", exc)

    return "\n".join(parts)


def clean_text(text: str) -> str:
    cleaned = []

    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            continue

        if re.fullmatch(r"(page\s*)?\d+(\s*(of|/)\s*\d+)?", line, re.I):
            continue

        if re.fullmatch(r"[A-Z]{2,5}[\s\-]?\d{2,4}[A-Z]?", line):
            continue

        low = line.lower()
        if any(k in low for k in ["copyright", "©", "all rights reserved", "confidential"]):
            continue

        if low.startswith(("references", "bibliography", "next page", "previous page", "table of contents")):
            continue

        if re.fullmatch(r"(https?://\S+|www\.\S+|\S+@\S+\.\S+)", line):
            continue

        if not cleaned or cleaned[-1] != line:
            cleaned.append(line)

    return "\n".join(cleaned)[:60000]


SYSTEM_PROMPT = """You are StudyPilot AI, an expert university professor, examination paper setter, instructional designer, and educational psychologist with over 20 years of teaching experience.

Convert the supplied study material into high-quality university examination preparation content.

STRICT RULES:
- Every question must test conceptual understanding, application, reasoning, definitions, differences, examples, or real-world usage.
- MCQs must have exactly 4 meaningful options, one correct answer, three plausible distractors, and a clear explanation.
- Spread correct answers across option positions.
- correct_answer must exactly match one option string.
- Flashcards must teach one concept each; prefer Why/How/Compare/Explain questions.
- Difficulty target: 40% Easy, 40% Medium, 20% Hard.
- Ignore headers, footers, page numbers, subject codes, references, and boilerplate.
- Never sacrifice quality for quantity.
- Return ONLY valid JSON.

Schema:
{"topics":["..."],"quiz":[{"question":"","type":"MCQ","options":["","","",""],"correct_answer":"","explanation":"","difficulty":"Easy|Medium|Hard","topic":""}],"flashcards":[{"question":"","answer":"","difficulty":"Easy|Medium|Hard","topic":""}]}

Aim for 10-20 MCQs and 10-20 flashcards depending on material depth.
"""


def _shuffle_mcq_options(q: dict) -> dict:
    options = list(q.get("options", []))
    correct = q.get("correct_answer", "")

    if len(options) == 4 and correct in options:
        random.shuffle(options)
        q = {**q, "options": options, "correct_answer": correct}

    return q


def _valid_mcq(q: Any) -> bool:
    if not isinstance(q, dict):
        return False

    options = q.get("options", [])

    return (
        len(options) == 4
        and all(isinstance(x, str) and len(x.strip()) >= 2 for x in options)
        and q.get("correct_answer") in options
        and len(q.get("question", "").strip()) >= 8
        and bool(q.get("explanation", "").strip())
    )


def _valid_flashcard(f: Any) -> bool:
    return (
        isinstance(f, dict)
        and len(f.get("question", "").strip()) >= 6
        and len(f.get("answer", "").strip()) >= 3
    )


async def generate_study_content(text: str, session_id: str) -> dict:
    data = await _llm_json(
        SYSTEM_PROMPT,
        f"STUDY MATERIAL:\n\n{text}\n\nGenerate the quiz and flashcards as pure JSON.",
        max_tokens=8000,
    )

    quiz = [
        _shuffle_mcq_options(q)
        for q in data.get("quiz", [])
        if _valid_mcq(q)
    ]

    flashcards = [
        f for f in data.get("flashcards", [])
        if _valid_flashcard(f)
    ]

    topics = data.get("topics", []) or sorted({
        q.get("topic", "")
        for q in quiz
        if q.get("topic")
    })

    return {
        "quiz": quiz,
        "flashcards": flashcards,
        "topics": topics,
    }


async def process_document(doc_id: str):
    try:
        await db.documents.update_one(
            {"id": doc_id},
            {"$set": {"status": "processing", "error": None}},
        )

        doc = await db.documents.find_one(
            {"id": doc_id},
            {"_id": 0},
        )

        if not doc:
            return

        cleaned = clean_text(doc.get("raw_text", ""))

        if len(cleaned) < 200:
            await db.documents.update_one(
                {"id": doc_id},
                {"$set": {
                    "status": "error",
                    "error": "Not enough readable text extracted from the PDF.",
                }},
            )
            return

        result = await generate_study_content(cleaned, doc_id)

        if not result["quiz"] and not result["flashcards"]:
            await db.documents.update_one(
                {"id": doc_id},
                {"$set": {
                    "status": "error",
                    "error": "AI could not generate meaningful questions from this material.",
                }},
            )
            return

        await db.documents.update_one(
            {"id": doc_id},
            {"$set": {"status": "ready", **result}},
        )

        logger.info("Document ready: %s", doc_id)

    except Exception as exc:
        logger.exception("process_document failed")

        await db.documents.update_one(
            {"id": doc_id},
            {"$set": {
                "status": "error",
                "error": str(exc)[:400],
            }},
        )


# ============================================================
# TEACHER PROMPTS
# ============================================================

TEACHER_PROMPT = """You are Professor StudyPilot, a warm, patient university teacher with 20+ years of classroom experience. You tutor ONE student using the supplied study material as the source of truth.

Give a fast, focused spoken-style answer.

Keep normal teacher answers under about 150 words unless the student explicitly asks for detail.

Explain with one useful example or analogy when needed.

If asked to teach a concept, give intuition, definition, example, and why it matters.

Ask at most one short check-for-understanding question after substantive explanations.

Ground explanations in the study material.

If a question is outside the material, say so briefly and give a short general answer if useful.

Never invent facts that contradict the material.

STUDY MATERIAL:
---
{material}
---
"""

LESSON_PLAN_PROMPT = """You are Professor StudyPilot, an experienced university teacher preparing a video lecture from the study material.

Produce ONLY valid JSON.

Each slide contains title, bullets, narration, and optional pop_quiz.

Narration is 90-200 words of warm spoken prose.

Cover every important exam-worthy concept without inventing facts.

Scale slide count with material depth: short 6-8, medium 10-16, long 16-25.

Schema:
{"title":"","slides":[{"title":"","bullets":[""],"narration":"","pop_quiz":null}],"homework":[{"question":"","guidance":""}]}
"""


async def _generate_lesson_plan(material: str) -> dict:
    words = len(material.split())

    hint = (
        "SHORT: about 6-8 slides"
        if words < 800
        else "MEDIUM: about 10-16 slides"
        if words < 2500
        else "LONG: about 14-22 slides"
    )

    data = await _llm_json(
        LESSON_PLAN_PROMPT,
        f"{hint}\n\nSTUDY MATERIAL:\n\n{material}",
        max_tokens=12000,
    )

    slides = []

    for item in data.get("slides", []):
        if not isinstance(item, dict):
            continue

        title = str(item.get("title", "")).strip()
        narration = str(item.get("narration", "")).strip()
        bullets = [
            str(x).strip()
            for x in item.get("bullets", [])
            if str(x).strip()
        ]

        if not title or not narration or not bullets:
            continue

        pop = item.get("pop_quiz")
        pop = _shuffle_mcq_options(pop) if pop and _valid_mcq(pop) else None

        slides.append({
            "title": title[:80],
            "bullets": bullets[:6],
            "narration": narration[:3900],
            "pop_quiz": pop,
        })

    homework = [
        {
            "question": str(x.get("question", "")).strip()[:400],
            "guidance": str(x.get("guidance", "")).strip()[:400],
        }
        for x in data.get("homework", [])
        if isinstance(x, dict) and x.get("question")
    ]

    return {
        "title": str(data.get("title", "Lesson")).strip()[:80],
        "slides": slides[:25],
        "homework": homework[:5],
    }


# ============================================================
# BASIC ROUTES
# ============================================================

@api_router.get("/")
async def root():
    return {"service": "StudyPilot AI", "status": "ok"}


@api_router.get("/health")
async def health():
    return {
        "status": "healthy",
        "provider": "anthropic",
        "model": ANTHROPIC_MODEL,
    }


# ============================================================
# UPLOAD
# ============================================================

@api_router.post("/upload")
async def upload_pdf(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    contents = await file.read()

    if len(contents) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="PDF exceeds 15MB limit.")

    try:
        raw_text = extract_pdf_text(contents)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to read PDF: {exc}")

    if len(raw_text.strip()) < 100:
        raise HTTPException(status_code=400, detail="Could not extract text. The PDF may be a scanned image.")

    doc = Document(filename=file.filename, text_length=len(raw_text))
    record = doc.model_dump()
    record["raw_text"] = raw_text

    await db.documents.insert_one(record)
    background_tasks.add_task(process_document, doc.id)

    return {"id": doc.id, "filename": doc.filename, "status": "processing"}


# ============================================================
# DOCUMENTS
# ============================================================

@api_router.get("/documents", response_model=List[DocumentSummary])
async def list_documents():
    docs = await db.documents.find({}, {"_id": 0, "raw_text": 0}).sort("created_at", -1).to_list(200)

    return [
        DocumentSummary(
            id=d["id"],
            filename=d["filename"],
            status=d["status"],
            created_at=d["created_at"],
            quiz_count=len(d.get("quiz", [])),
            flashcard_count=len(d.get("flashcards", [])),
            error=d.get("error"),
        )
        for d in docs
    ]


@api_router.get("/documents/{doc_id}")
async def get_document(doc_id: str):
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0, "raw_text": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@api_router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str):
    result = await db.documents.delete_one({"id": doc_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"ok": True}


@api_router.post("/documents/{doc_id}/regenerate")
async def regenerate_document(doc_id: str, background_tasks: BackgroundTasks):
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0, "id": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    await db.documents.update_one(
        {"id": doc_id},
        {"$set": {"status": "processing", "error": None}},
    )
    background_tasks.add_task(process_document, doc_id)
    return {"id": doc_id, "status": "processing"}


# ============================================================
# CHAT
# ============================================================

@api_router.get("/documents/{doc_id}/chat")
async def get_chat(doc_id: str):
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0, "chat_history": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    history = doc.get("chat_history", [])
    if not isinstance(history, list):
        history = []

    messages = []
    for message in history:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        content = message.get("content")
        if role not in ("user", "assistant") or content is None:
            continue
        messages.append({"role": role, "content": str(content), "created_at": message.get("created_at")})

    return {"messages": messages}


@api_router.post("/documents/{doc_id}/chat")
async def chat_with_teacher(doc_id: str, payload: ChatMessage):
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    material = clean_text(doc.get("raw_text", ""))[:18000]
    history = doc.get("chat_history", [])[-4:]
    history_text = "\n".join(
        f"{m.get('role', 'user')}: {m.get('content', '')}"
        for m in history if isinstance(m, dict)
    )

    user = f"RECENT CONVERSATION:\n{history_text}\n\nSTUDENT QUESTION:\n{payload.message.strip()}"

    answer = await _llm_text(
        TEACHER_PROMPT.format(material=material),
        user,
        max_tokens=TEACHER_MAX_TOKENS,
        timeout=TEACHER_TIMEOUT,
    )

    now = datetime.now(timezone.utc).isoformat()
    updated_history = history + [
        {"role": "user", "content": payload.message.strip(), "created_at": now},
        {"role": "assistant", "content": answer, "created_at": now},
    ]

    await db.documents.update_one(
        {"id": doc_id},
        {"$set": {"chat_history": updated_history[-10:]}},
    )

    return {"answer": answer, "messages": updated_history[-10:]}


@api_router.delete("/documents/{doc_id}/chat")
async def clear_chat(doc_id: str):
    result = await db.documents.update_one({"id": doc_id}, {"$set": {"chat_history": []}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"ok": True, "messages": []}


# ============================================================
# VIDEO LESSON
# ============================================================

@api_router.get("/documents/{doc_id}/lesson")
async def get_lesson(doc_id: str):
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    cached = doc.get("lesson")
    if isinstance(cached, dict) and cached.get("slides"):
        return cached

    material = clean_text(doc.get("raw_text", ""))
    lesson = await _generate_lesson_plan(material)

    await db.documents.update_one({"id": doc_id}, {"$set": {"lesson": lesson}})
    return lesson


@api_router.post("/documents/{doc_id}/lesson")
async def generate_lesson(doc_id: str):
    return await get_lesson(doc_id)


@api_router.post("/documents/{doc_id}/lesson/regenerate")
async def regenerate_lesson(doc_id: str):
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    lesson = await _generate_lesson_plan(clean_text(doc.get("raw_text", "")))
    await db.documents.update_one({"id": doc_id}, {"$set": {"lesson": lesson}})
    return lesson


# ============================================================
# TTS
# ============================================================

@api_router.post("/tts")
async def tts(payload: TTSRequest):
    audio = await _edge_tts_base64(payload.text)
    return {"audio_base64": audio, "mime": "audio/mpeg"}


# ============================================================
# VOICE ASK
# ============================================================

@api_router.post("/documents/{doc_id}/voice-ask")
async def voice_ask(doc_id: str, payload: VoiceAskRequest):
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    question = payload.text.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Voice question is empty.")

    material = clean_text(doc.get("raw_text", ""))[:18000]
    history = doc.get("chat_history", [])[-4:]
    history_text = "\n".join(
        f"{m.get('role', 'user')}: {m.get('content', '')}"
        for m in history if isinstance(m, dict)
    )

    answer = await _llm_text(
        TEACHER_PROMPT.format(material=material),
        f"RECENT CONVERSATION:\n{history_text}\n\nSTUDENT SPOKEN QUESTION:\n{question}",
        max_tokens=TEACHER_MAX_TOKENS,
        timeout=TEACHER_TIMEOUT,
    )

    audio = await _edge_tts_base64(answer)
    now = datetime.now(timezone.utc).isoformat()

    await db.documents.update_one(
        {"id": doc_id},
        {"$push": {
            "chat_history": {
                "$each": [
                    {"role": "user", "content": question, "created_at": now},
                    {"role": "assistant", "content": answer, "created_at": now},
                ],
                "$slice": -10,
            }
        }},
    )

    return {"answer": answer, "audio_base64": audio, "mime": "audio/mpeg"}


# ============================================================
# REGISTER ROUTER
# ============================================================

app.include_router(api_router)


# ============================================================
# CORS
# ============================================================

origins = os.environ.get("CORS_ORIGINS", "*")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# SHUTDOWN
# ============================================================

@app.on_event("shutdown")
async def shutdown_clients():
    global anthropic_client, anthropic_http_client

    if anthropic_client is not None:
        await anthropic_client.close()
        anthropic_client = None

    if anthropic_http_client is not None:
        await anthropic_http_client.aclose()
        anthropic_http_client = None

    client.close()
