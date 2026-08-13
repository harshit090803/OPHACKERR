import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  UploadCloud, FileText, Loader2, Sparkles, BrainCircuit, Layers,
  Check, Video, MessageSquare, CreditCard,
} from "lucide-react";
import { toast } from "sonner";
import { uploadPdf } from "../lib/apiClient";

const PLANS = [
  {
    name: "Starter", price: 59, period: "/mo", desc: "For solo students preparing for one subject.",
    features: ["15 PDF uploads / month", "Quizzes & flashcards", "AI Teacher chat", "Basic video lessons"], color: "#FDE047", cta: "Get Starter", popular: false,
  },
  {
    name: "Pro", price: 99, period: "/mo", desc: "Serious exam prep with full video professor.",
    features: ["50 PDF uploads / month", "Unlimited quizzes & flashcards", "Full video class + TTS", "Voice Q&A (raise hand)", "Priority processing"], color: "#A7F3D0", cta: "Go Pro", popular: true,
  },
  {
    name: "Team", price: 199, period: "/mo", desc: "Study groups, tutors, and small classes.",
    features: ["Unlimited PDF uploads", "Everything in Pro", "Up to 5 seats", "Shared study sets", "Export quizzes as PDF"], color: "#DDD6FE", cta: "Get Team", popular: false,
  },
];

