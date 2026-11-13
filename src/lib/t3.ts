// T3 Code data access over the MCP tools (t3_project_list, t3_thread_list, t3_thread_read,
// t3_thread_send). Shapes follow @t3tools/contracts' orchestratorMcp schemas.
import { native } from "./native";

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

interface Project {
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

async function listProjects(): Promise<Project[]> {
  if (projectCache && Date.now() - projectCache.at < 60_000) return projectCache.projects;
  const result = await native.t3Call<{ projects: Project[] }>("t3_project_list", { limit: 100 });
  const projects = result.projects.filter((p) => !p.deletedAt);
  projectCache = { at: Date.now(), projects };
  return projects;
}

/** Top-level threads updated in the last `hours`, newest first. */
export async function listRecentThreads(hours: number, max = 8): Promise<Thread[]> {
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
      if (result.projectId === null) {
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
          .then((r) => r.threads)
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
    items.push(...result.items);
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
  return { prompt, replies, replyKey: last ? `${last.itemId}@${last.updatedAt}` : null };
}

export async function sendMessage(threadId: string, message: string) {
  return native.t3Call<{ delivery: string; status: string }>("t3_thread_send", {
    threadId,
    message,
    mode: "auto",
    clientRequestId: crypto.randomUUID(),
  });
}
