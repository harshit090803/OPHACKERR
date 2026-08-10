import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles, Trash2, GraduationCap, User, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { clearChat, getChat, sendChat } from "../lib/apiClient";

const STARTERS = [
  "Teach me the most important concept in this material.",
  "Explain the hardest topic here like I'm a beginner.",
  "Give me a real-world example of the main idea.",
  "Quiz me on one concept and check my answer.",
];

export default function TeacherChat({ docId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await getChat(docId);
        setMessages(d.messages || []);
      } catch {
        toast.error("Could not load chat");
      } finally {
        setLoading(false);
      }
    })();
  }, [docId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const send = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setInput("");
    const optimistic = [...messages, { role: "user", content: msg, ts: new Date().toISOString() }];
    setMessages(optimistic);
    setSending(true);
    try {
      const res = await sendChat(docId, msg);
      setMessages(res.messages);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Teacher couldn't reply");
      setMessages(messages); // rollback
    } finally {
      setSending(false);
    }
  };

  const onClear = async () => {
    try {
      await clearChat(docId);
      setMessages([]);
      toast.success("Chat cleared");
    } catch {
      toast.error("Could not clear chat");
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="brutal-border brutal-shadow rounded-2xl overflow-hidden flex flex-col" style={{ background: "var(--sp-card)", height: "min(70vh, 680px)" }} data-testid="teacher-chat">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b-2" style={{ background: "#DDD6FE", borderColor: "var(--sp-border)" }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl brutal-border flex items-center justify-center" style={{ background: "#FDE047" }}>
              <GraduationCap className="w-5 h-5" strokeWidth={2.4} />
            </div>
            <div>
              <div className="font-display font-black text-lg leading-none">Professor StudyPilot</div>
              <div className="text-xs mt-1" style={{ color: "#171717" }}>Personal tutor for your material</div>
            </div>
          </div>
          {messages.length > 0 && (
            <button onClick={onClear} className="brutal-btn brutal-border rounded-full w-9 h-9 flex items-center justify-center" style={{ background: "#FBCFE8" }} data-testid="clear-chat-btn" aria-label="Clear chat">
              <Trash2 className="w-4 h-4" strokeWidth={2.4} />
            </button>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-slim px-5 py-6 space-y-4" data-testid="chat-messages">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : messages.length === 0 ? (
            <div className="text-center pt-8">
              <div className="w-14 h-14 mx-auto rounded-2xl brutal-border flex items-center justify-center mb-4" style={{ background: "#A7F3D0" }}>
                <Sparkles className="w-7 h-7" strokeWidth={2.4} />
              </div>
              <div className="font-display font-black text-xl">Class is in session</div>
              <div className="text-sm mt-2 max-w-md mx-auto" style={{ color: "var(--sp-muted-fg)" }}>
                Ask me anything about your PDF. I&apos;ll explain concepts, give examples, and check your understanding — just like class.
              </div>
              <div className="mt-6 grid sm:grid-cols-2 gap-2 max-w-lg mx-auto">
                {STARTERS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => send(s)}
                    className="brutal-btn brutal-border rounded-xl px-3 py-2.5 text-sm text-left font-display font-bold"
                    style={{ background: ["#FDE047", "#A7F3D0", "#DDD6FE", "#BAE6FD"][i] }}
                    data-testid={`starter-${i}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className={`flex items-start gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}
                  data-testid={`msg-${m.role}-${i}`}
                >
                  <div className="w-9 h-9 rounded-xl brutal-border flex items-center justify-center flex-shrink-0" style={{ background: m.role === "user" ? "#BAE6FD" : "#FDE047" }}>
                    {m.role === "user" ? <User className="w-4 h-4" strokeWidth={2.4} /> : <GraduationCap className="w-4 h-4" strokeWidth={2.4} />}
                  </div>
                  <div
                    className={`max-w-[78%] brutal-border rounded-2xl px-4 py-3 leading-relaxed whitespace-pre-wrap`}
                    style={{ background: m.role === "user" ? "#DDD6FE" : "#FFFFFF" }}
                  >
                    {m.content}
                  </div>
                </motion.div>
              ))}
              {sending && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-3" data-testid="typing-indicator">
                  <div className="w-9 h-9 rounded-xl brutal-border flex items-center justify-center flex-shrink-0" style={{ background: "#FDE047" }}>
                    <GraduationCap className="w-4 h-4" strokeWidth={2.4} />
                  </div>
                  <div className="brutal-border rounded-2xl px-4 py-3 inline-flex gap-1.5" style={{ background: "#FFFFFF" }}>
                    <Dot delay={0} /><Dot delay={0.15} /><Dot delay={0.3} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>

        {/* Input */}
        <div className="border-t-2 p-4 flex items-center gap-2" style={{ borderColor: "var(--sp-border)", background: "var(--sp-card)" }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
            placeholder="Ask the professor…"
            className="flex-1 brutal-border rounded-full px-5 py-3 outline-none font-medium"
            style={{ background: "var(--sp-bg)" }}
            disabled={sending}
            data-testid="chat-input"
          />
          <button
            onClick={() => send()}
            disabled={sending || !input.trim()}
            className="brutal-btn brutal-border brutal-shadow-sm rounded-full w-12 h-12 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "#FDE047" }}
            data-testid="chat-send-btn"
            aria-label="Send"
          >
            {sending ? <Loader2 className="w-5 h-5 animate-spin" strokeWidth={2.4} /> : <Send className="w-5 h-5" strokeWidth={2.4} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function Dot({ delay }) {
  return (
    <motion.span
      className="w-2 h-2 rounded-full"
      style={{ background: "#171717" }}
      animate={{ y: [0, -4, 0] }}
      transition={{ duration: 0.9, repeat: Infinity, delay }}
    />
  );
}
