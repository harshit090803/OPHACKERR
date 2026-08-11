"""StudyPilot AI backend - PDF to Quiz + Flashcards using Anthropic Claude."""

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
import edge_tts
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

# Anthropic Claude configuration
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-5")
anthropic_client: Optional[anthropic.AsyncAnthropic] = None

EDGE_TTS_VOICE = os.environ.get("EDGE_TTS_VOICE", "en-US-GuyNeural")

app = FastAPI(title="StudyPilot AI")
api_router = APIRouter(prefix="/api")
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


# ============ MODELS ============
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


# ============ AI CLIENT ============
def _get_anthropic_client() -> anthropic.AsyncAnthropic:
    global anthropic_client
    if not ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY is not configured.")
    if anthropic_client is None:
        anthropic_client = anthropic.AsyncAnthropic(
            api_key=ANTHROPIC_API_KEY,
            timeout=600.0,
            max_retries=2,
        )
    return anthropic_client


async def _llm_text(system: str, user: str, max_tokens: int = 8000) -> str:
    """Generate text with Anthropic Claude using the official async SDK."""
    response = await _get_anthropic_client().messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=max_tokens,
        temperature=0.4,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    text = "".join(
        block.text for block in response.content
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


# ============ TTS ============
async def _edge_tts_base64(text: str, voice: str = None) -> str:
    communicate = edge_tts.Communicate(text, voice or EDGE_TTS_VOICE)
    buf = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    return base64.b64encode(buf.getvalue()).decode("utf-8")


# ============ PDF PIPELINE ============
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
    quiz = [_shuffle_mcq_options(q) for q in data.get("quiz", []) if _valid_mcq(q)]
    flashcards = [f for f in data.get("flashcards", []) if _valid_flashcard(f)]
    topics = data.get("topics", []) or sorted({q.get("topic", "") for q in quiz if q.get("topic")})
    return {"quiz": quiz, "flashcards": flashcards, "topics": topics}


async def process_document(doc_id: str):
    try:
        await db.documents.update_one({"id": doc_id}, {"$set": {"status": "processing"}})
        doc = await db.documents.find_one({"id": doc_id}, {"_id": 0})
        if not doc:
            return
        cleaned = clean_text(doc.get("raw_text", ""))
        if len(cleaned) < 200:
            await db.documents.update_one({"id": doc_id}, {"$set": {"status": "error", "error": "Not enough readable text extracted from the PDF."}})
            return
        result = await generate_study_content(cleaned, doc_id)
        if not result["quiz"] and not result["flashcards"]:
            await db.documents.update_one({"id": doc_id}, {"$set": {"status": "error", "error": "AI could not generate meaningful questions from this material."}})
            return
        await db.documents.update_one({"id": doc_id}, {"$set": {"status": "ready", **result}})
    except Exception as exc:
        logger.exception("process_document failed")
        await db.documents.update_one({"id": doc_id}, {"$set": {"status": "error", "error": str(exc)[:400]}})


# ============ CHAT ============
TEACHER_PROMPT = """You are Professor StudyPilot, a warm, patient university teacher with 20+ years of classroom experience. You tutor ONE student using the supplied study material as the source of truth.

Explain clearly with examples and analogies. Adapt to the student's level. Prefer short paragraphs and bullets. If asked to teach a concept, give intuition, definition, example, and why it matters. Ask one thoughtful check-for-understanding question after substantive explanations.

Ground explanations in the study material. If a question is outside the material, say so briefly and give a short general answer if useful. Never invent facts that contradict the material.

STUDY MATERIAL:
---
{material}
---
"""


# ============ LESSON ============
LESSON_PLAN_PROMPT = """You are Professor StudyPilot, an experienced university teacher preparing a video lecture from the study material.

Produce ONLY valid JSON. Each slide contains title, bullets, narration, and optional pop_quiz. Narration is 90-200 words of warm spoken prose. Cover every important exam-worthy concept without inventing facts.

Scale slide count with material depth: short 6-8, medium 10-16, long 16-25.

Schema: {"title":"","slides":[{"title":"","bullets":[""],"narration":"","pop_quiz":null}],"homework":[{"question":"","guidance":""}]}
"""


async def _generate_lesson_plan(material: str) -> dict:
    words = len(material.split())
    hint = "SHORT: about 6-8 slides" if words < 800 else ("MEDIUM: about 10-16 slides" if words < 2500 else "LONG: about 14-22 slides")
    data = await _llm_json(LESSON_PLAN_PROMPT, f"{hint}\n\nSTUDY MATERIAL:\n\n{material}", max_tokens=12000)
    slides = []
    for item in data.get("slides", []):
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()
        narration = str(item.get("narration", "")).strip()
        bullets = [str(x).strip() for x in item.get("bullets", []) if str(x).strip()]
        if not title or not narration or not bullets:
            continue
        pop = item.get("pop_quiz")
        pop = _shuffle_mcq_options(pop) if pop and _valid_mcq(pop) else None
        slides.append({"title": title[:80], "bullets": bullets[:6], "narration": narration[:3900], "pop_quiz": pop})
    homework = [
        {"question": str(x.get("question", "")).strip()[:400], "guidance": str(x.get("guidance", "")).strip()[:400]}
        for x in data.get("homework", []) if isinstance(x, dict) and x.get("question")
    ]
    return {"title": str(data.get("title", "Lesson")).strip()[:80], "slides": slides[:25], "homework": homework[:5]}


# ============ ROUTES ============
@api_router.get("/")
async def root():
    return {"service": "StudyPilot AI", "status": "ok"}


@api_router.post("/upload")
async def upload_pdf(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
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
    return {"id": doc.id, "filename": doc.filename, "status": doc.status}


@api_router.get("/documents", response_model=List[DocumentSummary])
async def list_documents():
    docs = await db.documents.find({}, {"_id": 0, "raw_text": 0}).sort("created_at", -1).to_list(200)
    return [DocumentSummary(id=d["id"], filename=d["filename"], status=d["status"], created_at=d["created_at"], quiz_count=len(d.get("quiz", [])), flashcard_count=len(d.get("flashcards", [])), error=d.get("error")) for d in docs]


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
async def regenerate(doc_id: str, background_tasks: BackgroundTasks):
    if not await db.documents.find_one({"id": doc_id}):
        raise HTTPException(status_code=404, detail="Document not found")
    await db.documents.update_one({"id": doc_id}, {"$set": {"status": "pending", "error": None, "quiz": [], "flashcards": []}})
    background_tasks.add_task(process_document, doc_id)
    return {"ok": True, "status": "pending"}


@api_router.get("/documents/{doc_id}/chat")
async def get_chat(doc_id: str):
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0, "chat_history": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"messages": doc.get("chat_history", [])}


@api_router.post("/documents/{doc_id}/chat")
async def chat_with_teacher(doc_id: str, payload: ChatMessage):
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.get("status") != "ready":
        raise HTTPException(status_code=400, detail="Study material is still being processed. Please wait a moment.")
    user_text = (payload.message or "").strip()
    if not user_text:
        raise HTTPException(status_code=400, detail="Message is empty")
    material = clean_text(doc.get("raw_text", ""))[:40000]
    history = doc.get("chat_history", [])
    recent = "\n".join(f"{x['role'].upper()}: {x['content']}" for x in history[-8:])
    prompt = f"Conversation so far:\n{recent}\n\nSTUDENT: {user_text}" if recent else user_text
    try:
        reply = await _llm_text(TEACHER_PROMPT.format(material=material), prompt, max_tokens=1200)
    except Exception as exc:
        logger.exception("teacher chat failed")
        raise HTTPException(status_code=500, detail=f"Teacher is unavailable: {exc}")
    now = datetime.now(timezone.utc).isoformat()
    user_turn = {"role": "user", "content": user_text, "ts": now}
    bot_turn = {"role": "teacher", "content": reply.strip(), "ts": now}
    await db.documents.update_one({"id": doc_id}, {"$push": {"chat_history": {"$each": [user_turn, bot_turn]}}})
    return {"reply": bot_turn["content"], "messages": history + [user_turn, bot_turn]}


@api_router.delete("/documents/{doc_id}/chat")
async def clear_chat(doc_id: str):
    result = await db.documents.update_one({"id": doc_id}, {"$set": {"chat_history": []}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"ok": True}


@api_router.get("/documents/{doc_id}/lesson")
async def get_lesson(doc_id: str):
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.get("status") != "ready":
        raise HTTPException(status_code=400, detail="Study material is still being processed.")
    lesson = doc.get("lesson")
    if lesson and lesson.get("slides"):
        return lesson
    lesson = await _generate_lesson_plan(clean_text(doc.get("raw_text", ""))[:50000])
    if not lesson["slides"]:
        raise HTTPException(status_code=500, detail="Could not build a lesson from this material.")
    await db.documents.update_one({"id": doc_id}, {"$set": {"lesson": lesson}})
    return lesson


@api_router.post("/documents/{doc_id}/lesson/regenerate")
async def regen_lesson(doc_id: str):
    if not await db.documents.find_one({"id": doc_id}):
        raise HTTPException(status_code=404, detail="Document not found")
    await db.documents.update_one({"id": doc_id}, {"$unset": {"lesson": ""}})
    return await get_lesson(doc_id)


@api_router.post("/tts")
async def tts(payload: TTSRequest):
    text = (payload.text or "").strip()[:4000]
    if not text:
        raise HTTPException(status_code=400, detail="Text is empty")
    try:
        audio_b64 = await _edge_tts_base64(text)
    except Exception as exc:
        logger.exception("tts failed")
        raise HTTPException(status_code=500, detail=f"TTS failed: {exc}")
    return {"audio_base64": audio_b64, "mime": "audio/mp3"}


@api_router.post("/stt")
async def stt(file: UploadFile = File(...)):
    raise HTTPException(status_code=501, detail="STT needs a speech-to-text backend. Install faster-whisper for local STT or configure an STT provider.")


@api_router.post("/documents/{doc_id}/voice-ask")
async def voice_ask(doc_id: str, payload: VoiceAskRequest):
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.get("status") != "ready":
        raise HTTPException(status_code=400, detail="Study material is still being processed.")
    question = (payload.text or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question is empty")
    material = clean_text(doc.get("raw_text", ""))[:35000]
    system = TEACHER_PROMPT.format(material=material) + "\n\nReply as spoken prose only, with no markdown, headings, or bullets. Keep it under 120 words."
    try:
        answer = (await _llm_text(system, question, max_tokens=600)).strip()
    except Exception as exc:
        logger.exception("voice-ask failed")
        raise HTTPException(status_code=500, detail=f"Teacher unavailable: {exc}")
    try:
        audio_b64 = await _edge_tts_base64(answer[:3900])
    except Exception:
        audio_b64 = None
    return {"question": question, "answer": answer, "audio_base64": audio_b64, "mime": "audio/mp3"}


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_clients():
    global anthropic_client
    if anthropic_client is not None:
        await anthropic_client.close()
    client.close()
