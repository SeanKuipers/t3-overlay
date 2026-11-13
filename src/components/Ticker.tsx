import { isWorking } from "../lib/t3";
import type { ThreadView } from "../lib/useT3";

/** One line in the top-left corner while you play. Never clickable. */
export function Ticker({ threads, connected }: { threads: ThreadView[]; connected: boolean }) {
  if (!connected) {
    return (
      <div className="ticker glass">
        <span className="dot fail" /> T3 not connected
      </div>
    );
  }
  const working = threads.filter((t) => isWorking(t.status));
  const unread = threads.filter((t) => t.unread);
  if (working.length === 0 && unread.length === 0) return null;
  const items = [
    ...unread.map((t) => ({ t, kind: "new" as const })),
    ...working.map((t) => ({ t, kind: "run" as const })),
  ];
  const shown = items.slice(0, 3);
  return (
    <div className="ticker glass">
      {shown.map(({ t, kind }, i) => (
        <span key={t.threadId} className="ticker-item">
          {i > 0 && <span className="sep">·</span>}
          <span className={`dot ${kind}`} />
          {kind === "new" ? <b>{t.title} replied</b> : t.title}
        </span>
      ))}
      {items.length > shown.length && <span className="sep">+{items.length - shown.length}</span>}
    </div>
  );
}
