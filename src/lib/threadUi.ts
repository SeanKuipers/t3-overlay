// Small display helpers shared by the inbox and the hub.
import type { SendMode } from "./native";
import { isWorking } from "./t3";
import type { ThreadView } from "./useT3";

export function dotClass(t: ThreadView) {
  if (isWorking(t.status)) return "dot run";
  if (t.unread) return "dot new";
  if (t.status === "failed" || t.status === "interrupted") return "dot fail";
  return "dot idle";
}

/** "Ctrl+Shift+Q" → "⌃⇧Q". */
export function shortKey(hotkey: string) {
  return hotkey.replace(/Ctrl/g, "⌃").replace(/Shift/g, "⇧").replace(/Alt/g, "⌥").replace(/\+/g, "");
}

/** "now", "5m", "3h", "2d". */
export function relativeTimeShort(iso: string, now = Date.now()) {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/** The second line of a roster row: the newest reply, else your last message. */
export function previewLine(t: ThreadView, max = 120) {
  const c = t.conversation;
  const reply = c?.replies.at(-1)?.text;
  const raw = reply ?? (c?.prompt?.text ? `You: ${c.prompt.text}` : t.projectTitle);
  const line = raw.replace(/[#*_`>]/g, "").split("\n").find((l) => l.trim())?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export const MODE_HELP: Record<SendMode, string> = {
  queue: "Runs as the next turn, after the agent finishes what it's doing",
  steer: "Added to the turn the agent is working on right now",
  auto: "Starts an idle thread, steers a running one",
};
