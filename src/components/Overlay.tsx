import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, native, on, type Config, type SendMode, type VoiceEvent } from "../lib/native";
import { isWorking } from "../lib/t3";
import { useGame } from "../lib/useGame";
import { useHitRegions } from "../lib/useHitRegions";
import { useT3 } from "../lib/useT3";
import { useCornerDrag } from "../lib/useCornerDrag";
import { useUpdate } from "../lib/useUpdate";
import { UpdatePill } from "./UpdateControl";
import { Hub } from "./Hub";
import { Inbox } from "./Inbox";
import { Notices, type NoticeView } from "./Notices";
import { Ticker } from "./Ticker";
import { VoiceHud, type VoiceView } from "./VoiceHud";

const DRAFTS_KEY = "t3-overlay:drafts";

export function Overlay() {
  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => {
    native.getConfig().then(setConfig);
    return on<Config>("config://changed", setConfig);
  }, []);

  // "The page is alive and React rendered": Settings → Diagnostics shows its age.
  useEffect(() => {
    const ping = () => native.overlayReport("heartbeat").catch(() => {});
    ping();
    const id = window.setInterval(ping, 5000);
    return () => window.clearInterval(id);
  }, []);

  const game = useGame();
  const update = useUpdate();
  const t3 = useT3(config?.pollSeconds ?? 4, config?.recentHours ?? 2);

  // `pinned`: opened with the hotkey; open until you send, or close it (Esc / × / hotkey).
  // `deathOpen`: opened because you died. On respawn it closes, unless you've started
  // typing a reply; then it stays (keyboard back to League) until you send or close it.
  const [pinned, setPinned] = useState(false);
  const [deathOpen, setDeathOpen] = useState(false);
  // The – button: the inbox stays "open" (draft, thread, death state) but shrinks to a pill.
  const [minimized, setMinimized] = useState(false);
  const [focused, setFocused] = useState(document.hasFocus());
  const [endDismissed, setEndDismissed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Drafts survive restarts (e.g. an update mid-game).
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}");
    } catch {
      return {};
    }
  });
  useEffect(() => {
    const kept = Object.fromEntries(Object.entries(drafts).filter(([, d]) => d.trim()));
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(kept));
  }, [drafts]);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [voice, setVoice] = useState<VoiceView | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const voiceTarget = useRef<{ id: string; title: string } | null>(null);
  const voiceTimer = useRef<number | undefined>(undefined);

  const visible = pinned || deathOpen || (game.gameEnded && !!config?.openOnGameEnd && !endDismissed);

  // Outside games the chat hub docks on the left instead of the floating inbox.
  const hubMode = config?.hubMode ?? "client";
  /** League, TFT or any fullscreen app: the in-game overlay (ticker, inbox) instead of the hub. */
  const inGameMode = game.inGame || game.fullscreenApp;
  const hubFor = (g: { inGame: boolean; clientOpen: boolean; fullscreenApp: boolean }) =>
    !g.inGame && !g.fullscreenApp && hubMode !== "off" && (hubMode === "always" || g.clientOpen);
  const hubShown = !!config && hubFor(game);
  const [hubChat, setHubChat] = useState(false);
  const inboxVisible = visible && !hubShown;
  /** The full inbox card is up (not minimized to its pill). */
  const inboxExpanded = inboxVisible && !minimized;
  /** A conversation is on screen (the inbox, or the hub's chat pane). */
  const viewing = inboxExpanded || (hubShown && hubChat);
  const openRef = useRef(false);
  openRef.current = pinned || deathOpen;

  // Keyboard focus tracking.
  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Death / respawn / new game edges.
  const prev = useRef(game);
  useEffect(() => {
    const was = prev.current;
    if (!was.dead && game.dead && config?.openOnDeath) {
      setDeathOpen(true);
      setMinimized(false);
      // An agent waiting on a question goes first.
      const asking = threadsRef.current.find((t) => t.questions.length > 0);
      if (asking) setSelectedId(asking.threadId);
    }
    if (was.dead && !game.dead) {
      // Respawned: close, unless a reply is half-typed. Either way, keyboard back to League.
      // Typing: keep it, but shrunk to the pill so it's out of the way.
      const typing = Object.values(draftsRef.current).some((d) => d.trim());
      if (typing) setMinimized(true);
      else setDeathOpen(false);
      if (document.hasFocus()) native.releaseOverlay();
    }
    if (!was.inGame && game.inGame) setEndDismissed(false);
    // Left the game (or fullscreen app): whatever was open in the inbox carries over into the hub.
    if (config && !hubFor(was) && hubFor(game)) {
      if (openRef.current) setHubChat(true);
      setPinned(false);
      setDeathOpen(false);
    }
    prev.current = game;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, config?.openOnDeath, hubMode]);

  // Keep a valid selection: first unread, else the newest thread.
  useEffect(() => {
    if (t3.threads.length === 0) return;
    if (!selectedId || !t3.threads.some((t) => t.threadId === selectedId)) {
      setSelectedId((t3.threads.find((t) => t.unread) ?? t3.threads[0]).threadId);
    }
  }, [t3.threads, selectedId]);

  const selected = t3.threads.find((t) => t.threadId === selectedId) ?? null;

  // Reading a thread in the open inbox marks it read.
  useEffect(() => {
    if (viewing && selected?.unread) t3.markRead(selected.threadId);
  }, [viewing, selected?.threadId, selected?.unread, t3.markRead]);

  const close = useCallback(() => {
    setPinned(false);
    setDeathOpen(false);
    setMinimized(false);
    if (game.gameEnded) setEndDismissed(true);
    if (document.hasFocus()) native.releaseOverlay();
  }, [game.gameEnded]);
  const closeRef = useRef(close);
  closeRef.current = close;
  const inGameRef = useRef(game.inGame || game.fullscreenApp);
  inGameRef.current = game.inGame || game.fullscreenApp;

  const focusInput = useCallback(async () => {
    await native.focusOverlay();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const closeHubChat = useCallback(() => {
    setHubChat(false);
    if (document.hasFocus()) native.releaseOverlay();
  }, []);

  // Inbox hotkey / tray: a plain toggle. Open (and focus the reply box), or close.
  // With the hub showing, it opens/closes the hub's chat pane instead.
  useEffect(
    () =>
      on("hotkey://inbox", () => {
        if (hubShown) {
          if (hubChat) closeHubChat();
          else {
            setHubChat(true);
            focusInput();
          }
        } else if (inboxExpanded) close();
        else {
          setPinned(true);
          setMinimized(false);
          focusInput();
        }
      }),
    [hubShown, hubChat, inboxExpanded, close, closeHubChat, focusInput],
  );
  // Esc closes the inbox, focused or not (registered only while it's open).
  useEffect(() => on("hotkey://close", () => inboxExpanded && close()), [inboxExpanded, close]);

  // Thread-switching hotkeys (and global Esc) exist only while the in-game inbox is up,
  // not while it's minimized: then League gets those keys back.
  useEffect(() => {
    native.setNavHotkeys(inboxExpanded);
  }, [inboxExpanded]);

  const minimize = useCallback(() => {
    setMinimized(true);
    if (document.hasFocus()) native.releaseOverlay();
  }, []);
  const expand = useCallback(() => {
    setMinimized(false);
    focusInput();
  }, [focusInput]);

  const cycle = useCallback(
    (step: number) => {
      if (t3.threads.length === 0) return;
      const index = t3.threads.findIndex((t) => t.threadId === selectedId);
      const next = (index + step + t3.threads.length) % t3.threads.length;
      setSelectedId(t3.threads[next].threadId);
    },
    [t3.threads, selectedId],
  );
  useEffect(() => on<number>("hotkey://cycle", (step) => cycle(step)), [cycle]);

  // Enter uses the configured mode; Ctrl+Enter the other of queue/steer.
  const modeFor = useCallback(
    (threadId: string, alternate: boolean): SendMode => {
      const base = config?.sendMode ?? "queue";
      const mode: SendMode = alternate ? (base === "steer" ? "queue" : "steer") : base;
      // Nothing to steer when the agent isn't working: just start the turn.
      const thread = t3.threads.find((t) => t.threadId === threadId);
      if (mode === "steer" && thread && !isWorking(thread.status)) return "auto";
      return mode;
    },
    [config?.sendMode, t3.threads],
  );

  const sendTo = useCallback(
    async (threadId: string, text: string, alternate = false) => {
      const message = text.trim();
      if (!message) return false;
      setSending(true);
      setSendError(null);
      try {
        await t3.send(threadId, message, modeFor(threadId, alternate));
        return true;
      } catch (e) {
        setSendError(errorMessage(e));
        return false;
      } finally {
        setSending(false);
      }
    },
    [t3.send, modeFor],
  );

  const submit = useCallback(async (alternate: boolean) => {
    if (!selected) return;
    const ok = await sendTo(selected.threadId, drafts[selected.threadId] ?? "", alternate);
    if (!ok) return;
    setDrafts((d) => ({ ...d, [selected.threadId]: "" }));
    // Sent: close and go straight back to the game.
    if (inGameMode) close();
  }, [selected, drafts, sendTo, inGameMode, close]);

  // Voice: Hex records while the key is held; the transcript goes to the target thread.
  const threadsRef = useRef(t3.threads);
  threadsRef.current = t3.threads;
  const visibleRef = useRef(viewing);
  visibleRef.current = viewing;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(
    () =>
      on<VoiceEvent>("voice://state", async (event) => {
        window.clearTimeout(voiceTimer.current);
        const hideLater = (ms: number) => {
          voiceTimer.current = window.setTimeout(() => setVoice(null), ms);
        };
        switch (event.phase) {
          case "recording": {
            const list = threadsRef.current;
            const target =
              (visibleRef.current && selectedRef.current) || list.find((t) => t.unread) || list[0];
            voiceTarget.current = target ? { id: target.threadId, title: target.title } : null;
            setVoice({ phase: "recording", target: target?.title });
            break;
          }
          case "transcribing":
            setVoice((v) => ({ phase: "transcribing", target: v?.target }));
            break;
          case "transcript": {
            const target = voiceTarget.current;
            if (!target) {
              setVoice({ phase: "error", text: event.text, message: "No T3 thread to send to." });
              hideLater(5000);
              break;
            }
            setVoice({ phase: "sending", target: target.title, text: event.text });
            const ok = await sendTo(target.id, event.text);
            setVoice(
              ok
                ? { phase: "sent", target: target.title, text: event.text }
                : { phase: "error", target: target.title, text: event.text, message: "Sending failed." },
            );
            hideLater(ok ? 3500 : 6000);
            // A voice reply counts as sending too: close the inbox if it was open.
            if (ok && visibleRef.current && inGameRef.current) closeRef.current();
            break;
          }
          case "cancelled":
            setVoice(null);
            break;
          case "error":
            setVoice({ phase: "error", message: event.message });
            hideLater(5000);
            break;
        }
      }),
    [sendTo],
  );

  // Updates install only while the overlay isn't in use.
  const busy = inboxExpanded || !!voice || sending || (hubShown && hubChat && focused);
  useEffect(() => {
    native.setOverlayBusy(busy);
  }, [busy]);

  // After an update restart, say so briefly.
  const [updateNotice, setUpdateNotice] = useState<NoticeView | null>(null);
  useEffect(() => {
    native.takeUpdateNotice().then((n) => {
      if (!n) return;
      const firstLine = n.notes.split("\n").find((l) => l.trim()) ?? "";
      setUpdateNotice({ id: "update", title: `T3 Overlay updated to v${n.version}`, text: firstLine });
      window.setTimeout(() => setUpdateNotice(null), 8000);
    });
  }, []);
  const notices: NoticeView[] = updateNotice ? [updateNotice, ...t3.notices] : t3.notices;

  // The ticker stays up while the inbox is open too, so it's always there to click.
  // Always on screen, whatever you're playing (it's tiny, and movable).
  const corner = useCornerDrag();

  // Clicking the ticker or a notice opens that thread in the inbox, ready to reply.
  const openThread = useCallback(
    (threadId: string) => {
      setSelectedId(threadId);
      setMinimized(false);
      if (hubShown) setHubChat(true);
      else setPinned(true);
      focusInput();
    },
    [focusInput, hubShown],
  );
  // The ticker toggles: clicking it again closes what it opened.
  const closeView = () => (hubShown ? closeHubChat() : close());

  const openNotice = useCallback(
    (notice: NoticeView) => {
      if (typeof notice.id === "number") t3.dismissNotice(notice.id);
      else setUpdateNotice(null);
      if (notice.threadId) openThread(notice.threadId);
    },
    [t3.dismissNotice, openThread],
  );

  useHitRegions([corner.pos, corner.dragging, inboxVisible, minimized, hubShown, hubChat, t3.threads.length, selectedId, sending]);

  const draft = selected ? drafts[selected.threadId] ?? "" : "";

  // T3's queued-message actions, on the open thread.
  const queueAction = (action: (threadId: string, runId: string) => Promise<void>) => (runId: string) => {
    if (!selected) return;
    setSendError(null);
    action(selected.threadId, runId).catch((e) => setSendError(errorMessage(e)));
  };
  const onSteerQueued = queueAction(t3.steer);
  const onUnqueue = queueAction(t3.unqueue);
  const onAnswer = async (requestId: string, answers: Record<string, string | string[]>) => {
    if (selected) await t3.answer(selected.threadId, requestId, answers);
  };

  return (
    <div className="overlay-root">
      {/* Ticker + notifications: dragged together, placed where you left them. */}
      {corner.dragging && <div className="drag-shield" data-hit />}
      <div
        className="corner"
        style={corner.pos ? { left: corner.pos.x, top: corner.pos.y } : undefined}
        onPointerDown={corner.onPointerDown}
        onClickCapture={corner.onClickCapture}
      >
        <Ticker
          threads={t3.threads}
          connected={!!t3.status?.connected}
          onOpen={(id) => (viewing && id === selectedId ? closeView() : openThread(id))}
          onOpenSettings={() => native.openSettings()}
          onOpenAny={() => {
            if (viewing) return closeView();
            const id = selectedId ?? t3.threads[0]?.threadId;
            if (id) openThread(id);
            else if (hubShown) setHubChat(true);
            else setPinned(true);
          }}
        />
        {!inboxExpanded && <Notices notices={notices} onOpen={openNotice} />}
      </div>
      {hubShown && (
        <Hub
          threads={t3.threads}
          selected={selected}
          chatOpen={hubChat}
          connected={!!t3.status?.connected}
          error={t3.error}
          draft={draft}
          sending={sending}
          sendError={sendError}
          focused={focused}
          inputRef={inputRef}
          voiceHotkey={config?.voiceEnabled ? config.hotkeyVoice : null}
          sendMode={config?.sendMode ?? "queue"}
          update={update}
          navHotkeys={null}
          onOpen={openThread}
          onCloseChat={closeHubChat}
          onCycle={cycle}
          onDraft={(text) => selected && setDrafts((d) => ({ ...d, [selected.threadId]: text }))}
          onSubmit={submit}
          onFocusRequest={focusInput}
          onOpenSettings={() => native.openSettings()}
          onSteerQueued={onSteerQueued}
          onUnqueue={onUnqueue}
          onAnswer={onAnswer}
        />
      )}
      {inboxVisible && (
        <Inbox
          threads={t3.threads}
          selected={selected}
          connected={!!t3.status?.connected}
          error={t3.error}
          game={game}
          draft={draft}
          sending={sending}
          sendError={sendError}
          focused={focused}
          inputRef={inputRef}
          voiceHotkey={config?.voiceEnabled ? config.hotkeyVoice : null}
          sendMode={config?.sendMode ?? "queue"}
          update={update}
          navHotkeys={config && config.hotkeyPrev && config.hotkeyNext ? [config.hotkeyPrev, config.hotkeyNext] : null}
          onSelect={setSelectedId}
          onCycle={cycle}
          onDraft={(text) => selected && setDrafts((d) => ({ ...d, [selected.threadId]: text }))}
          onSubmit={submit}
          onClose={close}
          onFocusRequest={focusInput}
          minimized={minimized}
          onMinimize={minimize}
          onExpand={expand}
          onSteerQueued={onSteerQueued}
          onUnqueue={onUnqueue}
          onAnswer={onAnswer}
        />
      )}
      {voice && <VoiceHud voice={voice} />}
      {!inboxExpanded && <UpdatePill status={update.status} />}
    </div>
  );
}
