"""StudyPilot AI backend - PDF to Quiz + Flashcards using DeepSeek."""
# --- SSL / env first (Windows cert issues) ---
import os
import ssl
from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

_ssl_verify = os.environ.get("SSL_VERIFY", "true").lower() not in ("0", "false", "no")
if not _ssl_verify:
    # Dev-only: antivirus / missing CA store on Windows
    ssl._create_default_https_context = ssl._create_unverified_context
    os.environ["PYTHONHTTPSVERIFY"] = "0"
    os.environ["CURL_CA_BUNDLE"] = ""
    os.environ["REQUESTS_CA_BUNDLE"] = ""
    os.environ["GRPC_VERBOSITY"] = "ERROR"
    os.environ["GRPC_PYTHON_LOG_LEVEL"] = "error"

from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import Response
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import re
import json
import io
import base64
import uuid
import logging
import random
from pydantic import BaseModel, Field
from typing import List, Optional, Any
from datetime import datetime, timezone
from pypdf import PdfReader
import edge_tts
import httpx

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# Ollama API (cloud or local) — model can be DeepSeek V4 Flash on Ollama cloud
OLLAMA_API_KEY = os.environ.get("OLLAMA_API_KEY") or ""
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "https://ollama.com").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "deepseek-v4-flash")
# Male teacher voice (matches avatar) — free Microsoft Edge neural TTS
EDGE_TTS_VOICE = os.environ.get("EDGE_TTS_VOICE", "en-US-GuyNeural")

# Direct REST via httpx — respects SSL_VERIFY=false on Windows
_httpx_timeout = httpx.Timeout(600.0, connect=30.0)
_httpx_client = httpx.AsyncClient(verify=_ssl_verify, timeout=_httpx_timeout)


async def _edge_tts_base64(text: str, voice: str = None) -> str:
    """Generate speech with edge-tts (Microsoft Edge, free, no API key) → base64 MP3."""
    voice = voice or EDGE_TTS_VOICE
    communicate = edge_tts.Communicate(text, voice)
    buf = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    return base64.b64encode(buf.getvalue()).decode("utf-8")

