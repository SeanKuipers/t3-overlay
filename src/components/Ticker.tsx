import { isWorking } from "../lib/t3";
import type { ThreadView } from "../lib/useT3";

interface Props {
  threads: ThreadView[];
  connected: boolean;
  /** Opens the inbox on this thread. */
  onOpen: (threadId: string) => void;
  onOpenSettings: () => void;
}

/** One line in the top-left corner. Click an item to open it in the inbox. */
export function Ticker({ threads, connected, onOpen, onOpenSettings }: Props) {
  if (!connected) {
    return (
      <button className="ticker glass" data-hit onClick={onOpenSettings} title="Open Settings">
        <span className="dot fail" /> T3 not connected
      </button>
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
    <div className="ticker glass" data-hit>
      {shown.map(({ t, kind }, i) => (
        <span key={t.threadId} className="ticker-item">
          {i > 0 && <span className="sep">·</span>}
          <button className="ticker-open" onClick={() => onOpen(t.threadId)} title={`Open ${t.title}`}>
            <span className={`dot ${kind}`} />
            {kind === "new" ? <b>{t.title} replied</b> : t.title}
          </button>
        </span>
      ))}
      {items.length > shown.length && (
        <button className="ticker-open sep" onClick={() => onOpen(items[shown.length].t.threadId)}>
          +{items.length - shown.length}
        </button>
      )}
    </div>
  );
}
