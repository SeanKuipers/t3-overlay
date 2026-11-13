// T3 Code data access over the MCP tools (t3_project_list, t3_thread_list, t3_thread_read,
// t3_thread_send). Shapes follow @t3tools/contracts' orchestratorMcp schemas.
import { native, type SendMode } from "./native";

export type ThreadStatus =
  | "idle"
  | "preparing"
  | "queued"
  | "starting"
  | "running"
  | "waiting"
  | "completed"
  | "interrupted"
  | "failed"
  | "cancelled"
  | "rolled_back";

export interface ThreadListItem {
  threadId: string;
  projectId: string;
  title: string;
  status: ThreadStatus;
  parentThreadId: string | null;
  itemCount: number;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ThreadListResult {
  projectId: string | null;
  threads: ThreadListItem[];
  nextCursor: number | null;
}

export interface Project {
  id: string;
  title: string;
  deletedAt: string | null;
}

export interface TimelineItem {
  position: number;
  itemId: string;
  type: string;
  status: string;
  text: string | null;
  textTruncated: boolean;
  createdBy: string | null;
  updatedAt: string;
}

interface ThreadReadResult {
  thread?: { activeRunId: string | null };
  recentRuns?: { status: string; requestedAt: string; startedAt: string | null }[];
  items: TimelineItem[];
  nextPosition: number | null;
  hasMore: boolean;
}

export interface Thread extends ThreadListItem {
  projectTitle: string;
}

export interface Conversation {
  /** Your latest message, when it is within the window that was read. */
  prompt: TimelineItem | null;
  /** The agent's messages after it, oldest first. */
  replies: TimelineItem[];
  /** Identifies the newest reply, for unread tracking. */
  replyKey: string | null;
  /** When the latest run started (for "working 4m"). */
  runStartedAt: string | null;
}

/** A question an agent is waiting on (T3's ask-the-user request). */
export interface PendingQuestion {
  id: string;
  header: string;
  question: string;
  options: { label: string; description: string; value?: string }[];
  multiSelect?: boolean;
  allowCustomAnswer?: boolean;
  initialAnswer?: string;
  required?: boolean;
}

export interface PendingRequest {
  requestId: string;
  questions: PendingQuestion[];
}

/** A message waiting to run as the thread's next turn. */
export interface QueuedMessage {
  queuedRunId: string;
  text: string;
  truncated: boolean;
}

export const WORKING: ReadonlySet<ThreadStatus> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

export const isWorking = (status: ThreadStatus) => WORKING.has(status);

let projectCache: { at: number; projects: Project[] } | null = null;
let allProjectsSupported: boolean | null = null;

export async function listProjects(): Promise<Project[]> {
  if (projectCache && Date.now() - projectCache.at < 60_000) return projectCache.projects;
  const result = await native.t3Call<{ projects: Project[] }>("t3_project_list", { limit: 100 });
  const projects = (result?.projects ?? []).filter((p) => !p.deletedAt);
  projectCache = { at: Date.now(), projects };
  return projects;
}

/** Top-level threads updated in the last `hours`, newest first. */
export async function listRecentThreads(hours: number, max = 6): Promise<Thread[]> {
  const projects = await listProjects();
  const titles = new Map(projects.map((p) => [p.id, p.title]));
  const since = Date.now() - hours * 3_600_000;
  let threads: ThreadListItem[] = [];

  // Newer servers list every project in one call; older ones need a project id.
  if (allProjectsSupported !== false) {
    try {
      const result = await native.t3Call<ThreadListResult>("t3_thread_list", {
        allProjects: true,
        limit: 50,
      });
      // Only usable if every item says which project it's in; otherwise list per project.
      if (result.projectId === null && (result.threads ?? []).every((t) => typeof t.projectId === "string")) {
        allProjectsSupported = true;
        threads = result.threads;
      } else {
        allProjectsSupported = false;
      }
    } catch {
      allProjectsSupported = false;
    }
  }
  if (!allProjectsSupported) {
    const pages = await Promise.all(
      projects.map((p) =>
        native
          .t3Call<ThreadListResult>("t3_thread_list", { projectId: p.id, limit: 15 })
          // List items don't carry their project id; the per-project result does.
          .then((r) => (r.threads ?? []).map((t) => ({ ...t, projectId: t.projectId ?? p.id })))
          .catch(() => [] as ThreadListItem[]),
      ),
    );
    threads = pages.flat();
  }

  return threads
    .filter((t) => t.parentThreadId === null && !t.archived)
    .filter((t) => Date.parse(t.updatedAt) >= since || isWorking(t.status))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, max)
    .map((t) => ({ ...t, projectTitle: titles.get(t.projectId) ?? "" }));
}

const WINDOW = 80;
const MESSAGE_TYPES = new Set(["user_message", "assistant_message", "plan"]);

