// Typed wrappers around the Rust commands and events.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface Config {
  serverUrl: string;
  hotkeyInbox: string;
  hotkeyVoice: string;
  voiceEnabled: boolean;
  openOnDeath: boolean;
  openOnGameEnd: boolean;
  tickerOutsideGame: boolean;
  recentHours: number;
  pollSeconds: number;
}

export interface ConnectionStatus {
  serverUrl: string;
  connected: boolean;
  expiresAtMs: number | null;
}

export interface GameState {
  inGame: boolean;
  dead: boolean;
  respawnSeconds: number;
  gameEnded: boolean;
  gameTime: number;
}

export type VoiceEvent =
  | { phase: "recording" }
  | { phase: "transcribing" }
  | { phase: "transcript"; text: string }
  | { phase: "cancelled" }
  | { phase: "error"; message: string };

export interface T3Error {
  kind: "unauthorized" | "tool" | "network";
  message: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const native = {
  getConfig: () => invoke<Config>("get_config"),
  saveConfig: (config: Config) => invoke<Config>("save_config", { config }),
  t3Status: () => invoke<ConnectionStatus>("t3_status"),
  t3Connect: (serverUrl: string) => invoke<ConnectionStatus>("t3_connect", { serverUrl }),
  t3Disconnect: () => invoke<ConnectionStatus>("t3_disconnect"),
  t3Call: <T>(tool: string, args: Record<string, unknown>) => invoke<T>("t3_call", { tool, args }),
  setHitRegions: (regions: Rect[]) => invoke<void>("set_hit_regions", { regions }),
  focusOverlay: () => invoke<void>("overlay_focus"),
  releaseOverlay: () => invoke<void>("overlay_release"),
  openSettings: () => invoke<void>("open_settings"),
  hexStatus: () => invoke<string>("hex_status"),
  voiceCancel: () => invoke<void>("voice_cancel"),
};

export function on<T>(event: string, handler: (payload: T) => void): () => void {
  let unlisten: UnlistenFn | undefined;
  let cancelled = false;
  listen<T>(event, (e) => handler(e.payload)).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

export function isT3Error(value: unknown): value is T3Error {
  return typeof value === "object" && value !== null && "kind" in value && "message" in value;
}

export function errorMessage(value: unknown): string {
  if (isT3Error(value)) return value.message;
  if (value instanceof Error) return value.message;
  return String(value);
}
