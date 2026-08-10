"""Backend tests for StudyPilot AI - Video Teacher feature (lesson plan, TTS, STT, voice-ask)."""
import os
import io
import base64
import uuid
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/') if 'REACT_APP_BACKEND_URL' in os.environ else "https://study-pilot-ai.preview.emergentagent.com"
API = f"{BASE_URL}/api"

# Ready seed doc (distributed systems / CAP theorem)
SEED_DOC_ID = "a4296812-7976-4db7-ae70-e7fdefe5990a"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    return s


# ============ LESSON PLAN ============
class TestLesson:
    def test_lesson_on_ready_doc_returns_valid_shape(self, client):
        r = client.get(f"{API}/documents/{SEED_DOC_ID}/lesson", timeout=120)
        assert r.status_code == 200, f"lesson call failed: {r.status_code} {r.text[:400]}"
        data = r.json()
        assert "title" in data and isinstance(data["title"], str) and len(data["title"]) > 0
        assert "slides" in data and isinstance(data["slides"], list)
        assert 6 <= len(data["slides"]) <= 10, f"slides count out of range 6-10: got {len(data['slides'])}"
        assert "homework" in data and isinstance(data["homework"], list)
        assert 3 <= len(data["homework"]) <= 5, f"homework count out of range 3-5: got {len(data['homework'])}"

        # Validate each slide structure
        for i, s in enumerate(data["slides"]):
            assert isinstance(s, dict)
            assert isinstance(s.get("title"), str) and 0 < len(s["title"]) <= 80, f"slide {i} bad title"
            bullets = s.get("bullets")
            assert isinstance(bullets, list) and 3 <= len(bullets) <= 6, f"slide {i} bullets count out of range: {len(bullets) if isinstance(bullets, list) else 'N/A'}"
            for b in bullets:
                assert isinstance(b, str) and len(b.strip()) > 0
            narration = s.get("narration")
            assert isinstance(narration, str) and len(narration) >= 50, f"slide {i} narration too short"
            # pop_quiz optional but if present must be valid MCQ
            pq = s.get("pop_quiz")
            if pq is not None:
                assert isinstance(pq, dict)
                assert "question" in pq and isinstance(pq["question"], str)
                opts = pq.get("options")
                assert isinstance(opts, list) and len(opts) == 4
                assert pq.get("correct_answer") in opts

        # Validate homework
        for h in data["homework"]:
            assert isinstance(h, dict)
            assert isinstance(h.get("question"), str) and len(h["question"]) > 0

        # Grounding: title/bullets/narration should reference CAP concepts somewhere
        joined = (data["title"] + " " + " ".join(
            [s["title"] + " " + " ".join(s["bullets"]) + " " + s["narration"] for s in data["slides"]]
        )).lower()
        assert any(k in joined for k in ["consistency", "availability", "partition", "cap", "distributed", "scalab"]), \
            f"lesson not grounded in seed material"

    def test_lesson_idempotent_second_call_returns_cached(self, client):
        r1 = client.get(f"{API}/documents/{SEED_DOC_ID}/lesson", timeout=120)
        assert r1.status_code == 200
        d1 = r1.json()
        r2 = client.get(f"{API}/documents/{SEED_DOC_ID}/lesson", timeout=30)
        assert r2.status_code == 200
        d2 = r2.json()
        # Same content
        assert d1["title"] == d2["title"]
        assert len(d1["slides"]) == len(d2["slides"])
        assert d1["slides"][0]["title"] == d2["slides"][0]["title"]
        assert d1["slides"][0]["narration"] == d2["slides"][0]["narration"]

    def test_lesson_on_unknown_doc_404(self, client):
        r = client.get(f"{API}/documents/{uuid.uuid4()}/lesson")
        assert r.status_code == 404

    def test_lesson_on_pending_doc_400(self, client):
        """Upload a doc and immediately hit lesson endpoint to catch pending/processing state."""
        try:
            from reportlab.pdfgen import canvas
            from reportlab.lib.pagesizes import LETTER
        except Exception:
            pytest.skip("reportlab not available")

        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=LETTER)
        lines = [
            "Introduction to Distributed Systems for Testing.",
            "A distributed system is a collection of independent computers.",
            "Key properties include scalability, transparency, and fault tolerance.",
            "CAP theorem covers consistency, availability, partition tolerance.",
        ] * 6
        y = 750
        for ln in lines:
            c.drawString(50, y, ln)
            y -= 14
            if y < 50:
                c.showPage(); y = 750
        c.save()
        pdf_bytes = buf.getvalue()

        files = {"file": ("test_pending_lesson.pdf", pdf_bytes, "application/pdf")}
        r = requests.post(f"{API}/upload", files=files, timeout=30)
        assert r.status_code == 200
        doc_id = r.json()["id"]
        try:
            r2 = requests.get(f"{API}/documents/{doc_id}/lesson", timeout=10)
            if r2.status_code == 200:
                pytest.skip("Doc finished processing before we could hit lesson")
            assert r2.status_code == 400
            detail = r2.json().get("detail", "").lower()
            assert "process" in detail or "wait" in detail
        finally:
            try:
                requests.delete(f"{API}/documents/{doc_id}", timeout=10)
            except Exception:
                pass