export default function Landing() {
  const nav = useNavigate();
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState(null);

  const handleFile = useCallback(async (f) => {
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Only PDF files are supported");
      return;
    }
    if (f.size > 15 * 1024 * 1024) {
      toast.error("PDF must be under 15 MB");
      return;
    }
    setFile(f);
    setUploading(true);
    try {
      const res = await uploadPdf(f);
      toast.success("PDF uploaded. StudyPilot is thinking…");
      nav(`/study/${res.id}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Upload failed");
      setUploading(false);
      setFile(null);
    }
  }, [nav]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  return (
    <div className="grid-bg">
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-10">
        <div className="grid md:grid-cols-5 gap-10 items-start">
          <div className="md:col-span-3">
            <div className="inline-flex items-center gap-2 brutal-border brutal-shadow-sm rounded-full px-3 py-1 mb-6" style={{ background: "#FDE047" }}>
              <Sparkles className="w-4 h-4" strokeWidth={2.4} />
              <span className="font-display font-bold text-xs uppercase tracking-widest">Professor-grade AI</span>
            </div>
            <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl font-black leading-[0.95] tracking-tighter">
              Drop a PDF.<br />Walk out with an{" "}
              <span className="px-2" style={{ background: "#A7F3D0", boxShadow: "4px 4px 0 #171717" }}>exam-ready</span><br />quiz and deck.
            </h1>
            <p className="mt-8 text-lg max-w-xl leading-relaxed" style={{ color: "var(--sp-muted-fg)" }}>
              StudyPilot AI reads your notes like a 20-year professor — extracting concepts, writing meaningful MCQs and flashcards that test understanding, not memorization.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Feature icon={<BrainCircuit className="w-4 h-4" strokeWidth={2.4} />} label="Concept-based" color="#DDD6FE" />
              <Feature icon={<Layers className="w-4 h-4" strokeWidth={2.4} />} label="Balanced difficulty" color="#FBCFE8" />
              <Feature icon={<FileText className="w-4 h-4" strokeWidth={2.4} />} label="Cleans headers & noise" color="#BAE6FD" />
              <Feature icon={<Video className="w-4 h-4" strokeWidth={2.4} />} label="Video professor" color="#FDE047" />
            </div>
          </div>
          <div className="md:col-span-2">
            <label htmlFor="file-input" onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop} className="block cursor-pointer brutal-border brutal-shadow rounded-2xl p-8 text-center transition-transform" style={{ background: dragOver ? "#DDD6FE" : "var(--sp-card)", transform: dragOver ? "translate(-2px,-2px)" : "none" }} data-testid="upload-dropzone">
              {uploading ? (
                <div className="py-10 flex flex-col items-center gap-4"><Loader2 className="w-10 h-10 animate-spin" strokeWidth={2.2} /><div className="font-display font-bold text-lg">Uploading {file?.name}…</div><div className="text-sm" style={{ color: "var(--sp-muted-fg)" }}>This usually takes a few seconds</div></div>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-2xl brutal-border mx-auto flex items-center justify-center mb-4" style={{ background: "#FDE047" }}><UploadCloud className="w-8 h-8" strokeWidth={2.4} /></div>
                  <div className="font-display text-xl font-bold">Drop your PDF here</div>
                  <div className="text-sm mt-2" style={{ color: "var(--sp-muted-fg)" }}>or click to browse — up to 15 MB</div>
                  <div className="mt-6 inline-block brutal-btn brutal-border brutal-shadow-sm rounded-full px-5 py-2 font-display font-bold" style={{ background: "#A7F3D0" }} data-testid="upload-browse-btn">Choose PDF</div>
                </>
              )}
              <input id="file-input" type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} data-testid="upload-file-input" />
            </label>
            <div className="mt-4 flex items-start gap-3 text-xs px-2" style={{ color: "var(--sp-muted-fg)" }}><span>Tip: Text-based PDFs work best. Scanned images can&apos;t be read yet.</span></div>
          </div>
        </div>
      </section>
      <section className="max-w-6xl mx-auto px-6 pb-16"><div className="grid md:grid-cols-3 gap-5">
        {[{ n: "01", t: "Reads deeply", d: "Strips page numbers, headers, subject codes, references. Keeps the meat." }, { n: "02", t: "Thinks like a professor", d: "Generates conceptual, application, and reasoning questions — never trivia." }, { n: "03", t: "Study your way", d: "Video class, flashcards, quiz, or chat. Track your score and review explanations." }].map((s, i) => (
          <div key={i} className="brutal-border rounded-2xl p-6 transition-transform hover:-translate-y-1" style={{ background: ["#FDE047", "#A7F3D0", "#DDD6FE"][i] }}><div className="font-display font-black text-4xl">{s.n}</div><div className="font-display font-bold text-xl mt-3">{s.t}</div><div className="text-sm mt-2 leading-relaxed" style={{ color: "#171717" }}>{s.d}</div></div>
        ))}
      </div></section>
      <section className="max-w-6xl mx-auto px-6 pb-24" id="pricing">
        <div className="text-center mb-10"><div className="inline-flex items-center gap-2 brutal-border rounded-full px-3 py-1 mb-4" style={{ background: "#BAE6FD" }}><CreditCard className="w-4 h-4" strokeWidth={2.4} /><span className="font-display font-bold text-xs uppercase tracking-widest">Pricing</span></div><h2 className="font-display text-4xl sm:text-5xl font-black tracking-tighter">Simple, transparent plans</h2><p className="mt-3 text-lg" style={{ color: "var(--sp-muted-fg)" }}>Start free with your first PDF. Upgrade when you need more.</p></div>
        <div className="grid md:grid-cols-3 gap-6">{PLANS.map((plan) => (
          <div key={plan.name} className={`brutal-border rounded-2xl p-6 flex flex-col relative transition-transform hover:-translate-y-1 ${plan.popular ? "brutal-shadow" : "brutal-shadow-sm"}`} style={{ background: "var(--sp-card)" }} data-testid={`plan-${plan.name.toLowerCase()}`}>
            {plan.popular && <div className="absolute -top-3 left-1/2 -translate-x-1/2 brutal-border rounded-full px-3 py-0.5 text-xs font-display font-black" style={{ background: "#FDE047" }}>MOST POPULAR</div>}
            <div className="w-12 h-12 brutal-border rounded-xl flex items-center justify-center mb-4" style={{ background: plan.color }}><span className="font-display font-black text-lg">{plan.name[0]}</span></div>
            <div className="font-display font-black text-2xl">{plan.name}</div><p className="text-sm mt-1" style={{ color: "var(--sp-muted-fg)" }}>{plan.desc}</p>
            <div className="mt-5 flex items-baseline gap-1"><span className="font-display font-black text-5xl tracking-tighter">₹{plan.price}</span><span className="text-sm font-display font-bold" style={{ color: "var(--sp-muted-fg)" }}>{plan.period}</span></div>
            <ul className="mt-6 space-y-2.5 flex-1">{plan.features.map((f) => <li key={f} className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2.6} /><span>{f}</span></li>)}</ul>
            <button className="mt-8 w-full brutal-btn brutal-border brutal-shadow-sm rounded-full py-3 font-display font-bold" style={{ background: plan.color }} onClick={() => toast.info("Billing coming soon — upload a PDF to try free for now!")} data-testid={`plan-cta-${plan.name.toLowerCase()}`}>{plan.cta}</button>
          </div>
        ))}</div>
      </section>
    </div>
  );
}

function Feature({ icon, label, color }) { return <div className="inline-flex items-center gap-2 brutal-border rounded-full px-3 py-1.5" style={{ background: color }}>{icon}<span className="font-display font-bold text-xs">{label}</span></div>; }
