import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import Markdown from "react-markdown";
import type { SendMode, UpdateStatus } from "../lib/native";
import { isWorking } from "../lib/t3";
import { MODE_HELP, shortKey } from "../lib/threadUi";
import type { ThreadView } from "../lib/useT3";
import { UpdateControl } from "./UpdateControl";

export interface ConversationProps {
  thread: ThreadView | null;
  threadCount: number;
  connected: boolean;
  error: string | null;
  draft: string;
  sending: boolean;
  sendError: string | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  voiceHotkey: string | null;
  navHotkeys: [string, string] | null;
  sendMode: SendMode;
  update: { version: string | null; status: UpdateStatus };
  onDraft: (text: string) => void;
  /** `alternate`: Ctrl+Enter, i.e. the other of queue/steer. */
  onSubmit: (alternate: boolean) => void;
  onClose: () => void;
  onCycle: (step: number) => void;
  /** Shown under the reply box, e.g. the respawn bar. */
  footer?: ReactNode;
}

/** A thread's last exchange plus the reply box. Used by the in-game inbox and the hub. */
export function Conversation(props: ConversationProps) {
  const { thread } = props;
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastReplyRef = useRef<HTMLDivElement>(null);
  const conversation = thread?.conversation;
  const replies = conversation?.replies ?? [];

  // Jump to the start of the newest reply when switching threads or when it changes.
  const replyKey = conversation?.replyKey;
  useEffect(() => {
    const body = bodyRef.current;
    const last = lastReplyRef.current;
    if (body && last) body.scrollTop = Math.max(0, last.offsetTop - body.offsetTop - 8);
    else if (body) body.scrollTop = body.scrollHeight;
  }, [thread?.threadId, replyKey]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      props.onSubmit(e.ctrlKey || e.metaKey);
    } else if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    } else if (e.key === "Tab") {
      e.preventDefault();
      props.onCycle(e.shiftKey ? -1 : 1);
    }
  };

  const other: SendMode = props.sendMode === "steer" ? "queue" : "steer";

  return (
    <>
      <div className="body" ref={bodyRef}>
        {!props.connected ? (
          <p className="muted">Not connected to T3 Code. Open Settings from the tray icon.</p>
        ) : props.threadCount === 0 ? (
          <p className="muted">{props.error ?? "No recent threads."}</p>
        ) : !conversation ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="project">{thread?.projectTitle}</div>
            {conversation.prompt && <div className="prompt">You: {conversation.prompt.text}</div>}
            {replies.length === 0 && !isWorking(thread!.status) && <p className="muted">No reply yet.</p>}
            {replies.map((item, index) => (
              <div
                key={item.itemId}
                ref={index === replies.length - 1 ? lastReplyRef : undefined}
                className={`reply${index === replies.length - 1 ? " final" : ""}`}
              >
                <Markdown>{item.text ?? ""}</Markdown>
                {item.textTruncated && <div className="muted small">… (truncated, open T3 for the rest)</div>}
              </div>
            ))}
            {isWorking(thread!.status) && (
              <div className="working">
                <span className="spinner" /> Working…
              </div>
            )}
          </>
        )}
      </div>

      <div className="composer">
        <textarea
          ref={props.inputRef}
          rows={1}
          value={props.draft}
          placeholder={thread ? `Reply to ${thread.title}…` : "Reply…"}
          disabled={!thread || props.sending}
          onChange={(e) => props.onDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="hints">
        {props.sending ? (
          <span>sending…</span>
        ) : (
          <>
            <span title={MODE_HELP[props.sendMode]}>
              <span className="key">↵</span> {props.sendMode}
            </span>
            <span title={MODE_HELP[other]}>
              <span className="key">⌃↵</span> {other}
            </span>
          </>
        )}
        {props.navHotkeys && props.threadCount > 1 && (
          <span title="Scrolling over the tabs works too">
            <span className="key">{shortKey(props.navHotkeys[0])}</span>
            <span className="key">{shortKey(props.navHotkeys[1])}</span> threads
          </span>
        )}
        {props.voiceHotkey && (
          <span>
            hold <span className="key">{shortKey(props.voiceHotkey)}</span> talk
          </span>
        )}
        <UpdateControl version={props.update.version} status={props.update.status} />
      </div>
      {props.sendError && <div className="send-error">{props.sendError}</div>}
      {props.footer}
    </>
  );
}
