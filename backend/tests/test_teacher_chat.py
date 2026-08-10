"""Backend tests for StudyPilot AI - AI Teacher chat feature + regression on core doc APIs."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/') if 'REACT_APP_BACKEND_URL' in os.environ else "https://study-pilot-ai.preview.emergentagent.com"
API = f"{BASE_URL}/api"

# A ready seed document (test_notes.pdf - distributed systems / CAP theorem)
SEED_DOC_ID = "a4296812-7976-4db7-ae70-e7fdefe5990a"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module", autouse=True)
def _pre_clear_chat(client):
    # Ensure the seed doc starts with an empty chat history for the tests below
    r = client.delete(f"{API}/documents/{SEED_DOC_ID}/chat")
    assert r.status_code in (200, 204), f"pre-clear failed: {r.status_code} {r.text}"
    yield
    # Post cleanup: clear chat history again
    try:
        client.delete(f"{API}/documents/{SEED_DOC_ID}/chat")
    except Exception:
        pass


# ============ Health / regression ============
class TestHealthAndDocs:
    def test_root(self, client):
        r = client.get(f"{API}/")
        assert r.status_code == 200
        data = r.json()
        assert data.get("service") == "StudyPilot AI"
        assert data.get("status") == "ok"

    def test_list_documents(self, client):
        r = client.get(f"{API}/documents")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        # Seed doc should be in the list
        ids = [d.get("id") for d in data]
        assert SEED_DOC_ID in ids, f"seed doc missing from library. Found ids: {ids[:5]}..."

    def test_get_seed_doc_ready(self, client):
        r = client.get(f"{API}/documents/{SEED_DOC_ID}")
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "ready"
        assert isinstance(d.get("quiz"), list) and len(d["quiz"]) > 0
        assert isinstance(d.get("flashcards"), list) and len(d["flashcards"]) > 0

    def test_get_unknown_doc_404(self, client):
        r = client.get(f"{API}/documents/{uuid.uuid4()}")
        assert r.status_code == 404


# ============ Chat GET / DELETE / validation ============
class TestChatBasics:
    def test_get_chat_initial_empty(self, client):
        r = client.get(f"{API}/documents/{SEED_DOC_ID}/chat")
        assert r.status_code == 200
        data = r.json()
        assert "messages" in data
        assert data["messages"] == []

    def test_post_chat_empty_message_returns_400(self, client):
        r = client.post(f"{API}/documents/{SEED_DOC_ID}/chat", json={"message": "   "})
        assert r.status_code == 400
        assert "empty" in r.text.lower()

    def test_post_chat_unknown_doc_returns_404(self, client):
        r = client.post(f"{API}/documents/{uuid.uuid4()}/chat", json={"message": "Hi"})
        assert r.status_code == 404

    def test_get_chat_unknown_doc_returns_404(self, client):
        r = client.get(f"{API}/documents/{uuid.uuid4()}/chat")
        assert r.status_code == 404

    def test_delete_chat_unknown_doc_returns_404(self, client):
        r = client.delete(f"{API}/documents/{uuid.uuid4()}/chat")
        assert r.status_code == 404


# ============ Chat happy path + memory + clear ============
class TestChatFlow:
    def test_chat_happy_path_and_memory(self, client):
        # First turn - Teach me CAP theorem
        r1 = client.post(
            f"{API}/documents/{SEED_DOC_ID}/chat",
            json={"message": "Teach me the CAP theorem."},
            timeout=60,
        )
        assert r1.status_code == 200, f"first chat call failed: {r1.status_code} {r1.text[:400]}"
        d1 = r1.json()
        assert "reply" in d1 and "messages" in d1
        assert isinstance(d1["reply"], str) and len(d1["reply"]) > 100, f"reply too short: {d1.get('reply')[:100]!r}"
        # Reply should be grounded - reference CAP-like terminology
        low = d1["reply"].lower()
        assert any(k in low for k in ["consistency", "availability", "partition", "cap"]), \
            f"reply not grounded in CAP: {d1['reply'][:200]!r}"

        # Messages array must contain the last two turns as user + teacher
        msgs = d1["messages"]
        assert len(msgs) >= 2
        assert msgs[-2]["role"] == "user"
        assert msgs[-1]["role"] == "teacher"
        assert msgs[-2]["content"].startswith("Teach me the CAP theorem")
        assert msgs[-1]["content"] == d1["reply"]
        # each turn has ts
        for t in msgs[-2:]:
            assert "ts" in t and isinstance(t["ts"], str) and len(t["ts"]) > 5

        # GET verifies persistence
        rg = client.get(f"{API}/documents/{SEED_DOC_ID}/chat")
        assert rg.status_code == 200
        assert len(rg.json()["messages"]) == len(msgs)

        # Second turn - memory: "Give me an example" should reference CAP concepts
        r2 = client.post(
            f"{API}/documents/{SEED_DOC_ID}/chat",
            json={"message": "Give me a concrete example."},
            timeout=60,
        )
        assert r2.status_code == 200, f"second chat call failed: {r2.status_code} {r2.text[:400]}"
        d2 = r2.json()
        assert isinstance(d2["reply"], str) and len(d2["reply"]) > 50
        low2 = d2["reply"].lower()
        # Continuity: should still be about CAP topic (not a fresh generic answer)
        assert any(k in low2 for k in ["cap", "consistency", "availability", "partition", "network"]), \
            f"second reply doesn't build on CAP context: {d2['reply'][:200]!r}"
        # messages length should grow by 2
        assert len(d2["messages"]) == len(msgs) + 2

    def test_delete_chat_clears_history(self, client):
        # There must be turns from previous test
        rg = client.get(f"{API}/documents/{SEED_DOC_ID}/chat")
        assert rg.status_code == 200
        before = len(rg.json()["messages"])
        assert before >= 2, "expected chat_history from previous test"

        rd = client.delete(f"{API}/documents/{SEED_DOC_ID}/chat")
        assert rd.status_code == 200
        assert rd.json().get("ok") is True

        rg2 = client.get(f"{API}/documents/{SEED_DOC_ID}/chat")
        assert rg2.status_code == 200
        assert rg2.json()["messages"] == []


# ============ Chat on still-processing doc returns 400 ============
class TestChatOnProcessing:
    def test_chat_on_pending_doc_400(self, client):
        """Create a pending doc by inserting a minimal record via regenerate flow.

        We use a lightweight approach: upload a small PDF then immediately hit chat.
        If reportlab is available we generate a tiny PDF; else we skip.
        """
        try:
            from reportlab.pdfgen import canvas
            from reportlab.lib.pagesizes import LETTER
            import io as _io
        except Exception:
            pytest.skip("reportlab not available to build test PDF")

        buf = _io.BytesIO()
        c = canvas.Canvas(buf, pagesize=LETTER)
        # Enough text to pass 100-char threshold
        lines = [
            "Introduction to Distributed Systems for Testing.",
            "A distributed system is a collection of independent computers that appear to the users",
            "as a single coherent system. Key properties include scalability, transparency, openness,",
            "and fault tolerance. Consistency, availability, and partition tolerance form the CAP theorem.",
            "Communication uses message passing, RPC, or shared memory abstractions.",
        ] * 5
        y = 750
        for ln in lines:
            c.drawString(50, y, ln)
            y -= 14
            if y < 50:
                c.showPage()
                y = 750
        c.save()
        pdf_bytes = buf.getvalue()

        # Upload (multipart)
        files = {"file": ("test_processing.pdf", pdf_bytes, "application/pdf")}
        r = requests.post(f"{API}/upload", files=files, timeout=30)
        assert r.status_code == 200, f"upload failed: {r.status_code} {r.text}"
        doc_id = r.json()["id"]

        try:
            # Immediately try chat - should be 400 because status is pending/processing
            r2 = requests.post(
                f"{API}/documents/{doc_id}/chat",
                json={"message": "Teach me something."},
                timeout=15,
            )
            # Race: if the LLM finished super fast (unlikely, takes ~30s), skip
            if r2.status_code == 200:
                pytest.skip("Doc finished processing before we could hit chat")
            assert r2.status_code == 400
            detail = r2.json().get("detail", "")
            assert "process" in detail.lower() or "wait" in detail.lower(), f"unexpected detail: {detail!r}"
        finally:
            # Cleanup: delete this test doc
            try:
                requests.delete(f"{API}/documents/{doc_id}", timeout=10)
            except Exception:
                pass
