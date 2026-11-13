// Browser-only preview with fake T3 + game data: `npm run dev`, then open
// http://localhost:1420/?mock=dead (or alive, ended, settings). Not included in builds.
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";

const now = Date.now();
const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();

const threads = [
  { threadId: "t1", projectId: "p1", title: "api-refactor", status: "completed", parentThreadId: null, itemCount: 40, createdAt: iso(90), updatedAt: iso(1) },
  { threadId: "t2", projectId: "p2", title: "t3-overlay", status: "running", parentThreadId: null, itemCount: 120, createdAt: iso(60), updatedAt: iso(0) },
  { threadId: "t3", projectId: "p1", title: "fix-tests", status: "idle", parentThreadId: null, itemCount: 12, createdAt: iso(300), updatedAt: iso(200) },
];

const reads: Record<string, unknown[]> = {
  t1: [
    { position: 30, itemId: "u1", type: "user_message", status: "completed", text: "split the router, keep the public API the same", textTruncated: false, createdBy: "user", updatedAt: iso(10) },
    { position: 38, itemId: "a1", type: "assistant_message", status: "completed", text: "Done. Split `router.ts` into three modules:\n\n- `routes/users.ts` and `routes/billing.ts`\n- `routes/index.ts` re-exports everything, so the public API is unchanged\n\nAll **142 tests** pass. Want me to also migrate the auth middleware to the new layout?", textTruncated: false, createdBy: "agent", updatedAt: iso(1) },
  ],
  t2: [
    { position: 100, itemId: "u2", type: "user_message", status: "completed", text: "add a settings window for the hotkeys", textTruncated: false, createdBy: "user", updatedAt: iso(5) },
    { position: 110, itemId: "a2", type: "assistant_message", status: "completed", text: "Adding a hotkey recorder to the settings window now.", textTruncated: false, createdBy: "agent", updatedAt: iso(0) },
  ],
  t3: [
    { position: 5, itemId: "u3", type: "user_message", status: "completed", text: "why does CI fail", textTruncated: false, createdBy: "user", updatedAt: iso(210) },
    { position: 11, itemId: "a3", type: "assistant_message", status: "completed", text: "A snapshot test depended on the local timezone. Pinned it to UTC; CI is green.", textTruncated: false, createdBy: "agent", updatedAt: iso(200) },
  ],
};

export async function installMock(scenario: string) {
  localStorage.clear();
  mockIPC(
    (cmd, payload) => {
      const args = payload as Record<string, any>;
      switch (cmd) {
        case "get_config":
          return { serverUrl: "http://100.88.0.1:3773", hotkeyInbox: "Ctrl+Shift+Space", hotkeyVoice: "Ctrl+Shift+V", voiceEnabled: true, hotkeyPrev: "Ctrl+Shift+Q", hotkeyNext: "Ctrl+Shift+E", openOnDeath: true, openOnGameEnd: true, tickerOutsideGame: true, recentHours: 2, pollSeconds: 4, autoUpdate: true, sendMode: "queue", hubMode: "client", settingsVersion: 2 };
        case "t3_status":
          return { serverUrl: "http://100.88.0.1:3773", connected: true, expiresAtMs: now + 29 * 86_400_000 };
        case "t3_call": {
          const a = args.args;
          if (args.tool === "t3_project_list") return { projects: [{ id: "p1", title: "backend", deletedAt: null }, { id: "p2", title: "t3-overlay", deletedAt: null }] };
          if (args.tool === "t3_thread_list") {
            if (a.allProjects) return { projectId: null, threads, nextCursor: null, total: 3 };
            return { projectId: a.projectId, threads: threads.filter((t) => t.projectId === a.projectId), nextCursor: null, total: 1 };
          }
          if (args.tool === "t3_thread_read") return { items: reads[a.threadId] ?? [], nextPosition: null, hasMore: false };
          if (args.tool === "t3_thread_send") return { delivery: "started", status: "running" };
          return null;
        }
        case "game_state":
          return { inGame: false, dead: false, respawnSeconds: 0, gameEnded: false, gameTime: 0, clientOpen: false };
        case "hex_status":
          return "idle";
        case "plugin:app|version":
          return "0.1.12";
        case "update_status":
          return scenario === "dead" ? { phase: "ready", version: "0.1.7" } : { phase: "upToDate" };
        case "take_update_notice":
          return scenario === "alive" ? { version: "0.1.12", notes: "Keep the overlay above the game" } : null;
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
  // Make t1 count as a fresh, unread reply.
  localStorage.setItem("t3-overlay:seen", JSON.stringify({ t3: "a3@" + iso(200) }));
  const game =
    scenario === "hub" || scenario === "hubchat"
      ? { inGame: false, dead: false, respawnSeconds: 0, gameEnded: false, gameTime: 0, clientOpen: true }
      : scenario === "dead"
      ? { inGame: true, dead: true, respawnSeconds: 23, gameEnded: false, gameTime: 1085 }
      : scenario === "ended"
        ? { inGame: true, dead: false, respawnSeconds: 0, gameEnded: true, gameTime: 1900 }
        : { inGame: true, dead: false, respawnSeconds: 0, gameEnded: false, gameTime: 870 };
  setTimeout(() => {
    emit("game://state", { ...game, respawnSeconds: game.dead ? 32 : 0 });
    setTimeout(() => emit("game://state", game), 50);
    if (scenario === "voice") emit("voice://state", { phase: "recording" });
    if (scenario === "hubchat") setTimeout(() => emit("hotkey://inbox", null), 400);
  }, 300);
}
