import type { Notice } from "../lib/useT3";

/** Short pop-ups when an agent finishes. They fade on their own. */
export function Notices({ notices }: { notices: Notice[] }) {
  if (notices.length === 0) return null;
  return (
    <div className="notices">
      {notices.map((n) => (
        <div key={n.id} className="notice glass">
          <div className="notice-title">
            <span className="dot new" /> {n.title}
          </div>
          {n.text && <div className="notice-text">{n.text}</div>}
        </div>
      ))}
    </div>
  );
}
