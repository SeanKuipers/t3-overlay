import { useEffect, useState } from "react";
import { on, type GameState } from "./native";

const IDLE: GameState = { inGame: false, dead: false, respawnSeconds: 0, gameEnded: false, gameTime: 0 };

export interface Game extends GameState {
  /** Epoch ms when you respawn, while dead. */
  respawnAt: number | null;
  /** Longest respawn timer seen during this death, for the progress bar. */
  respawnTotal: number;
}

export function useGame(): Game {
  const [game, setGame] = useState<Game>({ ...IDLE, respawnAt: null, respawnTotal: 0 });
  useEffect(
    () =>
      on<GameState>("game://state", (state) =>
        setGame((prev) => ({
          ...state,
          respawnAt: state.dead ? Date.now() + state.respawnSeconds * 1000 : null,
          respawnTotal: state.dead ? Math.max(prev.dead ? prev.respawnTotal : 0, state.respawnSeconds) : 0,
        })),
      ),
    [],
  );
  return game;
}

/** Re-renders every `ms` while `active`. */
export function useTicker(active: boolean, ms = 250) {
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [active, ms]);
}
