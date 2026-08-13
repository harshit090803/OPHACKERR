"""Fast StudyPilot backend launcher.

Keeps the mature backend implementation in server_legacy.py while adding:
- Python 3.13/3.14 X.509 compatibility without disabling TLS verification.
- Longer Anthropic HTTP timeouts for large PDFs.
- A fast Claude Haiku 4.5 lesson path.
- Parallel lesson + quiz generation immediately after PDF upload.
- Shared in-flight lesson tasks so the browser never starts a duplicate lesson job.
"""

import asyncio
import hashlib
import os
import ssl

# TLS compatibility must be installed before importing the legacy backend.
_original_create_default_context = ssl.create_default_context


def _create_default_context_compat(*args, **kwargs):
    context = _original_create_default_context(*args, **kwargs)
    if hasattr(ssl, "VERIFY_X509_STRICT"):
        context.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return context


ssl.create_default_context = _create_default_context_compat

import httpx

_OriginalAsyncClient = httpx.AsyncClient


class _StudyPilotAsyncClient(_OriginalAsyncClient):
    def __init__(self, *args, **kwargs):
        timeout = kwargs.get("timeout")
        if isinstance(timeout, httpx.Timeout):
            kwargs["timeout"] = httpx.Timeout(
                180.0,
                connect=30.0,
                read=180.0,
                write=180.0,
                pool=30.0,
            )
        super().__init__(*args, **kwargs)


httpx.AsyncClient = _StudyPilotAsyncClient

# Load the existing application implementation.
import server_legacy as _legacy

app = _legacy.app

# ------------------------------------------------------------
# Fast lesson generation
# ------------------------------------------------------------
FAST_LESSON_MODEL = os.environ.get("ANTHROPIC_LESSON_MODEL", "claude-haiku-4-5")
LESSON_INPUT_CHARS = int(os.environ.get("LESSON_INPUT_CHARS", "32000"))
_lesson_tasks: dict[str, asyncio.Task] = {}

FAST_LESSON_PROMPT = """You are Professor StudyPilot creating a fast university video lecture.
Use ONLY the supplied study material.
Return ONLY valid JSON.

Create a compact but genuinely useful lecture with 8-12 slides for normal material.
For very short material use 5-7 slides; for very large material use at most 14 slides.
Each slide must contain:
- title: concise
- bullets: 2-4 exam-relevant points
- narration: 45-85 words of natural spoken teaching
- pop_quiz: null unless a short MCQ is genuinely useful

Prioritize definitions, mechanisms, differences, formulas, examples, applications and exam-worthy concepts.
Do not repeat the same idea across slides.
Do not invent information that is absent from the material.
Keep narration concise so the lecture can be rendered quickly.

Schema:
{"title":"","slides":[{"title":"","bullets":[""],"narration":"","pop_quiz":null}],"homework":[{"question":"","guidance":""}]}
"""


def _lesson_key(material: str) -> str:
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _compact_lesson_material(material: str) -> str:
    material = material.strip()
    if len(material) <= LESSON_INPUT_CHARS:
        return material
    tail = max(4000, LESSON_INPUT_CHARS // 4)
    head = LESSON_INPUT_CHARS - tail
    return material[:head] + "\n\n[...middle of notes compacted for low latency...]\n\n" + material[-tail:]


async def _fast_lesson_request(material: str) -> dict:
    response = await _legacy._get_anthropic_client(150.0).messages.create(
        model=FAST_LESSON_MODEL,
        max_tokens=5000,
        temperature=0.2,
        system=FAST_LESSON_PROMPT,
        messages=[
            {
                "role": "user",
                "content": "STUDY MATERIAL:\n\n" + _compact_lesson_material(material),
            }
        ],
    )
    text = "".join(
        block.text
        for block in response.content
        if getattr(block, "type", None) == "text"
    ).strip()
    if not text:
        raise RuntimeError("Anthropic returned an empty lesson response.")
    return _legacy._extract_json(text)


async def _fast_generate_lesson_plan(material: str) -> dict:
    key = _lesson_key(material)
    existing = _lesson_tasks.get(key)
    if existing is None:
        existing = asyncio.create_task(_fast_lesson_request(material))
        _lesson_tasks[key] = existing

    try:
        data = await existing
    finally:
        if existing.done():
            _lesson_tasks.pop(key, None)

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
        pop = _legacy._shuffle_mcq_options(pop) if pop and _legacy._valid_mcq(pop) else None
        slides.append(
            {
                "title": title[:80],
                "bullets": bullets[:4],
                "narration": narration[:1800],
                "pop_quiz": pop,
            }
        )

    if not slides:
        raise RuntimeError("AI could not generate a usable video lesson.")

    homework = [
        {
            "question": str(x.get("question", "")).strip()[:400],
            "guidance": str(x.get("guidance", "")).strip()[:400],
        }
        for x in data.get("homework", [])
        if isinstance(x, dict) and x.get("question")
    ]
    return {
        "title": str(data.get("title", "Lesson")).strip()[:80] or "Lesson",
        "slides": slides[:14],
        "homework": homework[:3],
    }


async def _fast_process_document(doc_id: str):
    """Generate the video lesson and study set concurrently."""
    try:
        await _legacy.db.documents.update_one(
            {"id": doc_id}, {"$set": {"status": "processing", "error": None}}
        )
        doc = await _legacy.db.documents.find_one({"id": doc_id}, {"_id": 0})
        if not doc:
            return

        cleaned = _legacy.clean_text(doc.get("raw_text", ""))
        if len(cleaned) < 200:
            await _legacy.db.documents.update_one(
                {"id": doc_id},
                {"$set": {"status": "error", "error": "Not enough readable text extracted from the PDF."}},
            )
            return

        # Critical latency win: video lesson and quiz/flashcards start together.
        lesson_task = asyncio.create_task(_fast_generate_lesson_plan(cleaned))
        study_task = asyncio.create_task(_legacy.generate_study_content(cleaned, doc_id))

        lesson = await lesson_task
        await _legacy.db.documents.update_one(
            {"id": doc_id}, {"$set": {"lesson": lesson}}
        )

        # Start TTS immediately. VideoTeacher will normally receive cached audio.
        asyncio.create_task(_legacy._warm_lesson_audio(lesson))

        # Quiz/flashcards finish independently without delaying lesson creation.
        result = await study_task
        if not result["quiz"] and not result["flashcards"]:
            await _legacy.db.documents.update_one(
                {"id": doc_id},
                {"$set": {"status": "error", "error": "AI could not generate meaningful questions from this material."}},
            )
            return

        await _legacy.db.documents.update_one(
            {"id": doc_id}, {"$set": {"status": "ready", **result}}
        )
        _legacy.logger.info("Document ready: %s", doc_id)
    except Exception as exc:
        _legacy.logger.exception("fast process_document failed")
        await _legacy.db.documents.update_one(
            {"id": doc_id}, {"$set": {"status": "error", "error": str(exc)[:400]}}
        )


# The legacy upload route resolves process_document at runtime, so replacing
# this symbol changes the pipeline without changing the public API.
_legacy.process_document = _fast_process_document
_legacy._generate_lesson_plan = _fast_generate_lesson_plan

# Preserve direct access to legacy public names for uvicorn/local tooling.
for _name in dir(_legacy):
    if not _name.startswith("_"):
        globals()[_name] = getattr(_legacy, _name)
