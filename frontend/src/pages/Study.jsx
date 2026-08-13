import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getDocument, regenerateDocument } from "../lib/apiClient";
import QuizPlayer from "../components/QuizPlayer";
import FlashcardPlayer from "../components/FlashcardPlayer";
import TeacherChat from "../components/TeacherChat";
import VideoTeacher from "../components/VideoTeacher";
import { Loader2, RefreshCw, AlertTriangle, ArrowLeft, BookOpen, LayoutGrid, GraduationCap, MessageCircle } from "lucide-react";
import { toast } from "sonner";

export default function Study() {
  const { id } = useParams();
  const [doc, setDoc] = useState(null);
  const [tab, setTab] = useState("teacher");
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await getDocument(id);
      setDoc(d);
      if (d.status !== "ready" && d.status !== "error") {
        pollRef.current = setTimeout(load, 2500);
      }
    } catch {
      toast.error("Could not load document");
    }
  }, [id]);

  useEffect(() => {
    load();
    return () => pollRef.current && clearTimeout(pollRef.current);
  }, [load]);

  const onRegenerate = async () => {
    try {
      await regenerateDocument(id);
      toast.success("Regenerating…");
      setDoc((d) => ({ ...d, status: "pending", quiz: [], flashcards: [], error: null }));
      load();
    } catch {
      toast.error("Could not regenerate");
    }
  };

  if (!doc) return <div className="max-w-3xl mx-auto p-16 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto" /></div>;

  const processing = doc.status === "pending" || doc.status === "processing";

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <Link to="/library" className="inline-flex items-center gap-2 font-display font-bold text-sm mb-6" data-testid="back-to-library"><ArrowLeft className="w-4 h-4" strokeWidth={2.4} /> Back to library</Link>
      <div className="brutal-border brutal-shadow rounded-2xl p-6 flex flex-col md:flex-row md:items-center gap-4 justify-between" style={{ background: "var(--sp-card) }}">
        <div className="min-w-0"><div className="font-display font-bold text-xs uppercase tracking-widest" style={{ color: "var(--sp-muted-fg)" }}>Study set</div><div className="font-display text-2xl sm:text-3xl font-black truncate" data-testid="doc-title">{doc.filename}</div>{doc.topics?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{doc.topics.slice(0, 8).map((t) => <span key={t} className="brutal-border rounded-full px-2.5 py-0.5 text-xs font-display font-bold" style={{ background: "#BAE6FD" }}>{t}</span>)}</div>}</div>
        <div className="flex items-center gap-2 flex-shrink-0"><button onClick={onRegenerate} className="brutal-btn brutal-border brutal-shadow-sm rounded-full px-4 py-2 font-display font-bold text-sm inline-flex items-center gap-2" style={{ background: "#FED7AA" }} data-testid="regenerate-btn"><RefreshCw className="w-4 h-4" strokeWidth={2.4} /> Regenerate</button></div>
      </div>
      {processing ? <><div className="mt-6 brutal-border rounded-2xl px-5 py-3 flex items-center gap-3" style={{ background: "#FDE047" }} data-testid="processing-state"><Loader2 className="w-5 h-5 animate-spin flex-shrink-0" /><div><div className="font-display font-black">Professor is preparing your study set…</div><div className="text-sm">The video lecture is generated in parallel and can appear before the quiz and flashcards finish.</div></div></div><div className="mt-6"><VideoTeacher docId={doc.id} /></div></> : doc.status === "error" ? <div className="mt-8 brutal-border rounded-2xl p-10 text-center" style={{ background: "#FBCFE8" }} data-testid="error-state"><AlertTriangle className="w-10 h-10 mx-auto" strokeWidth={2.4} /><div className="font-display font-black text-2xl mt-3">We hit a wall</div><div className="mt-2 max-w-lg mx-auto">{doc.error || "Something went wrong."}</div><button onClick={onRegenerate} className="mt-6 brutal-btn brutal-border brutal-shadow-sm rounded-full px-5 py-2 font-display font-bold" style={{ background: "#FDE047" }}>Try again</button></div> : <><div className="mt-8 flex gap-2 flex-wrap" data-testid="study-tabs"><TabBtn active={tab === "teacher"} onClick={() => setTab("teacher")} icon={<GraduationCap className="w-4 h-4" strokeWidth={2.4} />} label="Video Class" testid="tab-teacher" bg="#DDD6FE" /><TabBtn active={tab === "quiz"} onClick={() => setTab("quiz")} icon={<LayoutGrid className="w-4 h-4" strokeWidth={2.4} />} label={`Quiz (${doc.quiz.length})`} testid="tab-quiz" bg="#FDE047" /><TabBtn active={tab === "cards"} onClick={() => setTab("cards")} icon={<BookOpen className="w-4 h-4" strokeWidth={2.4} />} label={`Flashcards (${doc.flashcards.length})`} testid="tab-cards" bg="#A7F3D0" /><TabBtn active={tab === "chat"} onClick={() => setTab("chat")} icon={<MessageCircle className="w-4 h-4" strokeWidth={2.4} />} label="Q&A Chat" testid="tab-chat" bg="#FED7AA" /></div><div className="mt-6">{tab === "teacher" && <VideoTeacher docId={doc.id} />}{tab === "quiz" && <QuizPlayer quiz={doc.quiz} />}{tab === "cards" && <FlashcardPlayer cards={doc.flashcards} />}{tab === "chat" && <TeacherChat docId={doc.id} />}</div></>}
    </div>
  );
}

function TabBtn({ active, onClick, icon, label, testid, bg }) { return <button onClick={onClick} className={`brutal-btn brutal-border rounded-full px-5 py-2.5 font-display font-bold inline-flex items-center gap-2 ${active ? "brutal-shadow-sm" : ""}`} style={{ background: active ? bg : "transparent" }} data-testid={testid}>{icon} {label}</button>; }
