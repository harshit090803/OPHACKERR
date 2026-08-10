import { useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { GraduationCap, LibraryBig, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { uploadPdf } from "../lib/apiClient";

export default function NavBar() {
  const loc = useLocation();
  const nav = useNavigate();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const isActive = (p) => loc.pathname === p || (p === "/library" && loc.pathname.startsWith("/study"));

  const onPick = () => {
    if (uploading) return;
    fileRef.current?.click();
  };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Only PDF files are supported");
      return;
    }
    if (f.size > 15 * 1024 * 1024) {
      toast.error("PDF must be under 15 MB");
      return;
    }
    setUploading(true);
    try {
      const res = await uploadPdf(f);
      toast.success("PDF uploaded. StudyPilot is thinking…");
      nav(`/study/${res.id}`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <nav
      className="sticky top-0 z-40 border-b-2"
      style={{ background: "var(--sp-bg)", borderColor: "var(--sp-border)" }}
      data-testid="main-nav"
    >
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 group" data-testid="nav-home-link">
          <div className="brutal-border brutal-shadow-sm w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FDE047" }}>
            <GraduationCap className="w-5 h-5" strokeWidth={2.4} />
          </div>
          <span className="font-display text-2xl font-black tracking-tight">StudyPilot<span style={{ color: "#7C3AED" }}>.</span></span>
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPick}
            disabled={uploading}
            className={`brutal-btn font-display font-bold text-sm px-4 py-2 rounded-full brutal-border flex items-center gap-2 disabled:opacity-60 ${
              isActive("/") ? "brutal-shadow-sm" : ""
            }`}
            style={{ background: isActive("/") ? "#A7F3D0" : "transparent" }}
            data-testid="nav-upload-link"
          >
            {uploading ? (
              <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2.4} />
            ) : (
              <Upload className="w-4 h-4" strokeWidth={2.4} />
            )}
            {uploading ? "Uploading…" : "Upload"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={onFile}
            data-testid="nav-upload-file-input"
          />
          <Link
            to="/library"
            className={`brutal-btn font-display font-bold text-sm px-4 py-2 rounded-full brutal-border flex items-center gap-2 ${
              isActive("/library") ? "brutal-shadow-sm" : ""
            }`}
            style={{ background: isActive("/library") ? "#DDD6FE" : "transparent" }}
            data-testid="nav-library-link"
          >
            <LibraryBig className="w-4 h-4" strokeWidth={2.4} /> Library
          </Link>
        </div>
      </div>
    </nav>
  );
}
