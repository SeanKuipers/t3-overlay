import { native } from "../lib/native";
import { isWorking } from "../lib/t3";
import { dotClass, relativeTimeShort, workingFor } from "../lib/threadUi";
import { useTicker } from "../lib/useGame";
import { useHoverId } from "../lib/useHoverId";
import type { ThreadView } from "../lib/useT3";
import { Conversation, type ConversationProps } from "./Conversation";
import { NewChat } from "./NewChat";

// The dock: outside games, a thin strip on the right edge of the screen (like OpenBot's).
// One round icon per chat, with a working ring, unread dot or question badge. Hovering
// slides it open to show names and status; clicking a chat opens it beside the dock.

/** A stable colour per project. */
function hue(id: string | undefined) {
  let h = 0;
  for (const c of id ?? "") h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function Avatar({ thread }: { thread: ThreadView }) {
  const initial = (thread.projectTitle || thread.title || "?").trim().charAt(0).toUpperCase();
  return (
    <span className="avatar" style={{ background: `hsl(${hue(thread.projectId || thread.title)} 45% 32%)` }}>
      {initial}
      {isWorking(thread.status) && thread.questions.length === 0 && <span className="avatar-ring" />}
      {thread.questions.length > 0 && <span className="avatar-ask">?</span>}
      {thread.unread && thread.questions.length === 0 && <span className="avatar-unread" />}
    </span>
  );
}

function status(t: ThreadView) {
  if (t.questions.length > 0) return <span className="row-ask">Question</span>;
  if (isWorking(t.status)) return <span className="row-working">Working {workingFor(t)}</span>;
  if (t.unread) return <span className="row-new">New reply</span>;
  return <span className="row-time">{relativeTimeShort(t.updatedAt)}</span>;
}

interface Props extends Omit<ConversationProps, "thread" | "threadCount" | "footer" | "onClose"> {
  threads: ThreadView[];
  selected: ThreadView | null;
  chatOpen: boolean;
  focused: boolean;
  onOpen: (threadId: string) => void;
  onCloseChat: () => void;
  /** The T3 logo: open/close the chat on the current thread. */
  onToggleChat: () => void;
  onFocusRequest: () => void;
  onOpenSettings: () => void;
  composing: boolean;
  onNewChat: () => void;
  onStartChat: (projectId: string | null, message: string) => Promise<void>;
  onCancelNewChat: () => void;
  onThreadMenu: (threadId: string, x: number, y: number) => void;
}

export function Hub(props: Props) {
  const { threads, selected, chatOpen } = props;
  const expanded = useHoverId() === "dock";
  useTicker(true, 5_000); // keeps "5m" / "Working 4m" fresh

  const paneOpen = chatOpen && (!!selected || props.composing);
  const focusOnClick = () => !props.focused && props.onFocusRequest();
  const menu = (threadId: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    props.onThreadMenu(threadId, e.clientX, e.clientY);
  };

  return (
    <>
      <div className={`dock glass${expanded ? " open" : ""}`} data-hit data-hover-id="dock">
        <button className="dock-row dock-logo" onClick={props.onToggleChat} title="T3: open / close chat">
          <span className="logo-mark">
            T3
            {!props.connected && <span className="avatar-ask offline">!</span>}
          </span>
          <span className="dock-label">
            <b>T3 Code</b>
            <small>{props.connected ? `${threads.length} recent` : "Not connected"}</small>
          </span>
        </button>
        <div className="dock-sep" />
        <div className="dock-list">
          {threads.map((t) => (
            <button
              key={t.threadId}
              className={`dock-row${paneOpen && !props.composing && t.threadId === selected?.threadId ? " on" : ""}`}
              onClick={() => props.onOpen(t.threadId)}
              onContextMenu={menu(t.threadId)}
              title={expanded ? undefined : t.title}
            >
              <Avatar thread={t} />
              <span className="dock-label">
                <b>{t.title || "Untitled"}</b>
                <small>{status(t)}</small>
              </span>
            </button>
          ))}
        </div>
        <div className="dock-sep" />
        <button className={`dock-row dock-plus${props.composing && paneOpen ? " on" : ""}`} onClick={props.onNewChat} title="New chat">
          <span className="logo-mark plain">+</span>
          <span className="dock-label">
            <b>New chat</b>
          </span>
        </button>
        {(props.update.status.phase === "ready" ||
          props.update.status.phase === "downloading" ||
          props.update.status.phase === "installing") && (
          <button
            className="dock-row dock-update"
            onClick={() => native.updateInstallNow()}
            title="Install the new version now (the overlay restarts in a few seconds)"
          >
            <span className="logo-mark update">⬆</span>
            <span className="dock-label">
              <b>
                {props.update.status.phase === "ready"
                  ? `Update to v${props.update.status.version}`
                  : props.update.status.phase === "installing"
                    ? "Updating…"
                    : "Downloading update…"}
              </b>
            </span>
          </button>
        )}
        <button className="dock-row dock-plus" onClick={props.onOpenSettings} title="Settings">
          <span className="logo-mark plain">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </span>
          <span className="dock-label">
            <b>Settings</b>
          </span>
        </button>
      </div>

      {paneOpen && (
        <div className="hub-chat dock-chat inbox glass" data-hit onMouseDown={focusOnClick}>
          <div className="hub-chat-head">
            {props.composing || !selected ? (
              <span className="hub-chat-title">New chat</span>
            ) : (
              <>
                <span className={dotClass(selected)} />
                <span className="hub-chat-title" title={selected.title}>
                  {selected.title || "Untitled"}
                </span>
                {selected.projectTitle && <span className="hub-chat-project">{selected.projectTitle}</span>}
              </>
            )}
            <span className="spacer" />
            <button className="close" onClick={props.onCloseChat} title="Close (Esc)">
              ×
            </button>
          </div>
          {props.composing || !selected ? (
            <NewChat
              suggestedProjectId={selected?.projectId ?? null}
              inputRef={props.inputRef}
              onStart={props.onStartChat}
              onCancel={props.onCancelNewChat}
            />
          ) : (
            <Conversation {...props} thread={selected} threadCount={threads.length} onClose={props.onCloseChat} />
          )}
        </div>
      )}
    </>
  );
}