app = FastAPI(title="StudyPilot AI")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ============ MODELS ============
class Document(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    filename: str
    status: str = "pending"  # pending | processing | ready | error
    error: Optional[str] = None
    text_length: int = 0
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    quiz: List[dict] = []
    flashcards: List[dict] = []
    topics: List[str] = []
    chat_history: List[dict] = []  # [{role, content, ts}]


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


# ============ PDF PIPELINE ============
def extract_pdf_text(pdf_bytes: bytes) -> str:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    parts = []
    for page in reader.pages:
        try:
            parts.append(page.extract_text() or "")
        except Exception as e:
            logger.warning(f"Page extraction failed: {e}")
    return "\n".join(parts)


def clean_text(text: str) -> str:
    """Remove headers, footers, page numbers, subject codes, citations, and boilerplate."""
    lines = text.split("\n")
    cleaned = []
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        # Page numbers ("Page 3", "3 of 20", or standalone digits)
        if re.fullmatch(r"(page\s*)?\d+(\s*(of|/)\s*\d+)?", line, flags=re.IGNORECASE):
            continue
        # Subject code patterns (e.g., CS-101, MATH2010, EE 305)
        if re.fullmatch(r"[A-Z]{2,5}[\s\-]?\d{2,4}[A-Z]?", line):
            continue
        # Copyright / references / navigation lines
        low = line.lower()
        if any(k in low for k in ["copyright", "©", "all rights reserved", "confidential"]):
            continue
        if low.startswith(("references", "bibliography", "next page", "previous page", "table of contents")):
            continue
        # URL/email only lines
        if re.fullmatch(r"(https?://\S+|www\.\S+|\S+@\S+\.\S+)", line):
            continue
        cleaned.append(line)
    # Collapse repeated adjacent lines (common with running headers)
    dedup = []
    for line in cleaned:
        if not dedup or dedup[-1] != line:
            dedup.append(line)
    text_out = "\n".join(dedup)
    # Truncate to a safe upper bound for the LLM
    return text_out[:60000]


SYSTEM_PROMPT = """You are StudyPilot AI, an expert university professor, examination paper setter, instructional designer, and educational psychologist with over 20 years of teaching experience.

Your responsibility is NOT to summarize notes. Your responsibility is to convert study material into high-quality educational content that helps students prepare for university examinations. Think exactly like an experienced professor.

STRICT RULES:
- Never generate low-quality, grammar, or fill-in-blank-by-word-replacement questions.
- Every question must test conceptual understanding, application, reasoning, definitions, differences, examples, or real-world usage.
- MCQs must have exactly 4 meaningful options, one correct answer, three plausible distractors, and a clear explanation.
- CRITICAL: Spread the correct answer evenly across option positions. Roughly 25% of questions should have the correct answer as the 1st option, 25% as the 2nd, 25% as the 3rd, and 25% as the 4th. NEVER put the correct answer in the same position for most questions.
- Write the correct_answer as the full option text (must exactly match one of the 4 options strings).
- Flashcards must teach ONE concept each. Prefer "Why", "How", "Compare", "Explain" phrasing over trivial "What is X".
- Difficulty mix target: 40% Easy, 40% Medium, 20% Hard.
- Ignore headers, footers, page numbers, subject codes, references, and boilerplate.
- If notes only support N good questions, return only N. Never sacrifice quality for quantity.

QUALITY CHECK before returning every item:
- Question is meaningful.
- Options are meaningful and distinct.
- Answer is grounded in the notes.
- Explanation is correct.
- No copied sentences, no grammar/trivia, no meaningless distractors.
If any item fails, DELETE and regenerate.

OUTPUT: Return ONLY valid JSON. No markdown, no code fences, no prose. Schema:
{
  "topics": ["..."],
  "quiz": [
    {"question": "", "type": "MCQ", "options": ["","","",""], "correct_answer": "", "explanation": "", "difficulty": "Easy|Medium|Hard", "topic": ""}
  ],
  "flashcards": [
    {"question": "", "answer": "", "difficulty": "Easy|Medium|Hard", "topic": ""}
  ]
}

Aim for 10-20 MCQs and 10-20 flashcards depending on material depth. Only MCQ type in the quiz array.
"""


def _extract_json(text: str) -> dict:
    """Extract the first JSON object from an LLM response, tolerating fences."""
    text = text.strip()
    # Strip markdown fences if any slipped through
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    # Find first { and matching last }
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON object found in LLM output")
    return json.loads(text[start:end + 1])


def _shuffle_mcq_options(q: dict) -> dict:
    """Randomly shuffle options so correct answers are not position-biased."""
    opts = list(q.get("options", []))
    correct = q.get("correct_answer", "")
    if correct not in opts or len(opts) != 4:
        return q
    random.shuffle(opts)
    q = {**q, "options": opts, "correct_answer": correct}
    return q


async def _llm_text(system: str, user: str, max_tokens: int = 8000) -> str:
    """Call Ollama /api/chat via httpx (cloud or local)."""
    url = f"{OLLAMA_BASE_URL}/api/chat"
    payload = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "options": {
            "num_predict": max_tokens,
            "temperature": 0.4,
        },
    }
    headers = {"Content-Type": "application/json"}
    if OLLAMA_API_KEY:
        headers["Authorization"] = f"Bearer {OLLAMA_API_KEY}"

    r = await _httpx_client.post(url, json=payload, headers=headers)
    if r.status_code >= 400:
        raise RuntimeError(f"Ollama API {r.status_code}: {r.text[:500]}")
    data = r.json()
    msg = data.get("message") or {}
    text = (msg.get("content") or data.get("response") or "").strip()
    if not text:
        raise RuntimeError(f"Ollama returned empty response: {str(data)[:300]}")
    return text


