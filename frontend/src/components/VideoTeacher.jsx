import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Pause, SkipBack, SkipForward, Loader2, Mic, MicOff, RefreshCw,
  BookOpen, Check, X, GraduationCap, Volume2, ClipboardList,
} from "lucide-react";
import { toast } from "sonner";
import TeacherAvatar from "./TeacherAvatar";
import { getLesson, regenerateLesson, tts, stt, voiceAsk } from "../lib/apiClient";

// Module-scope cache so switching tabs doesn't re-fetch the lesson or re-generate audio
const lessonCache = new Map(); // docId -> lesson
const audioCacheGlobal = new Map(); // `${docId}:${slideIdx}` -> data URL

const DIFF_BG = { Easy: "#A7F3D0", Medium: "#FDE047", Hard: "#FBCFE8" };

export default function VideoTeacher({ docId }) {
  const [lesson, setLesson] = useState(() => lessonCache.get(docId) || null);
  const [loading, setLoading] = useState(() => !lessonCache.has(docId));
  const [slideIdx, setSlideIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(0);
  const [showQuiz, setShowQuiz] = useState(false);
  const [quizPick, setQuizPick] = useState(null);
  const [quizRevealed, setQuizRevealed] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [showHomework, setShowHomework] = useState(false);
  // Live blackboard: 0 = only title writing, then bullets reveal one-by-one as teacher speaks
  const [boardProgress, setBoardProgress] = useState(0); // 0..1 of audio played
  const [visibleBullets, setVisibleBullets] = useState(0);

  const audioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const boardRafRef = useRef(null);

  // Load lesson (cached across tab switches)
  useEffect(() => {
    if (lessonCache.has(docId)) {
      setLesson(lessonCache.get(docId));
      setLoading(false);
      return () => stopAll();
    }
    (async () => {
      try {
        const d = await getLesson(docId);
        lessonCache.set(docId, d);
        setLesson(d);
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Could not load the lesson");
      } finally {
        setLoading(false);
      }
    })();
    return () => stopAll();
  }, [docId]);

  const stopAll = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (boardRafRef.current) cancelAnimationFrame(boardRafRef.current);
    boardRafRef.current = null;
    setMouthOpen(0);
    setPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
    }
  }, []);

  // Sync blackboard writing with audio progress (teacher "writes" while speaking)
  const driveBoard = useCallback(() => {
    const tick = () => {
      const a = audioRef.current;
      if (!a || a.paused || !a.duration || !isFinite(a.duration)) {
        return;
      }
      const p = Math.min(1, a.currentTime / a.duration);
      setBoardProgress(p);
      // Title takes first ~12% of the slide; remaining progress spreads across bullets
      const bullets = lesson?.slides?.[slideIdx]?.bullets || [];
      const n = Math.max(1, bullets.length);
      if (p < 0.12) {
        setVisibleBullets(0);
      } else {
        const bulletProgress = (p - 0.12) / 0.88;
        setVisibleBullets(Math.min(n, Math.floor(bulletProgress * n) + 1));
      }
      boardRafRef.current = requestAnimationFrame(tick);
    };
    boardRafRef.current = requestAnimationFrame(tick);
  }, [lesson, slideIdx]);

  const ensureAnalyser = useCallback(() => {
    if (!audioRef.current) return;
    if (audioCtxRef.current) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      const src = ctx.createMediaElementSource(audioRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
    } catch (e) {
      // fallback: no analyser — mouth will animate on interval
      analyserRef.current = null;
    }
  }, []);

  const drive = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser || !audioRef.current) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!audioRef.current || audioRef.current.paused) {
        setMouthOpen(0);
        return;
      }
      analyser.getByteTimeDomainData(buf);
      // compute RMS
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      setMouthOpen(Math.min(1, rms * 3.5));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const fetchAudioFor = useCallback(async (idx) => {
    const cacheKey = `${docId}:${idx}`;
    if (audioCacheGlobal.has(cacheKey)) return audioCacheGlobal.get(cacheKey);
    if (!lesson) return null;
    const slide = lesson.slides[idx];
    if (!slide) return null;
    setAudioLoading(true);
    try {
      const res = await tts(slide.narration);
      const url = `data:${res.mime};base64,${res.audio_base64}`;
      audioCacheGlobal.set(cacheKey, url);
      return url;
    } catch (e) {
      toast.error("Voice narration failed");
      return null;
    } finally {
      setAudioLoading(false);
    }
  }, [lesson, docId]);

  // Auto-load audio when slide changes — reset live board
  useEffect(() => {
    if (!lesson) return;
    stopAll();
    setShowQuiz(false);
    setQuizPick(null);
    setQuizRevealed(false);
    setBoardProgress(0);
    setVisibleBullets(0);
    (async () => {
      const url = await fetchAudioFor(slideIdx);
      if (url && audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.load();
      }
    })();
    // Prefetch next
    if (slideIdx + 1 < lesson.slides.length) fetchAudioFor(slideIdx + 1);
  }, [slideIdx, lesson]);

  const play = async () => {
    if (!audioRef.current?.src) {
      const url = await fetchAudioFor(slideIdx);
      if (!url) return;
      audioRef.current.src = url;
    }
    ensureAnalyser();
    try {
      if (audioCtxRef.current?.state === "suspended") await audioCtxRef.current.resume();
      await audioRef.current.play();
      setPlaying(true);
      drive();
      driveBoard();
    } catch (e) {
      toast.error("Playback blocked. Click Play again.");
    }
  };

  const pause = () => {
    audioRef.current?.pause();
    setPlaying(false);
    setMouthOpen(0);
    if (boardRafRef.current) {
      cancelAnimationFrame(boardRafRef.current);
      boardRafRef.current = null;
    }
  };

  const onEnded = () => {
    setPlaying(false);
    setMouthOpen(0);
    // Reveal full board at end of narration
    setBoardProgress(1);
    setVisibleBullets(lesson?.slides?.[slideIdx]?.bullets?.length || 0);
    if (boardRafRef.current) {
      cancelAnimationFrame(boardRafRef.current);
      boardRafRef.current = null;
    }
    const slide = lesson?.slides?.[slideIdx];
    if (slide?.pop_quiz) {
      setShowQuiz(true);
    }
  };

  const goto = (delta) => {
    const next = slideIdx + delta;
    if (!lesson) return;
    if (next < 0 || next >= lesson.slides.length) return;
    setSlideIdx(next);
  };

  const onRegen = async () => {
    setLoading(true);
    try {
      audioCacheGlobal.forEach((_, k) => { if (k.startsWith(`${docId}:`)) audioCacheGlobal.delete(k); });
      const d = await regenerateLesson(docId);
      lessonCache.set(docId, d);
      setLesson(d);
      setSlideIdx(0);
    } catch {
      toast.error("Could not regenerate lesson");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="brutal-border brutal-shadow rounded-2xl p-16 text-center" style={{ background: "#FDE047" }}>
        <Loader2 className="w-10 h-10 animate-spin mx-auto" />
        <div className="font-display font-black text-2xl mt-4">Preparing today&apos;s class…</div>
        <div className="mt-2">Professor is drafting the lesson plan and slides.</div>
      </div>
    );
  }
  if (!lesson) return null;

  const slide = lesson.slides[slideIdx];
  const isLast = slideIdx === lesson.slides.length - 1;

  return (
    <div className="max-w-5xl mx-auto" data-testid="video-teacher">
      {/* Lesson header */}
      <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 brutal-border rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "#DDD6FE" }}>
            <BookOpen className="w-5 h-5" strokeWidth={2.4} />
          </div>
          <div className="min-w-0">
            <div className="font-display font-bold text-xs uppercase tracking-widest" style={{ color: "var(--sp-muted-fg)" }}>Video class</div>
            <div className="font-display text-xl font-black truncate" data-testid="lesson-title">{lesson.title}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowHomework(true)} className="brutal-btn brutal-border brutal-shadow-sm rounded-full px-4 py-2 font-display font-bold text-sm inline-flex items-center gap-2" style={{ background: "#FED7AA" }} data-testid="open-homework-btn">
            <ClipboardList className="w-4 h-4" strokeWidth={2.4} /> Homework
          </button>
          <button onClick={onRegen} className="brutal-btn brutal-border rounded-full w-10 h-10 flex items-center justify-center" title="Regenerate lesson" style={{ background: "#FBCFE8" }} data-testid="regen-lesson-btn">
            <RefreshCw className="w-4 h-4" strokeWidth={2.4} />
          </button>
        </div>
      </div>

      {/* Stage */}
      <div className="brutal-border brutal-shadow rounded-2xl overflow-hidden" style={{ background: "var(--sp-card)" }}>
        <div className="grid md:grid-cols-5 gap-0">
          {/* Teacher panel */}
          <div className="md:col-span-2 relative flex flex-col items-center justify-end p-6 border-b-2 md:border-b-0 md:border-r-2" style={{ background: "linear-gradient(180deg,#BAE6FD 0%,#DDD6FE 100%)", borderColor: "var(--sp-border)", minHeight: 380 }}>
            <div className="absolute inset-x-0 top-0 h-2/3 pointer-events-none">
              <div className="w-full h-full opacity-40" style={{
                backgroundImage: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.6), transparent 40%)",
              }} />
            </div>
            <div className="w-56 max-w-full aspect-[220/260]">
              <TeacherAvatar mouthOpen={mouthOpen} speaking={playing} />
            </div>
            <div className="mt-4 flex items-center gap-2">
              <div className="brutal-border rounded-full px-3 py-1 text-xs font-display font-bold inline-flex items-center gap-1.5" style={{ background: "#FFFFFF" }}>
                <Volume2 className="w-3.5 h-3.5" strokeWidth={2.4} /> Prof. StudyPilot
              </div>
              {audioLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            </div>
          </div>

          {/* Blackboard — live chalk writing as the teacher speaks */}
          <div
            className="md:col-span-3 p-6 md:p-8 flex flex-col relative overflow-hidden"
            style={{
              background: "#0F2A22",
              color: "#FDE68A",
              minHeight: 380,
              backgroundImage:
                "radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)",
              backgroundSize: "12px 12px",
            }}
            data-testid="blackboard"
          >
            <div className="mt-0 text-xs font-display font-bold uppercase tracking-widest" style={{ color: "#A7F3D0" }}>
              Slide {slideIdx + 1} of {lesson.slides.length}
              {!playing && visibleBullets === 0 && (
                <span className="ml-2 normal-case tracking-normal opacity-70">— press Play, board fills as he teaches</span>
              )}
            </div>

            {/* Title writes first */}
            <motion.div
              key={`title-${slideIdx}`}
              initial={{ opacity: 0, width: 0 }}
              animate={{
                opacity: boardProgress > 0.02 || visibleBullets > 0 || !playing ? 1 : 0,
                width: "100%",
              }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="font-display font-black text-2xl md:text-3xl tracking-tight overflow-hidden whitespace-nowrap"
              style={{ color: "#FEF3C7", textShadow: "0 1px 0 rgba(0,0,0,0.4)", borderBottom: "1px solid rgba(253,224,71,0.25)", paddingBottom: 6 }}
              data-testid="slide-title"
            >
              {slide.title}
            </motion.div>

            <ul className="mt-6 space-y-4 flex-1">
              {slide.bullets.map((b, i) => {
                const shown = i < visibleBullets || boardProgress >= 0.98;
                return (
                  <motion.li
                    key={`${slideIdx}-${i}`}
                    initial={{ opacity: 0, x: -16 }}
                    animate={
                      shown
                        ? { opacity: 1, x: 0 }
                        : { opacity: 0, x: -16 }
                    }
                    transition={{ duration: 0.45, ease: "easeOut" }}
                    className="flex items-start gap-3 text-lg"
                    data-testid={`bullet-${i}`}
                    style={{ visibility: shown ? "visible" : "hidden" }}
                  >
                    <span
                      className="mt-2 w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ background: "#FDE047", boxShadow: "0 0 6px rgba(253,224,71,0.5)" }}
                    />
                    <ChalkText text={b} active={shown && playing && i === visibleBullets - 1} done={shown} />
                  </motion.li>
                );
              })}
            </ul>

            {/* Subtle chalk dust / cursor when writing */}
            {playing && visibleBullets < (slide.bullets?.length || 0) && (
              <div
                className="absolute bottom-4 right-6 text-xs font-display font-bold opacity-50"
                style={{ color: "#A7F3D0" }}
              >
                writing…
              </div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="border-t-2 flex items-center justify-between px-4 py-3 gap-2 flex-wrap" style={{ borderColor: "var(--sp-border)", background: "var(--sp-card)" }}>
          <div className="flex items-center gap-2">
            <button onClick={() => goto(-1)} disabled={slideIdx === 0} className="brutal-btn brutal-border rounded-full w-11 h-11 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: "var(--sp-card)" }} data-testid="prev-slide-btn" aria-label="Previous slide">
              <SkipBack className="w-4 h-4" strokeWidth={2.4} />
            </button>
            {playing ? (
              <button onClick={pause} className="brutal-btn brutal-border brutal-shadow-sm rounded-full h-11 px-5 font-display font-bold inline-flex items-center gap-2" style={{ background: "#FBCFE8" }} data-testid="pause-btn">
                <Pause className="w-4 h-4" strokeWidth={2.4} /> Pause
              </button>
            ) : (
              <button onClick={play} disabled={audioLoading} className="brutal-btn brutal-border brutal-shadow-sm rounded-full h-11 px-5 font-display font-bold inline-flex items-center gap-2 disabled:opacity-40" style={{ background: "#A7F3D0" }} data-testid="play-btn">
                {audioLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" strokeWidth={2.4} />} Play
              </button>
            )}
            <button onClick={() => goto(1)} disabled={isLast} className="brutal-btn brutal-border rounded-full w-11 h-11 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: "var(--sp-card)" }} data-testid="next-slide-btn" aria-label="Next slide">
              <SkipForward className="w-4 h-4" strokeWidth={2.4} />
            </button>
          </div>
          <button onClick={() => setAskOpen(true)} className="brutal-btn brutal-border brutal-shadow-sm rounded-full h-11 px-5 font-display font-bold inline-flex items-center gap-2" style={{ background: "#FDE047" }} data-testid="raise-hand-btn">
            <GraduationCap className="w-4 h-4" strokeWidth={2.4} /> Raise your hand
          </button>
        </div>
      </div>

      {/* Progress dots */}
      <div className="mt-4 flex items-center justify-center gap-2">
        {lesson.slides.map((_, i) => (
          <button key={i} onClick={() => setSlideIdx(i)} className={`h-2 rounded-full brutal-border transition-all`} style={{ width: i === slideIdx ? 28 : 12, background: i === slideIdx ? "#FDE047" : "var(--sp-card)" }} data-testid={`dot-${i}`} aria-label={`Slide ${i+1}`} />
        ))}
      </div>

      <audio ref={audioRef} onEnded={onEnded} preload="auto" crossOrigin="anonymous" />

      {/* Pop quiz modal */}
      <AnimatePresence>
        {showQuiz && slide?.pop_quiz && (
          <PopQuizModal
            quiz={slide.pop_quiz}
            pick={quizPick}
            revealed={quizRevealed}
            onPick={setQuizPick}
            onReveal={() => setQuizRevealed(true)}
            onDismiss={() => { setShowQuiz(false); if (!isLast) goto(1); else setShowHomework(true); }}
          />
        )}
      </AnimatePresence>

      {/* Ask professor modal */}
      <AnimatePresence>
        {askOpen && (
          <AskProfessorModal docId={docId} onClose={() => setAskOpen(false)} />
        )}
      </AnimatePresence>

      {/* Homework modal */}
      <AnimatePresence>
        {showHomework && lesson.homework?.length > 0 && (
          <HomeworkModal items={lesson.homework} onClose={() => setShowHomework(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function PopQuizModal({ quiz, pick, revealed, onPick, onReveal, onDismiss }) {
  return (
    <ModalShell testid="pop-quiz-modal">
      <div className="flex items-center gap-2 mb-4">
        <div className="brutal-border rounded-full px-3 py-1 text-xs font-display font-bold" style={{ background: "#FDE047" }}>Pop quiz</div>
        <div className="brutal-border rounded-full px-3 py-1 text-xs font-display font-bold" style={{ background: DIFF_BG[quiz.difficulty] || "#DDD6FE" }}>{quiz.difficulty}</div>
      </div>
      <div className="font-display font-black text-xl md:text-2xl leading-snug">{quiz.question}</div>
      <div className="mt-5 grid gap-2.5">
        {quiz.options.map((opt, i) => {
          const isPick = pick === opt;
          const isCorrect = opt === quiz.correct_answer;
          let bg = "var(--sp-card)";
          if (revealed) {
            if (isCorrect) bg = "#A7F3D0";
            else if (isPick) bg = "#FBCFE8";
          } else if (isPick) bg = "#DDD6FE";
          return (
            <button key={i} onClick={() => !revealed && onPick(opt)} disabled={revealed} className={`brutal-border rounded-xl text-left p-3 flex items-center gap-3 ${!revealed ? "brutal-btn" : ""}`} style={{ background: bg }} data-testid={`popquiz-opt-${i}`}>
              <div className="w-7 h-7 brutal-border rounded-md flex items-center justify-center font-display font-black flex-shrink-0" style={{ background: "#FDE047" }}>
                {String.fromCharCode(65 + i)}
              </div>
              <div className="text-sm">{opt}</div>
              {revealed && isCorrect && <Check className="w-5 h-5 ml-auto flex-shrink-0" strokeWidth={2.6} />}
              {revealed && isPick && !isCorrect && <X className="w-5 h-5 ml-auto flex-shrink-0" strokeWidth={2.6} />}
            </button>
          );
        })}
      </div>
      {revealed && (
        <div className="mt-4 brutal-border rounded-xl p-3 text-sm" style={{ background: "#F4F4F5" }}>
          <div className="font-display font-bold">Why</div>
          <div className="mt-1">{quiz.explanation}</div>
        </div>
      )}
      <div className="mt-5 flex items-center justify-end gap-2">
        {!revealed ? (
          <button onClick={onReveal} disabled={!pick} className="brutal-btn brutal-border brutal-shadow-sm rounded-full px-5 py-2 font-display font-bold disabled:opacity-40" style={{ background: "#A7F3D0" }} data-testid="popquiz-check">Check</button>
        ) : (
          <button onClick={onDismiss} className="brutal-btn brutal-border brutal-shadow-sm rounded-full px-5 py-2 font-display font-bold" style={{ background: "#DDD6FE" }} data-testid="popquiz-continue">Continue class</button>
        )}
      </div>
    </ModalShell>
  );
}

function AskProfessorModal({ docId, onClose }) {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [audioUrl, setAudioUrl] = useState(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioRef = useRef(null);

  useEffect(() => () => {
    recorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
    audioRef.current?.pause();
  }, []);

  useEffect(() => {
    if (audioUrl && audioRef.current) {
      audioRef.current.src = audioUrl;
      audioRef.current.play().catch(() => {});
    }
  }, [audioUrl]);

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setProcessing(true);
        try {
          const st = await stt(blob);
          const q = (st.text || "").trim();
          setQuestion(q);
          if (!q) { toast.error("I didn't catch that. Try again."); return; }
          const va = await voiceAsk(docId, q);
          setAnswer(va.answer);
          if (va.audio_base64) setAudioUrl(`data:${va.mime};base64,${va.audio_base64}`);
        } catch (e) {
          toast.error(e?.response?.data?.detail || "Something went wrong");
        } finally {
          setProcessing(false);
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      toast.error("Mic permission needed");
    }
  };

  const stopRec = () => {
    recorderRef.current?.stop();
    setRecording(false);
  };

  return (
    <ModalShell testid="ask-modal" onClose={onClose}>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 brutal-border rounded-xl flex items-center justify-center" style={{ background: "#FDE047" }}>
          <GraduationCap className="w-5 h-5" strokeWidth={2.4} />
        </div>
        <div>
          <div className="font-display font-black text-lg">Ask the professor</div>
          <div className="text-xs" style={{ color: "var(--sp-muted-fg)" }}>Speak your question — the class will answer aloud.</div>
        </div>
      </div>

      <div className="mt-5 flex flex-col items-center">
        <button
          onClick={recording ? stopRec : startRec}
          disabled={processing}
          className={`brutal-btn brutal-border brutal-shadow rounded-full w-24 h-24 flex items-center justify-center disabled:opacity-40`}
          style={{ background: recording ? "#FBCFE8" : "#A7F3D0" }}
          data-testid="mic-btn"
          aria-label={recording ? "Stop recording" : "Start recording"}
        >
          {processing ? <Loader2 className="w-8 h-8 animate-spin" strokeWidth={2.4} /> : recording ? <MicOff className="w-8 h-8" strokeWidth={2.4} /> : <Mic className="w-8 h-8" strokeWidth={2.4} />}
        </button>
        <div className="mt-3 text-sm font-display font-bold">
          {processing ? "Thinking…" : recording ? "Listening… tap to stop" : "Tap to speak"}
        </div>
      </div>

      {question && (
        <div className="mt-6 brutal-border rounded-xl p-4" style={{ background: "#DDD6FE" }}>
          <div className="text-xs font-display font-bold uppercase tracking-widest mb-1">You asked</div>
          <div className="text-sm" data-testid="ask-question">{question}</div>
        </div>
      )}
      {answer && (
        <div className="mt-3 brutal-border rounded-xl p-4" style={{ background: "#FFFFFF" }}>
          <div className="text-xs font-display font-bold uppercase tracking-widest mb-1">Professor</div>
          <div className="text-sm leading-relaxed whitespace-pre-wrap" data-testid="ask-answer">{answer}</div>
        </div>
      )}
      <audio ref={audioRef} />
    </ModalShell>
  );
}

function HomeworkModal({ items, onClose }) {
  return (
    <ModalShell testid="homework-modal" onClose={onClose}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 brutal-border rounded-xl flex items-center justify-center" style={{ background: "#FED7AA" }}>
          <ClipboardList className="w-5 h-5" strokeWidth={2.4} />
        </div>
        <div>
          <div className="font-display font-black text-xl">Homework</div>
          <div className="text-xs" style={{ color: "var(--sp-muted-fg)" }}>Practice these to lock in today&apos;s lesson.</div>
        </div>
      </div>
      <ol className="space-y-3">
        {items.map((h, i) => (
          <li key={i} className="brutal-border rounded-xl p-4" style={{ background: "var(--sp-card)" }} data-testid={`hw-item-${i}`}>
            <div className="font-display font-bold">Q{i + 1}. {h.question}</div>
            {h.guidance && <div className="text-sm mt-1" style={{ color: "var(--sp-muted-fg)" }}>Hint: {h.guidance}</div>}
          </li>
        ))}
      </ol>
      <div className="mt-5 flex justify-end">
        <button onClick={onClose} className="brutal-btn brutal-border brutal-shadow-sm rounded-full px-5 py-2 font-display font-bold" style={{ background: "#FDE047" }} data-testid="hw-close">Class dismissed</button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ children, onClose, testid }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      data-testid={testid}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 20, opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="brutal-border brutal-shadow rounded-2xl p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto scrollbar-slim"
        style={{ background: "var(--sp-bg)" }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

/** Live chalk typewriter — characters appear as if written by hand */
function ChalkText({ text, active, done }) {
  const [shown, setShown] = useState(done ? text.length : 0);

  useEffect(() => {
    if (done && !active) {
      setShown(text.length);
      return;
    }
    if (!active) return;
    setShown(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= text.length) clearInterval(id);
    }, Math.max(18, Math.min(45, 900 / Math.max(1, text.length))));
    return () => clearInterval(id);
  }, [text, active, done]);

  const display = text.slice(0, shown);
  return (
    <span style={{ color: "#F5F5F4", fontFamily: "inherit" }}>
      {display}
      {active && shown < text.length && (
        <span
          className="inline-block w-1.5 h-4 ml-0.5 align-middle"
          style={{ background: "#FDE047", animation: "pulse 0.7s infinite" }}
        />
      )}
    </span>
  );
}