/** Reads the latest exchange: your last message and the agent's replies after it. */
export async function readConversation(thread: Thread): Promise<Conversation> {
  const items: TimelineItem[] = [];
  let runStartedAt: string | null = null;
  let afterPosition: number | undefined =
    thread.itemCount > WINDOW ? thread.itemCount - WINDOW : undefined;
  for (let page = 0; page < 4; page++) {
    const result = await native.t3Call<ThreadReadResult>("t3_thread_read", {
      threadId: thread.threadId,
      view: "messages",
      limit: 100,
      maxCharsPerItem: 8000,
      runLimit: 1,
      ...(afterPosition === undefined ? {} : { afterPosition }),
    });
    items.push(...(result.items ?? []));
    const run = result.recentRuns?.[0];
    if (page === 0 && run) runStartedAt = run.startedAt ?? run.requestedAt;
    if (!result.hasMore || result.nextPosition === null || afterPosition === undefined) break;
    afterPosition = result.nextPosition;
  }

  const byPosition = new Map(items.map((i) => [i.position, i]));
  const ordered = [...byPosition.values()]
    .filter((i) => MESSAGE_TYPES.has(i.type) && (i.text ?? "").trim() !== "")
    .sort((a, b) => a.position - b.position);
  let promptIndex = -1;
  ordered.forEach((item, index) => {
    if (item.type === "user_message") promptIndex = index;
  });
  const prompt = promptIndex >= 0 ? ordered[promptIndex] : null;
  const replies = ordered.slice(promptIndex + 1).filter((i) => i.type !== "user_message");
  const last = replies.at(-1);
  return { prompt, replies, replyKey: last ? `${last.itemId}@${last.updatedAt}` : null, runStartedAt };
}

/**
 * Starts a new chat: a top-level thread in `projectId` (or a scratch folder when null) with
 * `message` as its first prompt. Asks for full access, like your other threads; if T3 won't
 * allow that for this client, it falls back to T3's default mode.
 */
export async function launchThread(projectId: string | null, message: string): Promise<string> {
  const firstLine = message.split("\n").find((l) => l.trim())?.trim() ?? "New chat";
  const title = firstLine.length > 60 ? `${firstLine.slice(0, 59)}…` : firstLine;
  const target = projectId ? { projectId } : { scratch: true };
  const launch = (extra: Record<string, unknown>) =>
    native.t3Call<{ threadId: string; projectId: string }>("t3_thread_launch", { ...target, title, message, ...extra });
  try {
    return (await launch({ runtimeMode: "full-access" })).threadId;
  } catch (e) {
    const text = JSON.stringify(e).toLowerCase();
    if (!text.includes("mode") && !text.includes("access")) throw e;
    return (await launch({})).threadId;
  }
}

/** Messages queued behind the running turn, in send order. Empty on servers without queues. */
export async function listQueue(threadId: string): Promise<QueuedMessage[]> {
  const result = await native.t3Call<{ items: QueuedMessage[] }>("t3_queue", { action: "list", threadId, limit: 10 });
  return result?.items ?? [];
}

export function cancelQueued(threadId: string, queuedRunId: string) {
  return native.t3Call("t3_queue", { action: "cancel", threadId, queuedRunId });
}

/** Sends a queued message into the running turn now, like T3's "Steer" button. */
export async function steerQueued(threadId: string, queuedRunId: string) {
  const read = await native.t3Call<ThreadReadResult>("t3_thread_read", { threadId, view: "messages", limit: 1, runLimit: 1 });
  const targetRunId = read.thread?.activeRunId;
  if (!targetRunId) throw new Error("The agent isn't working any more; the message will run next.");
  return native.t3Call("t3_queue", { action: "promote_to_steer", threadId, queuedRunId, targetRunId });
}

/** Ids of the questions a thread's agent is waiting on. (Approvals are not listed.) */
export async function listPendingIds(threadId: string): Promise<string[]> {
  const result = await native.t3Call<{ requestIds: string[] }>("t3_pending_request", { action: "list", threadId });
  return result?.requestIds ?? [];
}

export async function readPending(threadId: string, requestId: string): Promise<PendingRequest> {
  const r = await native.t3Call<Partial<PendingRequest>>("t3_pending_request", { action: "read", threadId, requestId });
  // Defensive: never let an unexpected shape take the overlay down.
  return {
    requestId: r?.requestId ?? requestId,
    questions: (r?.questions ?? []).map((q) => ({ ...q, options: q.options ?? [] })),
  };
}

/** `answers`: question id → option value(s) or your own text, the way T3's UI sends them. */
export function answerPending(threadId: string, requestId: string, answers: Record<string, string | string[]>) {
  return native.t3Call("t3_pending_request", { action: "respond", threadId, requestId, answers });
}

export async function sendMessage(threadId: string, message: string, mode: SendMode) {
  return native.t3Call<{ delivery: string; status: string; runId?: string }>("t3_thread_send", {
    threadId,
    message,
    mode,
    clientRequestId: crypto.randomUUID(),
  });
}
