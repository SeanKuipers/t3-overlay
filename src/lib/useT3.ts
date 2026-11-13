import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, isT3Error, native, on, type ConnectionStatus, type SendMode } from "./native";
import {
  isWorking,
  listRecentThreads,
  readConversation,
  sendMessage,
  type Conversation,
  type Thread,
} from "./t3";

export interface ThreadView extends Thread {
  conversation: Conversation | null;
  unread: boolean;
}

export interface Notice {
  id: number;
  threadId: string;
  title: string;
  text: string;
}

const SEEN_KEY = "t3-overlay:seen";
const startedAt = Date.now();

function loadSeen(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function firstLine(text: string, max = 140) {
  const line = text.replace(/[#*_`>]/g, "").split("\n").find((l) => l.trim()) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Polls T3 for recent threads, tracks unread replies, and raises notices when agents finish. */
export function useT3(pollSeconds: number, recentHours: number) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [threads, setThreads] = useState<ThreadView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const seen = useRef<Record<string, string>>(loadSeen());
  // On the very first run, replies that already existed are not "new".
  const firstRun = useRef(Object.keys(seen.current).length === 0);
  const cache = useRef(new Map<string, { updatedAt: string; conversation: Conversation }>());
  const lastStatus = useRef(new Map<string, string>());
  const noticeId = useRef(0);

  useEffect(() => {
    native.t3Status().then(setStatus);
    return on<ConnectionStatus>("t3://connection", (s) => {
      setStatus(s);
      setError(null);
    });
  }, []);

  const persistSeen = () => localStorage.setItem(SEEN_KEY, JSON.stringify(seen.current));

  const refresh = useCallback(async () => {
    if (!status?.connected) return;
    try {
      const list = await listRecentThreads(recentHours);
      const views: ThreadView[] = [];
      for (const thread of list) {
        let cached = cache.current.get(thread.threadId);
        if (!cached || cached.updatedAt !== thread.updatedAt) {
          try {
            const conversation = await readConversation(thread);
            cached = { updatedAt: thread.updatedAt, conversation };
            cache.current.set(thread.threadId, cached);
          } catch {
            // Keep the previous read if this one fails.
          }
        }
        const conversation = cached?.conversation ?? null;
        const key = conversation?.replyKey ?? null;
        if (key && firstRun.current && !(thread.threadId in seen.current) && Date.parse(thread.updatedAt) < startedAt) {
          seen.current[thread.threadId] = key;
        }
        const unread = !!key && !isWorking(thread.status) && seen.current[thread.threadId] !== key;

        const previous = lastStatus.current.get(thread.threadId);
        if (previous && isWorking(previous as Thread["status"]) && !isWorking(thread.status) && unread) {
          const reply = conversation?.replies.at(-1)?.text ?? "";
          const id = ++noticeId.current;
          setNotices((n) => [...n.slice(-2), { id, threadId: thread.threadId, title: thread.title, text: firstLine(reply) }]);
          setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 7000);
        }
        lastStatus.current.set(thread.threadId, thread.status);
        views.push({ ...thread, conversation, unread });
      }
      persistSeen();
      setThreads(views);
      setError(null);
    } catch (e) {
      if (isT3Error(e) && e.kind === "unauthorized") {
        setStatus((s) => (s ? { ...s, connected: false } : s));
      }
      setError(errorMessage(e));
    }
  }, [status?.connected, recentHours]);

  useEffect(() => {
    if (!status?.connected) return;
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      await refresh();
      if (!stopped) timer = window.setTimeout(tick, pollSeconds * 1000);
    };
    tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [refresh, pollSeconds, status?.connected]);

  const markRead = useCallback((threadId: string) => {
    setThreads((list) =>
      list.map((t) => {
        if (t.threadId !== threadId || !t.unread) return t;
        const key = t.conversation?.replyKey;
        if (key) seen.current[threadId] = key;
        persistSeen();
        return { ...t, unread: false };
      }),
    );
  }, []);

  const send = useCallback(
    async (threadId: string, text: string, mode: SendMode) => {
      const result = await sendMessage(threadId, text, mode);
      // Show it as working right away; the next poll fills in the details.
      setThreads((list) =>
        list.map((t) => (t.threadId === threadId ? { ...t, status: "running", unread: false } : t)),
      );
      lastStatus.current.set(threadId, "running");
      window.setTimeout(refresh, 800);
      return result;
    },
    [refresh],
  );

  return { status, threads, error, notices, markRead, send, refresh };
}
