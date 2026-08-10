import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { deleteDocument, listDocuments } from "../lib/apiClient";
import { FileText, Trash2, ArrowRight, Loader2, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";

const STATUS_STYLE = {
  pending: { bg: "#FED7AA", label: "Queued", Icon: Clock },
  processing: { bg: "#BAE6FD", label: "Processing", Icon: Loader2 },
  ready: { bg: "#A7F3D0", label: "Ready", Icon: CheckCircle2 },
  error: { bg: "#FBCFE8", label: "Error", Icon: AlertTriangle },
};

export default function Dashboard() {
  const [docs, setDocs] = useState(null);

  const load = async () => {
    try {
      const data = await listDocuments();
      setDocs(data);
    } catch {
      toast.error("Could not load library");
      setDocs([]);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(() => {
      setDocs((prev) => {
        if (prev && prev.some((d) => d.status === "pending" || d.status === "processing")) {
          load();
        }
        return prev;
      });
    }, 3000);
    return () => clearInterval(t);
  }, []);

  const onDelete = async (id) => {
    try {
      await deleteDocument(id);
      setDocs((d) => d.filter((x) => x.id !== id));
      toast.success("Deleted");
    } catch {
      toast.error("Delete failed");
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="flex items-end justify-between mb-10">
        <div>
          <div className="font-display font-bold text-xs uppercase tracking-widest" style={{ color: "var(--sp-muted-fg)" }}>Your library</div>
          <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tighter mt-2">Everything you&apos;ve studied</h1>
        </div>
        <Link to="/" className="brutal-btn brutal-border brutal-shadow-sm rounded-full px-5 py-2.5 font-display font-bold" style={{ background: "#FDE047" }} data-testid="library-new-upload-btn">
          + New upload
        </Link>
      </div>

      {docs === null ? (
        <div className="py-24 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto" />
        </div>
      ) : docs.length === 0 ? (
        <div className="brutal-border rounded-2xl p-16 text-center" style={{ background: "var(--sp-card)" }} data-testid="library-empty-state">
          <div className="w-16 h-16 mx-auto brutal-border rounded-2xl flex items-center justify-center mb-4" style={{ background: "#DDD6FE" }}>
            <FileText className="w-8 h-8" strokeWidth={2.4} />
          </div>
          <div className="font-display font-bold text-2xl">Nothing here yet</div>
          <div className="mt-2" style={{ color: "var(--sp-muted-fg)" }}>Upload your first PDF to get started.</div>
          {/* apostrophe-safe empty state */}
          <Link to="/" className="inline-block mt-6 brutal-btn brutal-border brutal-shadow-sm rounded-full px-6 py-2.5 font-display font-bold" style={{ background: "#A7F3D0" }}>
            Upload PDF
          </Link>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5" data-testid="library-grid">
          {docs.map((d) => {
            const s = STATUS_STYLE[d.status] || STATUS_STYLE.pending;
            const StatusIcon = s.Icon;
            return (
              <div key={d.id} className="brutal-border brutal-shadow rounded-2xl p-6 flex flex-col" style={{ background: "var(--sp-card)" }} data-testid={`doc-card-${d.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="w-10 h-10 brutal-border rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "#BAE6FD" }}>
                    <FileText className="w-5 h-5" strokeWidth={2.4} />
                  </div>
                  <div className="inline-flex items-center gap-1.5 brutal-border rounded-full px-2.5 py-1 text-xs font-display font-bold" style={{ background: s.bg }}>
                    <StatusIcon className={`w-3.5 h-3.5 ${d.status === "processing" ? "animate-spin" : ""}`} strokeWidth={2.4} />
                    {s.label}
                  </div>
                </div>
                <div className="mt-4 font-display font-bold text-lg break-words leading-tight" title={d.filename}>{d.filename}</div>
                <div className="mt-2 text-xs" style={{ color: "var(--sp-muted-fg)" }}>{new Date(d.created_at).toLocaleString()}</div>

                {d.status === "ready" && (
                  <div className="mt-4 flex gap-2 text-xs font-display font-bold">
                    <span className="brutal-border rounded-full px-2.5 py-1" style={{ background: "#FDE047" }}>{d.quiz_count} MCQs</span>
                    <span className="brutal-border rounded-full px-2.5 py-1" style={{ background: "#A7F3D0" }}>{d.flashcard_count} cards</span>
                  </div>
                )}
                {d.status === "error" && (
                  <div className="mt-3 text-xs" style={{ color: "#B91C1C" }}>{d.error}</div>
                )}

                <div className="mt-auto pt-5 flex items-center justify-between">
                  <button onClick={() => onDelete(d.id)} className="brutal-btn brutal-border rounded-full w-9 h-9 flex items-center justify-center" style={{ background: "#FBCFE8" }} data-testid={`delete-${d.id}`}>
                    <Trash2 className="w-4 h-4" strokeWidth={2.4} />
                  </button>
                  <Link to={`/study/${d.id}`} className="brutal-btn brutal-border brutal-shadow-sm rounded-full px-4 py-2 font-display font-bold text-sm inline-flex items-center gap-2" style={{ background: "#DDD6FE" }} data-testid={`open-${d.id}`}>
                    Open <ArrowRight className="w-4 h-4" strokeWidth={2.4} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
