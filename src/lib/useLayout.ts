import { useCallback, useEffect, useMemo, useState } from "react";
import type { GameState } from "./native";

// Where the inbox and ticker sit, and how big the inbox is. Each situation (League, TFT,
// other fullscreen games, the desktop) remembers its own; moving or resizing something saves
// it for the situation you're in. Three slots hold layouts to swap between mid-game.

export type Pos = { x: number; y: number };
/** `w` / `h`: null = the default size. */
export type Box = Pos & { w: number | null; h: number | null };
/** null = the default spot. */
export interface Layout {
  inbox: Box | null;
  ticker: Pos | null;
}

export type LayoutContext = "league" | "tft" | "other" | "desktop";
export const CONTEXT_LABEL: Record<LayoutContext, string> = {
  league: "League",
  tft: "TFT",
  other: "this game",
  desktop: "the desktop",
};
export const SLOTS = 3;

interface Store {
  contexts: Partial<Record<LayoutContext, Layout>>;
  slots: (Layout | null)[];
}

const KEY = "t3-overlay:layouts";

function readPos(key: string): Pos | null {
  try {
    const p = JSON.parse(localStorage.getItem(key) ?? "null");
    return typeof p?.x === "number" && typeof p?.y === "number" ? { x: p.x, y: p.y } : null;
  } catch {
    return null;
  }
}

/** Positions saved by versions before layouts: the starting point for every situation. */
function legacy(): Layout {
  const inbox = readPos("t3-overlay:inbox-pos");
  return { inbox: inbox && { ...inbox, w: null, h: null }, ticker: readPos("t3-overlay:ticker-pos") };
}

function load(): Store {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (s && typeof s === "object" && s.contexts && Array.isArray(s.slots)) {
      return { contexts: s.contexts, slots: Array.from({ length: SLOTS }, (_, i) => s.slots[i] ?? null) };
    }
  } catch {}
  return { contexts: {}, slots: Array(SLOTS).fill(null) };
}

/**
 * Which layout applies. TFT sometimes doesn't answer the game API (no mode), and it's the
 * same game window as League, so an in-game window with no mode counts as TFT.
 */
export function contextOf(game: Pick<GameState, "inGame" | "fullscreenApp" | "gameMode">): LayoutContext {
  if (game.inGame) return game.gameMode === "TFT" || game.gameMode === "" ? "tft" : "league";
  if (game.fullscreenApp) return "other";
  return "desktop";
}

export function useLayout(context: LayoutContext) {
  const [store, setStore] = useState(load);
  useEffect(() => localStorage.setItem(KEY, JSON.stringify(store)), [store]);
  const base = useMemo(legacy, []);
  const layout = store.contexts[context] ?? base;

  const update = useCallback(
    (change: Partial<Layout>) =>
      setStore((s) => ({
        ...s,
        contexts: { ...s.contexts, [context]: { ...(s.contexts[context] ?? base), ...change } },
      })),
    [context, base],
  );

  return useMemo(
    () => ({
      context,
      layout,
      slots: store.slots,
      setInbox: (inbox: Box | null) => update({ inbox }),
      setTicker: (ticker: Pos | null) => update({ ticker }),
      /** Puts slot `i`'s layout on screen (and keeps it for this situation). */
      applySlot: (i: number) => {
        const saved = store.slots[i];
        if (saved) update(saved);
      },
      saveSlot: (i: number) => setStore((s) => ({ ...s, slots: s.slots.map((l, j) => (j === i ? layout : l)) })),
      reset: () => update({ inbox: null, ticker: null }),
    }),
    [context, layout, store.slots, update],
  );
}