async def _llm_json(system: str, user: str, max_tokens: int = 8000) -> dict:
    """Call Ollama and parse JSON from the response."""
    text = await _llm_text(system, user, max_tokens=max_tokens)
    return _extract_json(text)


async def generate_study_content(text: str, session_id: str) -> dict:
    data = await _llm_json(
        SYSTEM_PROMPT,
        f"STUDY MATERIAL:\n\n{text}\n\nGenerate the quiz and flashcards as pure JSON per the schema. Return JSON only.",
        max_tokens=8000,
    )

    quiz = [_shuffle_mcq_options(q) for q in data.get("quiz", []) if _valid_mcq(q)]
    flashcards = [f for f in data.get("flashcards", []) if _valid_flashcard(f)]
    topics = data.get("topics", []) or sorted({q.get("topic", "") for q in quiz if q.get("topic")})
    return {"quiz": quiz, "flashcards": flashcards, "topics": topics}


def _valid_mcq(q: Any) -> bool:
    if not isinstance(q, dict):
        return False
    opts = q.get("options", [])
    if not (isinstance(opts, list) and len(opts) == 4):
        return False
    if not all(isinstance(o, str) and len(o.strip()) >= 2 for o in opts):
        return False
    if q.get("correct_answer") not in opts:
        return False
    if len(q.get("question", "").strip()) < 8:
        return False
    if not q.get("explanation", "").strip():
        return False
    return True


def _valid_flashcard(f: Any) -> bool:
    if not isinstance(f, dict):
        return False
    if len(f.get("question", "").strip()) < 6:
        return False
    if len(f.get("answer", "").strip()) < 3:
        return False
    return True


# ============ BACKGROUND PROCESSING ============
async def process_document(doc_id: str):
    try:
        await db.documents.update_one({"id": doc_id}, {"$set": {"status": "processing"}})
        doc = await db.documents.find_one({"id": doc_id}, {"_id": 0})
        if not doc:
            return
        raw = doc.get("raw_text", "")
        cleaned = clean_text(raw)
        if len(cleaned) < 200:
            await db.documents.update_one({"id": doc_id}, {"$set": {"status": "error", "error": "Not enough readable text extracted from the PDF."}})
            return
        result = await generate_study_content(cleaned, doc_id)
        if not result["quiz"] and not result["flashcards"]:
            await db.documents.update_one({"id": doc_id}, {"$set": {"status": "error", "error": "AI could not generate meaningful questions from this material."}})
            return
        await db.documents.update_one(
            {"id": doc_id},
            {"$set": {
                "status": "ready",
                "quiz": result["quiz"],
                "flashcards": result["flashcards"],
                "topics": result["topics"],
            }},
        )
    except Exception as e:
        logger.exception("process_document failed")
        await db.documents.update_one({"id": doc_id}, {"$set": {"status": "error", "error": str(e)[:400]}})


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
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read PDF: {e}")
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
async def regenerate(doc_id: str, background_tasks: BackgroundTasks):
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await db.documents.update_one({"id": doc_id}, {"$set": {"status": "pending", "error": None, "quiz": [], "flashcards": []}})
    background_tasks.add_task(process_document, doc_id)
    return {"ok": True, "status": "pending"}