# ============ TTS ============
class TestTTS:
    def test_tts_returns_valid_base64_mp3(self, client):
        text = "Hello students, welcome to today's lecture on distributed systems."
        r = client.post(f"{API}/tts", json={"text": text}, timeout=60)
        assert r.status_code == 200, f"tts failed: {r.status_code} {r.text[:400]}"
        data = r.json()
        assert data.get("mime") == "audio/mp3"
        b64 = data.get("audio_base64")
        assert isinstance(b64, str) and len(b64) > 0
        # decode & verify non-trivial size
        audio = base64.b64decode(b64)
        assert len(audio) > 10_000, f"audio too small ({len(audio)} bytes) - expected >10KB"
        # MP3 files typically start with ID3 tag or 0xFF 0xFB/0xF3 sync
        assert audio[:3] == b"ID3" or (audio[0] == 0xFF and (audio[1] & 0xE0) == 0xE0), \
            f"first bytes not a recognizable mp3 header: {audio[:4].hex()}"

    def test_tts_empty_text_400(self, client):
        r = client.post(f"{API}/tts", json={"text": ""})
        assert r.status_code == 400

    def test_tts_whitespace_only_400(self, client):
        r = client.post(f"{API}/tts", json={"text": "   \n\t  "})
        assert r.status_code == 400


# ============ STT ============
class TestSTT:
    @pytest.fixture(scope="class")
    def tts_audio_bytes(self):
        """Generate real audio via TTS to feed into STT."""
        r = requests.post(f"{API}/tts", json={"text": "The CAP theorem is a fundamental concept in distributed systems."}, timeout=60)
        assert r.status_code == 200
        return base64.b64decode(r.json()["audio_base64"])

    def test_stt_transcribes_mp3(self, client, tts_audio_bytes):
        files = {"file": ("voice.mp3", tts_audio_bytes, "audio/mpeg")}
        r = requests.post(f"{API}/stt", files=files, timeout=60)
        assert r.status_code == 200, f"stt failed: {r.status_code} {r.text[:400]}"
        data = r.json()
        assert "text" in data and isinstance(data["text"], str)
        low = data["text"].lower()
        # Expect at least some of the source words to come through
        assert any(w in low for w in ["cap", "theorem", "distributed", "system", "fundamental", "concept"]), \
            f"transcription doesn't match input: {data['text']!r}"

    def test_stt_invalid_audio_returns_error(self, client):
        # Random bytes that are not valid audio should cause the provider to fail
        files = {"file": ("bad.webm", b"not-real-audio-bytes-just-garbage", "audio/webm")}
        r = requests.post(f"{API}/stt", files=files, timeout=30)
        assert r.status_code in (400, 500), f"expected 400/500 for garbage audio, got {r.status_code}"


# ============ VOICE ASK ============
class TestVoiceAsk:
    def test_voice_ask_happy_path(self, client):
        r = client.post(
            f"{API}/documents/{SEED_DOC_ID}/voice-ask",
            json={"text": "What is scalability?"},
            timeout=120,
        )
        assert r.status_code == 200, f"voice-ask failed: {r.status_code} {r.text[:400]}"
        d = r.json()
        assert d.get("question") == "What is scalability?"
        answer = d.get("answer", "")
        assert isinstance(answer, str) and len(answer) > 30, f"answer too short: {answer!r}"
        # Enforce spoken-prose: no markdown headings, no bullets, <120 words
        assert "#" not in answer, "markdown heading found"
        assert not answer.lstrip().startswith(("-", "*", "•")), "starts with bullet"
        word_count = len(answer.split())
        assert word_count <= 140, f"answer too long ({word_count} words > 120 target)"
        # grounded
        low = answer.lower()
        assert any(k in low for k in ["scal", "system", "load", "distributed", "horizontal", "vertical"]), \
            f"answer not grounded: {answer[:200]!r}"
        # audio present
        b64 = d.get("audio_base64")
        assert b64 and isinstance(b64, str)
        audio = base64.b64decode(b64)
        assert len(audio) > 5_000, f"tts audio too small ({len(audio)} bytes)"

    def test_voice_ask_empty_text_400(self, client):
        r = client.post(f"{API}/documents/{SEED_DOC_ID}/voice-ask", json={"text": ""})
        assert r.status_code == 400

    def test_voice_ask_unknown_doc_404(self, client):
        r = client.post(f"{API}/documents/{uuid.uuid4()}/voice-ask", json={"text": "hello"})
        assert r.status_code == 404


# ============ LESSON REGENERATE ============
class TestLessonRegenerate:
    def test_regenerate_wipes_and_rebuilds(self, client):
        # Ensure lesson exists first
        r0 = client.get(f"{API}/documents/{SEED_DOC_ID}/lesson", timeout=120)
        assert r0.status_code == 200
        original = r0.json()

        r = client.post(f"{API}/documents/{SEED_DOC_ID}/lesson/regenerate", timeout=180)
        assert r.status_code == 200, f"regen failed: {r.status_code} {r.text[:400]}"
        new = r.json()
        assert "slides" in new and 6 <= len(new["slides"]) <= 10
        assert "homework" in new and len(new["homework"]) >= 3

        # After regen, a plain GET should return the new (cached) lesson
        r2 = client.get(f"{API}/documents/{SEED_DOC_ID}/lesson", timeout=30)
        assert r2.status_code == 200
        cached = r2.json()
        assert cached["title"] == new["title"]
        assert cached["slides"][0]["narration"] == new["slides"][0]["narration"]

    def test_regenerate_unknown_doc_404(self, client):
        r = client.post(f"{API}/documents/{uuid.uuid4()}/lesson/regenerate")
        assert r.status_code == 404
