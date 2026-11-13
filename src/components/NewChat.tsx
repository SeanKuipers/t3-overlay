import { useEffect, useState, type RefObject } from "react";
import { listProjects, type Project } from "../lib/t3";
import { ProjectPicker, SCRATCH } from "./ProjectPicker";

const LAST_PROJECT_KEY = "t3-overlay:last-project";

interface Props {
  /** Pre-selected project (e.g. the open thread's), unless you last picked another. */
  suggestedProjectId: string | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onStart: (projectId: string | null, message: string) => Promise<void>;
  onCancel: () => void;
}

/** "New chat": pick a project, say what the agent should do, Enter starts it. */
export function NewChat({ suggestedProjectId, inputRef, onStart, onCancel }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState<string>(
    () => localStorage.getItem(LAST_PROJECT_KEY) ?? suggestedProjectId ?? "",
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listProjects()
      .then((list) => {
        setProjects(list);
        // Fall back to a project that exists.
        setProjectId((id) => (id === SCRATCH || list.some((p) => p.id === id) ? id : list[0]?.id ?? SCRATCH));
      })
      .catch((e) => setError(e?.message ?? String(e)));
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [inputRef]);

  const start = async () => {
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem(LAST_PROJECT_KEY, projectId);
      await onStart(projectId === SCRATCH ? null : projectId, text);
    } catch (e) {
      setError((e as { message?: string })?.message ?? String(e));
      setBusy(false);
    }
  };

  return (
    <div className="new-chat">
      <div className="new-chat-project">
        <span>New chat in</span>
        <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} disabled={busy} />
      </div>
      <div className="composer">
        <textarea
          ref={inputRef}
          rows={3}
          value={message}
          placeholder="What should the agent do?"
          disabled={busy}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              start();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
        />
        <button className="send-btn" disabled={busy || !message.trim()} onClick={start} title="Start the chat (Enter)" aria-label="Start chat">
          {busy ? (
            <span className="spinner" />
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>
      {error && <div className="send-error">{error}</div>}
    </div>
  );
}
