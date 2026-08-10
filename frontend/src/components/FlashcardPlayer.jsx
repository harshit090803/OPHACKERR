import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, RotateCcw, ThumbsUp, ThumbsDown, Sparkles } from "lucide-react";

const DIFF_BG = { Easy: "#A7F3D0", Medium: "#FDE047", Hard: "#FBCFE8" };
const CARD_BG = ["#FDE047", "#A7F3D0", "#DDD6FE", "#BAE6FD", "#FBCFE8", "#FED7AA"];

export default function FlashcardPlayer({ cards }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [status, setStatus] = useState({}); // { idx: 'known' | 'review' }

  const known = useMemo(() => Object.values(status).filter((s) => s === "known").length, [status]);

  if (!cards || cards.length === 0) {
    return <div className="brutal-border rounded-2xl p-10 text-center" style={{ background: "var(--sp-card)" }}>No flashcards available.</div>;
  }

  const c = cards[idx];

  const nav = (delta) => {
    setFlipped(false);
    setIdx((i) => Math.max(0, Math.min(cards.length - 1, i + delta)));
  };

  const mark = (s) => {
    setStatus({ ...status, [idx]: s });
    if (idx < cards.length - 1) setTimeout(() => nav(1), 200);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="font-display font-bold text-sm" style={{ color: "var(--sp-muted-fg)" }}>Card {idx + 1} of {cards.length}</div>
        <div className="flex items-center gap-2">
          <span className="brutal-border rounded-full px-2.5 py-0.5 text-xs font-display font-bold" style={{ background: DIFF_BG[c.difficulty] || "#FDE047" }}>{c.difficulty}</span>
          {c.topic && <span className="brutal-border rounded-full px-2.5 py-0.5 text-xs font-display font-bold" style={{ background: "#BAE6FD" }}>{c.topic}</span>}
        </div>
      </div>

      <div className="brutal-border rounded-full h-3 overflow-hidden mb-6" style={{ background: "var(--sp-card)" }}>
        <div className="h-full" style={{ width: `${((idx + 1) / cards.length) * 100}%`, background: "#A7F3D0", transition: "width 300ms ease-out" }} />
      </div>

      <div className="flashcard-scene min-h-[340px]" data-testid="flashcard-scene">
        <AnimatePresence mode="wait">
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.25 }}
            className="relative w-full"
            style={{ transformStyle: "preserve-3d", perspective: 1500 }}
          >
            <motion.button
              onClick={() => setFlipped((f) => !f)}
              className="relative w-full min-h-[340px] rounded-2xl brutal-border brutal-shadow text-left"
              style={{ transformStyle: "preserve-3d", background: "transparent" }}
              animate={{ rotateY: flipped ? 180 : 0 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              data-testid="flashcard-flip-btn"
            >
              {/* FRONT */}
              <div
                className="flashcard-face absolute inset-0 rounded-2xl p-8 flex flex-col"
                style={{ background: CARD_BG[idx % CARD_BG.length] }}
              >
                <div className="inline-flex items-center gap-2 self-start brutal-border rounded-full px-2.5 py-1 text-xs font-display font-bold" style={{ background: "#FFFFFF" }}>
                  <Sparkles className="w-3.5 h-3.5" strokeWidth={2.4} /> Question
                </div>
                <div className="flex-1 flex items-center justify-center">
                  <div className="font-display font-black text-2xl md:text-3xl text-center leading-tight" data-testid="flashcard-question">
                    {c.question}
                  </div>
                </div>
                <div className="text-xs text-center font-display font-bold opacity-70">Tap to reveal answer</div>
              </div>
              {/* BACK */}
              <div
                className="flashcard-face absolute inset-0 rounded-2xl p-8 flex flex-col"
                style={{ background: "#FFFFFF", transform: "rotateY(180deg)" }}
              >
                <div className="inline-flex items-center gap-2 self-start brutal-border rounded-full px-2.5 py-1 text-xs font-display font-bold" style={{ background: "#A7F3D0" }}>
                  Answer
                </div>
                <div className="flex-1 flex items-center justify-center overflow-auto scrollbar-slim">
                  <div className="text-lg md:text-xl text-center leading-relaxed" data-testid="flashcard-answer">
                    {c.answer}
                  </div>
                </div>
                <div className="text-xs text-center font-display font-bold opacity-70">Tap to flip back</div>
              </div>
            </motion.button>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <button onClick={() => mark("review")} className="brutal-btn brutal-border brutal-shadow-sm rounded-full py-2.5 font-display font-bold inline-flex items-center justify-center gap-2" style={{ background: "#FBCFE8" }} data-testid="mark-review-btn">
          <ThumbsDown className="w-4 h-4" strokeWidth={2.4} /> Review
        </button>
        <button onClick={() => setFlipped((f) => !f)} className="brutal-btn brutal-border brutal-shadow-sm rounded-full py-2.5 font-display font-bold inline-flex items-center justify-center gap-2" style={{ background: "#FDE047" }} data-testid="flip-btn">
          <RotateCcw className="w-4 h-4" strokeWidth={2.4} /> Flip
        </button>
        <button onClick={() => mark("known")} className="brutal-btn brutal-border brutal-shadow-sm rounded-full py-2.5 font-display font-bold inline-flex items-center justify-center gap-2" style={{ background: "#A7F3D0" }} data-testid="mark-known-btn">
          <ThumbsUp className="w-4 h-4" strokeWidth={2.4} /> Got it
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button onClick={() => nav(-1)} disabled={idx === 0} className="brutal-btn brutal-border rounded-full px-4 py-2 font-display font-bold text-sm inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: "var(--sp-card)" }} data-testid="prev-card-btn">
          <ChevronLeft className="w-4 h-4" strokeWidth={2.4} /> Prev
        </button>
        <div className="text-sm font-display font-bold">Known: {known}/{cards.length}</div>
        <button onClick={() => nav(1)} disabled={idx === cards.length - 1} className="brutal-btn brutal-border rounded-full px-4 py-2 font-display font-bold text-sm inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: "var(--sp-card)" }} data-testid="next-card-btn">
          Next <ChevronRight className="w-4 h-4" strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}
