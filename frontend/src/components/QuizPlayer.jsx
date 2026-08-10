import { useMemo, useState } from "react";
import { Check, X, ChevronRight, RotateCcw, Trophy } from "lucide-react";

const DIFF_BG = { Easy: "#A7F3D0", Medium: "#FDE047", Hard: "#FBCFE8" };

export default function QuizPlayer({ quiz }) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState({}); // { qIdx: selectedOption }
  const [revealed, setRevealed] = useState({});
  const [finished, setFinished] = useState(false);

  const score = useMemo(() => (quiz || []).reduce((s, q, i) => s + (answers[i] === q.correct_answer ? 1 : 0), 0), [answers, quiz]);

  if (!quiz || quiz.length === 0) {
    return <div className="brutal-border rounded-2xl p-10 text-center" style={{ background: "var(--sp-card)" }}>No quiz questions available.</div>;
  }

  const q = quiz[idx];
  const selected = answers[idx];
  const isRevealed = revealed[idx];

  if (finished) {
    const pct = Math.round((score / quiz.length) * 100);
    return (
      <div className="brutal-border brutal-shadow rounded-2xl p-10 text-center" style={{ background: "#FDE047" }} data-testid="quiz-result">
        <div className="w-16 h-16 mx-auto brutal-border rounded-2xl flex items-center justify-center" style={{ background: "#FFFFFF" }}>
          <Trophy className="w-8 h-8" strokeWidth={2.4} />
        </div>
        <div className="mt-4 font-display font-black text-5xl">{score}/{quiz.length}</div>
        <div className="mt-1 font-display text-lg">You scored {pct}%</div>
        <div className="mt-2 max-w-md mx-auto text-sm">{pct >= 80 ? "Exam-ready. Nice work." : pct >= 50 ? "Solid start — review the misses below." : "Let's revise the concepts and try again."}</div>

        <div className="mt-8 grid gap-3 text-left">
          {quiz.map((qq, i) => {
            const ok = answers[i] === qq.correct_answer;
            return (
              <div key={i} className="brutal-border rounded-xl p-4" style={{ background: "var(--sp-card)" }}>
                <div className="flex items-start gap-3">
                  <div className={`w-6 h-6 rounded-md brutal-border flex items-center justify-center flex-shrink-0`} style={{ background: ok ? "#A7F3D0" : "#FBCFE8" }}>
                    {ok ? <Check className="w-4 h-4" strokeWidth={2.6} /> : <X className="w-4 h-4" strokeWidth={2.6} />}
                  </div>
                  <div className="min-w-0">
                    <div className="font-display font-bold">{i + 1}. {qq.question}</div>
                    <div className="mt-1 text-sm"><span className="font-bold">Answer:</span> {qq.correct_answer}</div>
                    {!ok && answers[i] && <div className="text-sm" style={{ color: "#B91C1C" }}><span className="font-bold">Your pick:</span> {answers[i]}</div>}
                    <div className="mt-1 text-sm" style={{ color: "var(--sp-muted-fg)" }}>{qq.explanation}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <button onClick={() => { setAnswers({}); setRevealed({}); setIdx(0); setFinished(false); }} className="mt-8 brutal-btn brutal-border brutal-shadow-sm rounded-full px-6 py-2.5 font-display font-bold inline-flex items-center gap-2" style={{ background: "#DDD6FE" }} data-testid="restart-quiz-btn">
          <RotateCcw className="w-4 h-4" strokeWidth={2.4} /> Take again
        </button>
      </div>
    );
  }

  const pick = (opt) => {
    if (isRevealed) return;
    setAnswers({ ...answers, [idx]: opt });
  };

  const next = () => {
    if (idx < quiz.length - 1) setIdx(idx + 1);
    else setFinished(true);
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="font-display font-bold text-sm" style={{ color: "var(--sp-muted-fg)" }}>Question {idx + 1} of {quiz.length}</div>
        <div className="flex items-center gap-2">
          <span className="brutal-border rounded-full px-2.5 py-0.5 text-xs font-display font-bold" style={{ background: DIFF_BG[q.difficulty] || "#FDE047" }} data-testid="q-difficulty">{q.difficulty}</span>
          {q.topic && <span className="brutal-border rounded-full px-2.5 py-0.5 text-xs font-display font-bold" style={{ background: "#BAE6FD" }}>{q.topic}</span>}
        </div>
      </div>

      {/* Progress bar — shows completed questions */}
      <div className="brutal-border rounded-full h-3 overflow-hidden mb-6" style={{ background: "var(--sp-card)" }}>
        <div
          className="h-full"
          style={{
            width: `${((idx + (isRevealed ? 1 : 0)) / quiz.length) * 100}%`,
            background: "#FDE047",
            transition: "width 300ms ease-out",
          }}
        />
      </div>

      <div className="brutal-border brutal-shadow rounded-2xl p-6 md:p-8" style={{ background: "var(--sp-card)" }} data-testid="quiz-card">
        <div className="font-display font-black text-xl md:text-2xl leading-snug">{q.question}</div>

        <div className="mt-6 grid gap-3">
          {q.options.map((opt, i) => {
            const isSel = selected === opt;
            const isCorrect = opt === q.correct_answer;
            let bg = "var(--sp-card)";
            if (isRevealed) {
              if (isCorrect) bg = "#A7F3D0";
              else if (isSel) bg = "#FBCFE8";
            } else if (isSel) bg = "#DDD6FE";
            return (
              <button
                key={i}
                onClick={() => pick(opt)}
                disabled={isRevealed}
                className={`brutal-border rounded-xl text-left p-4 flex items-start gap-3 ${!isRevealed ? "brutal-btn" : ""}`}
                style={{ background: bg }}
                data-testid={`quiz-option-${i}`}
              >
                <div className="w-7 h-7 brutal-border rounded-md flex items-center justify-center font-display font-black flex-shrink-0" style={{ background: "#FDE047" }}>
                  {String.fromCharCode(65 + i)}
                </div>
                <div className="pt-0.5 leading-snug">{opt}</div>
                {isRevealed && isCorrect && <Check className="w-5 h-5 ml-auto flex-shrink-0" strokeWidth={2.6} />}
                {isRevealed && isSel && !isCorrect && <X className="w-5 h-5 ml-auto flex-shrink-0" strokeWidth={2.6} />}
              </button>
            );
          })}
        </div>

        {isRevealed && (
          <div className="mt-5 brutal-border rounded-xl p-4" style={{ background: "#F4F4F5" }} data-testid="quiz-explanation">
            <div className="font-display font-bold text-sm">Why</div>
            <div className="text-sm mt-1 leading-relaxed">{q.explanation}</div>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <div className="text-sm font-display font-bold">Score: {score}</div>
          {!isRevealed ? (
            <button
              onClick={() => setRevealed({ ...revealed, [idx]: true })}
              disabled={!selected}
              className="brutal-btn brutal-border brutal-shadow-sm rounded-full px-5 py-2 font-display font-bold disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "#A7F3D0" }}
              data-testid="check-answer-btn"
            >
              Check answer
            </button>
          ) : (
            <button onClick={next} className="brutal-btn brutal-border brutal-shadow-sm rounded-full px-5 py-2 font-display font-bold inline-flex items-center gap-2" style={{ background: "#DDD6FE" }} data-testid="next-question-btn">
              {idx < quiz.length - 1 ? "Next" : "See results"} <ChevronRight className="w-4 h-4" strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
