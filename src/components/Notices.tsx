export interface NoticeView {
  id: number | string;
  title: string;
  text: string;
  /** Set for "an agent replied" notices; clicking opens the thread. */
  threadId?: string;
}

/** Short pop-ups (an agent finished, the overlay updated). Click to open; they fade on their own. */
export function Notices({ notices, onOpen }: { notices: NoticeView[]; onOpen: (notice: NoticeView) => void }) {
  if (notices.length === 0) return null;
  return (
    <div className="notices">
      {notices.map((n) => (
        <button key={n.id} className="notice glass" data-hit onClick={() => onOpen(n)} title={n.threadId ? "Open in the inbox" : undefined}>
          <div className="notice-title">
            <span className="dot new" /> {n.title}
          </div>
          {n.text && <div className="notice-text">{n.text}</div>}
        </button>
      ))}
    </div>
  );
}
