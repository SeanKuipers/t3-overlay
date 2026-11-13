import { isWorking } from "../lib/t3";
import { workingFor } from "../lib/threadUi";
import { useTicker } from "../lib/useGame";
import type { ThreadView } from "../lib/useT3";

interface Props {
  threads: ThreadView[];
  connected: boolean;
  /** Opens the inbox on this thread. */
  onOpen: (threadId: string) => void;
  onOpenSettings: () => void;
  /** Opens the inbox / hub chat on whatever is selected (the idle pill). */
  onOpenAny: () => void;
}

/** One line, always on screen (drag it anywhere). Click an item to open it in the inbox. */
export function Ticker({ threads, connected, onOpen, onOpenSettings, onOpenAny }: Props) {
  useTicker(threads.some((t) => isWorking(t.status)), 5_000);
  if (!connected) {
    return (
      <button className="ticker glass" data-hit onClick={onOpenSettings} title="Open Settings">
        <span className="dot fail" /> T3 not connected
      </button>
    );
  }
  const asking = threads.filter((t) => t.questions.length > 0);
  const working = threads.filter((t) => isWorking(t.status) && t.questions.length === 0);
  const unread = threads.filter((t) => t.unread);
  // Nothing going on: a tiny pill, so there's always something to grab or click.
  if (working.length === 0 && unread.length === 0 && asking.length === 0) {
    return (
      <button className="ticker glass idle" data-hit onClick={onOpenAny} title="Open T3 · drag to move">
        <span className="dot idle" /> T3
      </button>
    );
  }
  const items = [
    ...asking.map((t) => ({ t, kind: "ask" as const })),
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
            {kind === "ask" ? (
              <b className="ask">{t.title} asks</b>
            ) : kind === "new" ? (
              <b>{t.title} replied</b>
            ) : (
              <>
                {t.title}
                {workingFor(t) && <span className="ticker-time">{workingFor(t)}</span>}
              </>
            )}
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
