export interface NoticeView {
  id: number | string;
  title: string;
  text: string;
}

/** Short pop-ups (an agent finished, the overlay updated). They fade on their own. */
export function Notices({ notices }: { notices: NoticeView[] }) {
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