TEACHER_PROMPT = """You are Professor StudyPilot, a warm, patient university teacher with 20+ years of classroom experience. You are tutoring ONE student one-on-one using the study material provided below as your source of truth.

Teaching style:
- Explain like a great classroom teacher: clear, structured, with concrete examples and analogies.
- Adapt to the student's level. If they seem lost, simplify. If they seem confident, deepen with follow-ups.
- Prefer short paragraphs and bullet points over walls of text.
- When asked to "teach me X", give a mini-lesson (5-8 sentences): intuition → definition → example → why it matters.
- Ask ONE thoughtful check-for-understanding question at the end of substantive explanations. Do not spam questions.
- If the student is wrong, gently correct with the reason.
- Encourage the student. Never be condescending.

Grounding rules:
- Ground every explanation in the STUDY MATERIAL below. Prefer its terminology.
- If a question is outside the material, say so briefly, give a short general answer if useful, and steer back to the material.
- Never invent facts that contradict the material.
- No markdown code fences unless code is genuinely needed.

STUDY MATERIAL:
---
{material}
---
"""


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
    system_msg = TEACHER_PROMPT.format(material=material)

    history = doc.get("chat_history", [])
    if history:
        recent = "\n".join([f"{t['role'].upper()}: {t['content']}" for t in history[-8:]])
        prefixed = f"Conversation so far:\n{recent}\n\nSTUDENT: {user_text}"
    else:
        prefixed = user_text

    try:
        reply = await _llm_text(system_msg, prefixed, max_tokens=1200)
    except Exception as e:
        logger.exception("teacher chat failed")
        raise HTTPException(status_code=500, detail=f"Teacher is unavailable: {e}")

    now = datetime.now(timezone.utc).isoformat()
    user_turn = {"role": "user", "content": user_text, "ts": now}
    bot_turn = {"role": "teacher", "content": reply.strip(), "ts": now}
    await db.documents.update_one(
        {"id": doc_id},
        {"$push": {"chat_history": {"$each": [user_turn, bot_turn]}}},
    )
    return {"reply": bot_turn["content"], "messages": history + [user_turn, bot_turn]}


