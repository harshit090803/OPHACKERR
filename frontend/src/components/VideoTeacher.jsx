import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Pause, SkipBack, SkipForward, Loader2, Mic, MicOff,
  RefreshCw, BookOpen, Check, X, GraduationCap, Volume2, ClipboardList,
} from "lucide-react";
import { toast } from "sonner";
import TeacherAvatar from "./TeacherAvatar";
import { getLesson, regenerateLesson, tts, voiceAsk } from "../lib/apiClient";

const lessonCache = new Map();
const audioCache = new Map();
const DIFF_BG = { Easy: "#A7F3D0", Medium: "#FDE047", Hard: "#FBCFE8" };

export default function VideoTeacher({ docId }) {
  const [lesson, setLesson] = useState(() => lessonCache.get(docId) || null);
  const [loading, setLoading] = useState(() => !lessonCache.has(docId));
  const [slideIdx, setSlideIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(0);
  const [boardProgress, setBoardProgress] = useState(0);
  const [visibleBullets, setVisibleBullets] = useState(0);
  const [showQuiz, setShowQuiz] = useState(false);
  const [quizPick, setQuizPick] = useState(null);
  const [quizRevealed, setQuizRevealed] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [showHomework, setShowHomework] = useState(false);
  const audioRef = useRef(null);
  const mouthTimerRef = useRef(null);
  const boardTimerRef = useRef(null);

  const stopAll = useCallback(() => {
    if (mouthTimerRef.current) clearInterval(mouthTimerRef.current);
    if (boardTimerRef.current) cancelAnimationFrame(boardTimerRef.current);
    mouthTimerRef.current = null;
    boardTimerRef.current = null;
    audioRef.current?.pause();
    setPlaying(false);
    setMouthOpen(0);
  }, []);

  useEffect(() => {
    if (lessonCache.has(docId)) {
      setLesson(lessonCache.get(docId));
      setLoading(false);
      return () => stopAll();
    }
    let cancelled = false;
    (async () => {
      try {
        const d = await getLesson(docId);
        if (!cancelled) {
          lessonCache.set(docId, d);
          setLesson(d);
        }
      } catch (e) {
        if (!cancelled) toast.error(e?.response?.data?.detail || "Could not load the lesson");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; stopAll(); };
  }, [docId, stopAll]);

  const loadAudio = useCallback(async (idx, setCurrent = false) => {
    if (!lesson?.slides?.[idx]) return null;
    const key = `${docId}:${idx}`;
    if (audioCache.has(key)) {
      const url = audioCache.get(key);
      if (setCurrent && audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.load();
        setAudioReady(true);
      }
      return url;
    }
    try {
      setAudioLoading(true);
      const res = await tts(lesson.slides[idx].narration);
      if (!res?.audio_base64) throw new Error("No audio returned");
      const url = `data:${res.mime || "audio/mpeg"};base64,${res.audio_base64}`;
      audioCache.set(key, url);
      if (setCurrent && audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.load();
        setAudioReady(true);
      }
      return url;
    } catch (e) {
      if (setCurrent) {
        setAudioReady(false);
        toast.error(e?.response?.data?.detail || "Voice narration failed");
      }
      return null;
    } finally { setAudioLoading(false); }
  }, [docId, lesson]);

  useEffect(() => {
    if (!lesson?.slides?.length) return;
    stopAll();
    setAudioReady(false);
    setBoardProgress(0);
    setVisibleBullets(0);
    setShowQuiz(false);
    setQuizPick(null);
    setQuizRevealed(false);
    loadAudio(slideIdx, true);
    if (slideIdx + 1 < lesson.slides.length) loadAudio(slideIdx + 1, false);
  }, [lesson, slideIdx, loadAudio, stopAll]);

  const startAnimations = useCallback(() => {
    if (mouthTimerRef.current) clearInterval(mouthTimerRef.current);
    mouthTimerRef.current = setInterval(() => setMouthOpen(Math.random() * 0.65 + 0.2), 90);
    const tick = () => {
      const a = audioRef.current;
      const slide = lesson?.slides?.[slideIdx];
      if (!a || a.paused || !a.duration || !Number.isFinite(a.duration)) return;
      const p = Math.min(1, a.currentTime / a.duration);
      setBoardProgress(p);
      const n = Math.max(1, slide?.bullets?.length || 1);
      setVisibleBullets(p < 0.12 ? 0 : Math.min(n, Math.floor(((p - 0.12) / 0.88) * n) + 1));
      boardTimerRef.current = requestAnimationFrame(tick);
    };
    boardTimerRef.current = requestAnimationFrame(tick);
  }, [lesson, slideIdx]);

  const play = async () => {
    const audio = audioRef.current;
    if (!audio?.src || !audioReady) return toast.info("Teacher audio is still loading. Please wait a moment.");
    try { await audio.play(); setPlaying(true); startAnimations(); }
    catch { toast.error("Teacher audio could not be played. Click Play again."); }
  };
  const onEnded = () => {
    stopAll();
    setBoardProgress(1);
    setVisibleBullets(lesson?.slides?.[slideIdx]?.bullets?.length || 0);
    if (lesson?.slides?.[slideIdx]?.pop_quiz) setShowQuiz(true);
  };
  const goto = (delta) => {
    const next = slideIdx + delta;
    if (lesson && next >= 0 && next < lesson.slides.length) setSlideIdx(next);
  };
  const onRegen = async () => {
    setLoading(true); stopAll();
    try {
      for (const key of audioCache.keys()) if (key.startsWith(`${docId}:`)) audioCache.delete(key);
      const d = await regenerateLesson(docId);
      lessonCache.set(docId, d); setLesson(d); setSlideIdx(0);
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not regenerate lesson"); }
    finally { setLoading(false); }
  };

  if (loading) return <div className="brutal-border brutal-shadow rounded-2xl p-16 text-center" style={{ background: "#FDE047" }}><Loader2 className="w-10 h-10 animate-spin mx-auto" /><div className="font-display font-black text-2xl mt-4">Preparing today&apos;s class…</div><div className="mt-2">Professor is drafting the lesson plan and slides.</div></div>;
  if (!lesson?.slides?.length) return null;
  const slide = lesson.slides[slideIdx];
  const isLast = slideIdx === lesson.slides.length - 1;

  return <div className="max-w-5xl mx-auto" data-testid="video-teacher">
    <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3 min-w-0"><div className="w-10 h-10 brutal-border rounded-xl flex items-center justify-center" style={{ background: "#DDD6FE" }}><BookOpen className="w-5 h-5" /></div><div><div className="font-display font-bold text-xs uppercase tracking-widest" style={{ color: "var(--sp-muted-fg)" }}>Video class</div><div className="font-display text-xl font-black truncate">{lesson.title}</div></div></div>
      <div className="flex items-center gap-2"><button onClick={() => setShowHomework(true)} className="brutal-btn brutal-border brutal-shadow-sm rounded-full px-4 py-2 font-display font-bold text-sm inline-flex items-center gap-2" style={{ background: "#FED7AA" }}><ClipboardList className="w-4 h-4" /> Homework</button><button onClick={onRegen} className="brutal-btn brutal-border rounded-full w-10 h-10 flex items-center justify-center" style={{ background: "#FBCFE8" }}><RefreshCw className="w-4 h-4" /></button></div>
    </div>

    <div className="brutal-border brutal-shadow rounded-2xl overflow-hidden" style={{ background: "var(--sp-card)" }}>
      <div className="grid md:grid-cols-5 gap-0">
        <div className="md:col-span-2 relative flex flex-col items-center justify-end p-6 border-b-2 md:border-b-0 md:border-r-2" style={{ background: "linear-gradient(180deg,#BAE6FD 0%,#DDD6FE 100%)", borderColor: "var(--sp-border)", minHeight: 380 }}><div className="w-56 max-w-full aspect-[220/260]"><TeacherAvatar mouthOpen={mouthOpen} speaking={playing} /></div><div className="mt-4 flex items-center gap-2"><div className="brutal-border rounded-full px-3 py-1 text-xs font-display font-bold inline-flex items-center gap-1.5" style={{ background: "#FFFFFF" }}><Volume2 className="w-3.5 h-3.5" /> Prof. StudyPilot</div>{audioLoading && <Loader2 className="w-4 h-4 animate-spin" />}</div></div>
        <div className="md:col-span-3 p-6 md:p-8 flex flex-col relative overflow-hidden" style={{ background: "#0F2A22", color: "#FDE68A", minHeight: 380 }}><div className="text-xs font-display font-bold uppercase tracking-widest" style={{ color: "#A7F3D0" }}>Slide {slideIdx + 1} of {lesson.slides.length}{!playing && visibleBullets === 0 && <span className="ml-2 normal-case tracking-normal opacity-70">— press Play to start</span>}</div><motion.div key={`title-${slideIdx}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 font-display font-black text-2xl md:text-3xl tracking-tight" style={{ color: "#FEF3C7", borderBottom: "1px solid rgba(253,224,71,0.25)", paddingBottom: 6 }}>{slide.title}</motion.div><ul className="mt-6 space-y-4 flex-1">{slide.bullets.map((b, i) => { const shown = i < visibleBullets || boardProgress >= 0.98; return <motion.li key={`${slideIdx}-${i}`} initial={{ opacity: 0, x: -16 }} animate={shown ? { opacity: 1, x: 0 } : { opacity: 0, x: -16 }} className="flex items-start gap-3 text-lg" style={{ visibility: shown ? "visible" : "hidden" }}><span className="mt-2 w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: "#FDE047" }} /><span style={{ color: "#F5F5F4" }}>{b}</span></motion.li>; })}</ul></div>
      </div>
      <div className="border-t-2 flex items-center justify-between px-4 py-3 gap-2 flex-wrap" style={{ borderColor: "var(--sp-border)", background: "var(--sp-card)" }}><div className="flex items-center gap-2"><button onClick={() => goto(-1)} disabled={slideIdx === 0} className="brutal-btn brutal-border rounded-full w-11 h-11 flex items-center justify-center disabled:opacity-40"><SkipBack className="w-4 h-4" /></button>{playing ? <button onClick={stopAll} className="brutal-btn brutal-border brutal-shadow-sm rounded-full h-11 px-5 font-display font-bold inline-flex items-center gap-2" style={{ background: "#FBCFE8" }}><Pause className="w-4 h-4" /> Pause</button> : <button onClick={play} disabled={audioLoading || !audioReady} className="brutal-btn brutal-border brutal-shadow-sm rounded-full h-11 px-5 font-display font-bold inline-flex items-center gap-2 disabled:opacity-40" style={{ background: "#A7F3D0" }}>{audioLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Play</button>}<button onClick={() => goto(1)} disabled={isLast} className="brutal-btn brutal-border rounded-full w-11 h-11 flex items-center justify-center disabled:opacity-40"><SkipForward className="w-4 h-4" /></button></div><button onClick={() => { stopAll(); setAskOpen(true); }} className="brutal-btn brutal-border brutal-shadow-sm rounded-full h-11 px-5 font-display font-bold inline-flex items-center gap-2" style={{ background: "#FDE047" }}><GraduationCap className="w-4 h-4" /> Raise your hand</button></div>
    </div>
    <div className="mt-4 flex items-center justify-center gap-2">{lesson.slides.map((_, i) => <button key={i} onClick={() => setSlideIdx(i)} className="h-2 rounded-full brutal-border" style={{ width: i === slideIdx ? 28 : 12, background: i === slideIdx ? "#FDE047" : "var(--sp-card)" }} />)}</div>
    <audio ref={audioRef} onEnded={onEnded} preload="auto" />
    <AnimatePresence>{showQuiz && slide?.pop_quiz && <PopQuizModal quiz={slide.pop_quiz} pick={quizPick} revealed={quizRevealed} onPick={setQuizPick} onReveal={() => setQuizRevealed(true)} onDismiss={() => { setShowQuiz(false); if (!isLast) goto(1); else setShowHomework(true); }} />}</AnimatePresence>
    <AnimatePresence>{askOpen && <AskProfessorModal docId={docId} onClose={() => setAskOpen(false)} />}</AnimatePresence>
    <AnimatePresence>{showHomework && lesson.homework?.length > 0 && <HomeworkModal items={lesson.homework} onClose={() => setShowHomework(false)} />}</AnimatePresence>
  </div>;
}

function PopQuizModal({ quiz, pick, revealed, onPick, onReveal, onDismiss }) {
  return <ModalShell testid="pop-quiz-modal"><div className="flex items-center gap-2 mb-4"><div className="brutal-border rounded-full px-3 py-1 text-xs font-display font-bold" style={{ background: "#FDE047" }}>Pop quiz</div><div className="brutal-border rounded-full px-3 py-1 text-xs font-display font-bold" style={{ background: DIFF_BG[quiz.difficulty] || "#DDD6FE" }}>{quiz.difficulty}</div></div><div className="font-display font-black text-xl md:text-2xl leading-snug">{quiz.question}</div><div className="mt-5 grid gap-2.5">{quiz.options.map((opt, i) => { const isPick = pick === opt; const isCorrect = opt === quiz.correct_answer; let bg = "var(--sp-card)"; if (revealed) bg = isCorrect ? "#A7F3D0" : isPick ? "#FBCFE8" : bg; else if (isPick) bg = "#DDD6FE"; return <button key={i} onClick={() => !revealed && onPick(opt)} disabled={revealed} className="brutal-border rounded-xl text-left p-3 flex items-center gap-3" style={{ background: bg }}><div className="w-7 h-7 brutal-border rounded-md flex items-center justify-center font-display font-black" style={{ background: "#FDE047" }}>{String.fromCharCode(65 + i)}</div><div className="text-sm">{opt}</div>{revealed && isCorrect && <Check className="w-5 h-5 ml-auto" />}{revealed && isPick && !isCorrect && <X className="w-5 h-5 ml-auto" />}</button>; })}</div>{revealed && <div className="mt-4 brutal-border rounded-xl p-3 text-sm" style={{ background: "#F4F4F5" }}><div className="font-display font-bold">Why</div><div className="mt-1">{quiz.explanation}</div></div>}<div className="mt-5 flex justify-end">{!revealed ? <button onClick={onReveal} disabled={!pick} className="brutal-btn brutal-border brutal-shadow-sm rounded-full px-5 py-2 font-display font-bold disabled:opacity-40" style={{ background: "#A7F3D0" }}>Check</button> : <button onClick={onDismiss} className="brutal-btn brutal-border brutal-shadow-sm rounded-full px-5 py-2 font-display font-bold" style={{ background: "#DDD6FE" }}>Continue class</button>}</div></ModalShell>;
}

function AskProfessorModal({ docId, onClose }) {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [question, setQuestion] = useState("");
  const [interim, setInterim] = useState("");
  const [answer, setAnswer] = useState("");
  const [audioUrl, setAudioUrl] = useState(null);
  const [micReady, setMicReady] = useState(false);
  const recognitionRef = useRef(null);
  const answerAudioRef = useRef(null);
  const micStreamRef = useRef(null);

  useEffect(() => () => {
    try { recognitionRef.current?.abort(); } catch {}
    micStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    answerAudioRef.current?.pause();
  }, []);

  useEffect(() => {
    if (!audioUrl || !answerAudioRef.current) return;
    answerAudioRef.current.src = audioUrl;
    answerAudioRef.current.play().catch(() => toast.info("Professor replied. Press Play to hear the answer."));
  }, [audioUrl]);

  const startRec = async () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Voice-to-text is unavailable in this browser. Please use the latest Chrome or Edge.");
      return;
    }
    if (!window.isSecureContext && !window.location.hostname.includes("localhost")) {
      toast.error("Microphone requires HTTPS or localhost.");
      return;
    }

    try {
      // Explicitly request microphone permission first. This fixes the common
      // Chrome case where SpeechRecognition silently fails before permission is granted.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      setMicReady(true);

      const recognition = new SpeechRecognition();
      recognition.lang = "en-IN";
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;

      let finalText = "";
      recognition.onstart = () => { setRecording(true); setInterim(""); };
      recognition.onaudiostart = () => setRecording(true);
      recognition.onresult = (event) => {
        let live = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const text = event.results[i][0]?.transcript || "";
          if (event.results[i].isFinal) finalText += `${text} `;
          else live += text;
        }
        setInterim(live.trim());
        if (finalText.trim()) setQuestion(finalText.trim());
      };
      recognition.onerror = (event) => {
        setRecording(false);
        setInterim("");
        const messages = {
          "not-allowed": "Microphone permission was denied. Click the lock icon near localhost:3000 and allow Microphone.",
          "service-not-allowed": "Chrome blocked its speech service. Check Chrome microphone/speech permissions and try again.",
          network: "Chrome speech service could not be reached. Check your internet connection and try again.",
          "no-speech": "No speech detected. Please speak clearly and try again.",
        };
        if (event.error !== "aborted") toast.error(messages[event.error] || `Voice input failed: ${event.error}`);
      };
      recognition.onend = async () => {
        setRecording(false);
        setInterim("");
        micStreamRef.current?.getTracks?.().forEach((track) => track.stop());
        micStreamRef.current = null;
        setMicReady(false);
        const text = finalText.trim();
        if (!text || processing) return;
        setQuestion(text);
        setProcessing(true);
        try {
          const result = await voiceAsk(docId, text);
          setAnswer(result.answer || "");
          if (result.audio_base64) setAudioUrl(`data:${result.mime || "audio/mpeg"};base64,${result.audio_base64}`);
        } catch (e) {
          toast.error(e?.response?.data?.detail || "Professor could not answer the voice question");
        } finally { setProcessing(false); }
      };
      recognitionRef.current = recognition;
      finalText = "";
      setQuestion("");
      setAnswer("");
      setAudioUrl(null);
      recognition.start();
    } catch (e) {
      micStreamRef.current?.getTracks?.().forEach((track) => track.stop());
      micStreamRef.current = null;
      setMicReady(false);
      if (e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError") toast.error("Please allow microphone access for localhost:3000, then click the mic again.");
      else toast.error("Could not access the microphone. Check that your laptop microphone is connected and enabled.");
    }
  };

  const stopRec = () => {
    try { recognitionRef.current?.stop(); } catch {}
    setRecording(false);
  };

  return <ModalShell testid="ask-modal" onClose={onClose}>
    <div className="flex items-center gap-3 mb-2"><div className="w-10 h-10 brutal-border rounded-xl flex items-center justify-center" style={{ background: "#FDE047" }}><GraduationCap className="w-5 h-5" /></div><div><div className="font-display font-black text-lg">Ask the professor</div><div className="text-xs" style={{ color: "var(--sp-muted-fg)" }}>Speak your doubt. Your words will appear as text and the professor will answer aloud.</div></div></div>
    <div className="mt-5 flex flex-col items-center"><button onClick={recording ? stopRec : startRec} disabled={processing} className="brutal-btn brutal-border brutal-shadow rounded-full w-24 h-24 flex items-center justify-center disabled:opacity-40" style={{ background: recording ? "#FBCFE8" : "#A7F3D0" }} aria-label={recording ? "Stop recording" : "Start voice question"}>{processing ? <Loader2 className="w-8 h-8 animate-spin" /> : recording ? <MicOff className="w-8 h-8" /> : <Mic className="w-8 h-8" />}</button><div className="mt-3 text-sm font-display font-bold">{processing ? "Professor is thinking…" : recording ? "Listening… speak your doubt" : "Tap the mic to speak"}</div>{micReady && recording && <div className="mt-1 text-xs" style={{ color: "var(--sp-muted-fg)" }}>Microphone connected</div>}</div>
    {(question || interim) && <div className="mt-6 brutal-border rounded-xl p-4" style={{ background: "#DDD6FE" }}><div className="text-xs font-display font-bold uppercase tracking-widest mb-1">You asked</div><div className="text-sm">{question}{interim && <span className="opacity-60"> {interim}</span>}</div></div>}
    {answer && <div className="mt-3 brutal-border rounded-xl p-4" style={{ background: "#FFFFFF" }}><div className="text-xs font-display font-bold uppercase tracking-widest mb-1">Professor</div><div className="text-sm leading-relaxed whitespace-pre-wrap">{answer}</div></div>}
    <audio ref={answerAudioRef} controls className="w-full mt-4" />
  </ModalShell>;
}

function HomeworkModal({ items, onClose }) {
  return <ModalShell testid="homework-modal" onClose={onClose}><div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 brutal-border rounded-xl flex items-center justify-center" style={{ background: "#FED7AA" }}><ClipboardList className="w-5 h-5" /></div><div><div className="font-display font-black text-xl">Homework</div><div className="text-xs" style={{ color: "var(--sp-muted-fg)" }}>Practice these to lock in today&apos;s lesson.</div></div></div><ol className="space-y-3">{items.map((h, i) => <li key={i} className="brutal-border rounded-xl p-4" style={{ background: "var(--sp-card)" }}><div className="font-display font-bold">Q{i + 1}. {h.question}</div>{h.guidance && <div className="text-sm mt-1" style={{ color: "var(--sp-muted-fg)" }}>Hint: {h.guidance}</div>}</li>)}</ol><div className="mt-5 flex justify-end"><button onClick={onClose} className="brutal-btn brutal-border brutal-shadow-sm rounded-full px-5 py-2 font-display font-bold" style={{ background: "#FDE047" }}>Class dismissed</button></div></ModalShell>;
}

function ModalShell({ children, onClose, testid }) {
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} data-testid={testid} onClick={onClose}><motion.div initial={{ scale: 0.95, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.95, y: 20, opacity: 0 }} transition={{ duration: 0.2 }} onClick={(e) => e.stopPropagation()} className="brutal-border brutal-shadow rounded-2xl p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto scrollbar-slim" style={{ background: "var(--sp-bg)" }}>{children}</motion.div></motion.div>;
}