@api_router.delete("/documents/{doc_id}/chat")
async def clear_chat(doc_id: str):
    result = await db.documents.update_one({"id": doc_id}, {"$set": {"chat_history": []}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"ok": True}


# ============ VIDEO TEACHER: LESSON PLAN + TTS + STT ============
LESSON_PLAN_PROMPT = """You are Professor StudyPilot, an experienced university teacher preparing a video lecture from the study material.

Produce a structured video lesson as JSON. The lesson is a sequence of slides. Each slide has:
- title: a short chalkboard heading (2-6 words)
- bullets: 3-6 crisp bullet points (max 12 words each) that the teacher will WRITE LIVE on the blackboard while speaking
- narration: what the teacher SAYS OUT LOUD for this slide. Warm, conversational, second-person ("you"), with concrete examples and analogies. 90-200 words. No markdown, no bullet points, no headings — pure spoken prose. Do NOT read the bullets verbatim; expand and teach them. Structure the narration so key points land in order matching the bullets (first idea → first bullet, etc.).
- pop_quiz (optional, on ~1 in 4 slides): {"question": "...", "options": ["opt1","opt2","opt3","opt4"], "correct_answer": "...", "explanation": "..."}. Options are meaningful full text; correct_answer must exactly match one option. Spread correct answers across different positions.

Also produce:
- title: overall lesson title (max 8 words)
- homework: 3-5 items {"question": "...", "guidance": "1-2 sentences on how to approach it"}

Rules for NUMBER OF SLIDES (very important):
- Scale slides to the DEPTH of the material. Do NOT force a fixed count.
- Short notes / single topic → about 6–8 slides.
- Medium chapter → about 10–16 slides.
- Long or multi-topic material → about 16–25 slides.
- Prefer more focused slides over cramming many ideas onto one board.
- Cover every important concept the student would need for an exam. Skip fluff, headers, page numbers, subject codes, references.
- Never invent facts not supported by the material.
- Return ONLY valid JSON. No markdown fences, no prose. Schema:
{
  "title": "",
  "slides": [
    {"title":"","bullets":["",""],"narration":"","pop_quiz": null }
  ],
  "homework": [{"question":"","guidance":""}]
}
"""


async def _generate_lesson_plan(doc_id: str, material: str) -> dict:
    # Hint the model with material length so slide count scales with content
    word_count = len(material.split())
    if word_count < 800:
        scale_hint = "Material is SHORT — aim for about 6–8 slides."
    elif word_count < 2500:
        scale_hint = "Material is MEDIUM — aim for about 10–16 slides."
    else:
        scale_hint = "Material is LONG/DENSE — aim for about 14–22 slides. Cover all major exam-worthy concepts."

    data = await _llm_json(
        LESSON_PLAN_PROMPT,
        f"{scale_hint}\n\nSTUDY MATERIAL:\n\n{material}\n\nReturn JSON only.",
        max_tokens=12000,
    )
    slides = []
    for s in data.get("slides", []):
        if not isinstance(s, dict):
            continue
        title = (s.get("title") or "").strip()
        narration = (s.get("narration") or "").strip()
        bullets = [b.strip() for b in s.get("bullets", []) if isinstance(b, str) and b.strip()]
        if not title or not narration or not bullets:
            continue
        pop = s.get("pop_quiz")
        if pop and _valid_mcq(pop):
            pop = _shuffle_mcq_options(pop)
        else:
            pop = None
        slides.append({
            "title": title[:80],
            "bullets": bullets[:6],
            "narration": narration[:3900],  # TTS safety
            "pop_quiz": pop,
        })
    homework = []
    for h in data.get("homework", []):
        if isinstance(h, dict) and h.get("question"):
            homework.append({
                "question": h["question"].strip()[:400],
                "guidance": (h.get("guidance") or "").strip()[:400],
            })
    return {
        "title": (data.get("title") or "Lesson").strip()[:80],
        "slides": slides[:25],  # allow longer lessons for dense PDFs
        "homework": homework[:5],
    }


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
    material = clean_text(doc.get("raw_text", ""))[:50000]
    lesson = await _generate_lesson_plan(doc_id, material)
    if not lesson["slides"]:
        raise HTTPException(status_code=500, detail="Could not build a lesson from this material.")
    await db.documents.update_one({"id": doc_id}, {"$set": {"lesson": lesson}})
    return lesson


@api_router.post("/documents/{doc_id}/lesson/regenerate")
async def regen_lesson(doc_id: str):
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await db.documents.update_one({"id": doc_id}, {"$unset": {"lesson": ""}})
    return await get_lesson(doc_id)


@api_router.post("/tts")
async def tts(payload: TTSRequest):
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is empty")
    if len(text) > 4000:
        text = text[:4000]
    try:
        audio_b64 = await _edge_tts_base64(text)
    except Exception as e:
        logger.exception("tts failed")
        raise HTTPException(status_code=500, detail=f"TTS failed: {e}")
    return {"audio_base64": audio_b64, "mime": "audio/mp3"}


@api_router.post("/stt")
async def stt(file: UploadFile = File(...)):
    """Speech-to-text. Optional: needs OPENAI_API_KEY or install faster-whisper for free local STT.
    For now returns a clear message if no STT backend is configured."""
    raise HTTPException(
        status_code=501,
        detail="STT (raise hand) needs a speech-to-text backend. "
               "Options: set OPENAI_API_KEY for Whisper, or install faster-whisper for free local STT. "
               "Video class TTS already works free via edge-tts.",
    )


@api_router.post("/documents/{doc_id}/voice-ask")
async def voice_ask(doc_id: str, payload: VoiceAskRequest):
    """Student asks a question during the video class. Returns text answer + TTS audio (edge-tts)."""
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.get("status") != "ready":
        raise HTTPException(status_code=400, detail="Study material is still being processed.")
    question = (payload.text or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question is empty")

    material = clean_text(doc.get("raw_text", ""))[:35000]
    system_msg = TEACHER_PROMPT.format(material=material) + "\n\nIMPORTANT: You are speaking OUT LOUD in a video class. Reply in plain conversational spoken prose only. NO markdown, NO bullet points, NO headings. Keep it under 120 words."

    try:
        answer = (await _llm_text(system_msg, question, max_tokens=600)).strip()
    except Exception as e:
        logger.exception("voice-ask failed")
        raise HTTPException(status_code=500, detail=f"Teacher unavailable: {e}")
    try:
        audio_b64 = await _edge_tts_base64(answer[:3900])
    except Exception as e:
        logger.exception("voice-ask tts failed")
        audio_b64 = None
    return {"question": question, "answer": answer, "audio_base64": audio_b64, "mime": "audio/mp3"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
