import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import {
  errorMessage,
  native,
  on,
  type Config,
  type ConnectionStatus,
  type OverlayDiagnostics,
  type UpdateStatus,
} from "../lib/native";

const MODIFIERS: Record<string, string> = { Control: "Ctrl", Shift: "Shift", Alt: "Alt", Meta: "Super" };

/** Turns a keydown into the "Ctrl+Shift+Space" format the global-shortcut plugin parses. */
function comboFromEvent(e: React.KeyboardEvent): string | null {
  if (e.key in MODIFIERS) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  if (e.metaKey) parts.push("Super");
  const key = e.code.replace(/^Key/, "").replace(/^Digit/, "");
  parts.push(key);
  return parts.join("+");
}

function HotkeyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false);
  return (
    <input
      className={`hotkey${recording ? " recording" : ""}`}
      readOnly
      value={recording ? "Press a key combination…" : value || "(none)"}
      onFocus={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={(e) => {
        e.preventDefault();
        if (e.key === "Escape") return (e.target as HTMLInputElement).blur();
        if (e.key === "Backspace" || e.key === "Delete") {
          onChange("");
          return (e.target as HTMLInputElement).blur();
        }
        const combo = comboFromEvent(e);
        if (combo) {
          onChange(combo);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function Settings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [hex, setHex] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateStatus>({ phase: "idle" });
  const [diag, setDiag] = useState<OverlayDiagnostics | null>(null);
  const checkOverlay = async () => setDiag(await native.overlayDiagnostics());

  useEffect(() => {
    native.getConfig().then(setConfig);
    native.t3Status().then(setStatus);
    getVersion().then(setVersion);
    native.updateStatus().then(setUpdate);
    const offUpdate = on<UpdateStatus>("update://status", setUpdate);
    const offConnection = on<ConnectionStatus>("t3://connection", setStatus);
    return () => {
      offUpdate();
      offConnection();
    };
  }, []);

  if (!config) return <div className="settings">Loading…</div>;
  const set = <K extends keyof Config>(key: K, value: Config[K]) => setConfig({ ...config, [key]: value });

  const save = async () => {
    setBusy("save");
    setMessage(null);
    try {
      setConfig(await native.saveConfig(config));
      setMessage({ kind: "ok", text: "Saved." });
    } catch (e) {
      setMessage({ kind: "err", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    setBusy("connect");
    setMessage({ kind: "ok", text: "Approve the overlay in the browser tab that just opened…" });
    try {
      const s = await native.t3Connect(config.serverUrl);
      setStatus(s);
      setConfig({ ...config, serverUrl: s.serverUrl });
      setMessage({ kind: "ok", text: "Connected to T3 Code." });
    } catch (e) {
      setMessage({ kind: "err", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setStatus(await native.t3Disconnect());
    setMessage({ kind: "ok", text: "Disconnected." });
  };

  const testHex = async () => {
    setHex("Checking…");
    try {
      setHex(`Hex is running (${await native.hexStatus()}).`);
    } catch (e) {
      setHex(errorMessage(e));
    }
  };

  const expires = status?.expiresAtMs ? new Date(status.expiresAtMs).toLocaleDateString() : null;

  return (
    <div className="settings">
      <h1>T3 Overlay</h1>

      <section>
        <h2>T3 Code server</h2>
        <p className="hint">
          The address of the machine running T3 Code, e.g. its Tailscale IP: <code>http://100.x.y.z:3773</code>.
          Connecting opens T3's approval page in your browser. Pick <b>full access</b> there if your threads
          run in full-access mode, otherwise T3 won't let the overlay send to them.
        </p>
        <div className="row">
          <input
            className="grow"
            placeholder="http://100.x.y.z:3773"
            value={config.serverUrl}
            onChange={(e) => set("serverUrl", e.target.value)}
          />
          {status?.connected ? (
            <button onClick={disconnect}>Disconnect</button>
          ) : (
            <button className="primary" disabled={busy === "connect"} onClick={connect}>
              {busy === "connect" ? "Waiting…" : "Connect"}
            </button>
          )}
        </div>
        <p className={`status ${status?.connected ? "ok" : "err"}`}>
          {status?.connected ? `Connected · credential valid until ${expires}` : "Not connected"}
        </p>
      </section>

      <section>
        <h2>Hotkeys</h2>
        <label>
          Open / close inbox
          <HotkeyInput value={config.hotkeyInbox} onChange={(v) => set("hotkeyInbox", v)} />
        </label>
        <label>
          Previous thread
          <HotkeyInput value={config.hotkeyPrev} onChange={(v) => set("hotkeyPrev", v)} />
        </label>
        <label>
          Next thread
          <HotkeyInput value={config.hotkeyNext} onChange={(v) => set("hotkeyNext", v)} />
        </label>
        <p className="hint">
          These two only work while the inbox is open; the rest of the time League keeps those keys. Scrolling over the
          tabs switches threads too.
        </p>
        <label className="check">
          <input type="checkbox" checked={config.voiceEnabled} onChange={(e) => set("voiceEnabled", e.target.checked)} />
          Voice replies with Hex
        </label>
        {config.voiceEnabled && (
          <>
            <label>
              Hold to talk
              <HotkeyInput value={config.hotkeyVoice} onChange={(v) => set("hotkeyVoice", v)} />
            </label>
            <p className="hint">
              The overlay starts and stops <a href="#" onClick={(e) => { e.preventDefault(); openUrl("https://github.com/anomalyco/hex"); }}>Hex</a> itself and
              gets the text back directly. Hex never pastes, so nothing can end up in League chat. Your normal Hex
              shortcut keeps working outside the game.
            </p>
            <div className="row">
              <button onClick={testHex}>Test Hex connection</button>
              {hex && <span className="hint">{hex}</span>}
            </div>
          </>
        )}
        <p className="hint">Avoid keys League uses. Hotkeys are taken from the game while the overlay runs.</p>
      </section>

      <section>
        <h2>Sending</h2>
        <label>
          Enter sends as
          <select value={config.sendMode} onChange={(e) => set("sendMode", e.target.value as Config["sendMode"])}>
            <option value="queue">Queue: next turn, after the current one</option>
            <option value="steer">Steer: into the turn running now</option>
            <option value="auto">Auto: T3 decides</option>
          </select>
        </label>
        <p className="hint">
          <b>Ctrl+Enter</b> sends the other way ({config.sendMode === "steer" ? "queue" : "steer"}). Voice replies use the
          Enter mode. Steering an agent that isn't working just starts a new turn.
        </p>
      </section>

      <section>
        <h2>Chat hub</h2>
        <label>
          Outside games, dock the hub on the left
          <select value={config.hubMode} onChange={(e) => set("hubMode", e.target.value as Config["hubMode"])}>
            <option value="client">While the League client is open</option>
            <option value="always">Always</option>
            <option value="off">Never</option>
          </select>
        </label>
        <p className="hint">
          Your recent threads, with search, docked on the left. Click one to open it beside the list. Drag the edge to
          resize, or collapse it to a thin strip. It hides when a game starts.
        </p>
      </section>

      <section>
        <h2>Behaviour</h2>
        <label className="check">
          <input type="checkbox" checked={config.openOnDeath} onChange={(e) => set("openOnDeath", e.target.checked)} />
          Open the inbox while I'm dead
        </label>
        <label className="check">
          <input type="checkbox" checked={config.openOnGameEnd} onChange={(e) => set("openOnGameEnd", e.target.checked)} />
          Open the inbox when the game ends
        </label>
        <div className="row">
          <label>
            Show threads active in the last
            <input
              type="number"
              min={1}
              max={336}
              value={config.recentHours}
              onChange={(e) => set("recentHours", Number(e.target.value))}
            />
            hours
          </label>
        </div>
        <div className="row">
          <label>
            Check T3 every
            <input
              type="number"
              min={2}
              max={60}
              value={config.pollSeconds}
              onChange={(e) => set("pollSeconds", Number(e.target.value))}
            />
            seconds
          </label>
        </div>
      </section>

      <section>
        <h2>Startup</h2>
        <label className="check">
          <input type="checkbox" checked={config.launchAtLogin} onChange={(e) => set("launchAtLogin", e.target.checked)} />
          Start T3 Overlay with Windows
        </label>
      </section>

      <section>
        <h2>Updates</h2>
        <label className="check">
          <input type="checkbox" checked={config.autoUpdate} onChange={(e) => set("autoUpdate", e.target.checked)} />
          Install updates automatically
        </label>
        <p className="hint">
          Checks GitHub every 2 minutes. Updates install silently while the inbox is closed, even mid-game; the overlay
          is gone for a few seconds while it restarts.
        </p>
        <div className="row">
          <button onClick={() => native.updateCheck()} disabled={["checking", "downloading", "installing"].includes(update.phase)}>
            Check now
          </button>
          <span className={`status ${update.phase === "error" ? "err" : "ok"}`}>{updateText(update, version)}</span>
        </div>
      </section>

      <section>
        <h2>Diagnostics</h2>
        <p className="hint">If the overlay doesn't show up, this says why. Copy it into T3 if you're asking for help.</p>
        <div className="row">
          <button onClick={checkOverlay}>Check overlay</button>
          <button onClick={() => native.overlayReshow().then(checkOverlay)}>Show overlay</button>
          <button onClick={() => native.overlayReload().then(() => setTimeout(checkOverlay, 1500))}>Reload overlay</button>
        </div>
        {diag && (
          <pre className="diag">
            {[
              `version          v${version ?? "?"}`,
              `window exists    ${diag.windowExists}`,
              `visible          ${diag.visible}   minimized ${diag.minimized}`,
              `position / size  ${diag.position?.join(",") ?? "?"}  /  ${diag.size?.join("x") ?? "?"}`,
              `ex style         ${diag.exStyle ?? "?"}   focusable now ${diag.focusableNow}`,
              `page heartbeat   ${diag.heartbeatAgeMs === null ? "never (page not running)" : `${Math.round(diag.heartbeatAgeMs / 1000)}s ago`}`,
              `errors           ${diag.errors.length === 0 ? "none" : ""}`,
              ...diag.errors.map((e) => `  - ${e}`),
            ].join("\n")}
          </pre>
        )}
      </section>

      <div className="row footer">
        <button className="primary" disabled={busy === "save"} onClick={save}>
          Save
        </button>
        {message && <span className={`status ${message.kind}`}>{message.text}</span>}
      </div>
      <p className="hint">
        League must run in <b>Borderless</b> or <b>Windowed</b> mode for the overlay to show. Close this window anytime;
        the overlay keeps running in the tray.
      </p>
    </div>
  );
}

function updateText(update: UpdateStatus, version: string | null): string {
  const current = version ? `v${version}` : "";
  switch (update.phase) {
    case "idle":
      return current;
    case "checking":
      return "Checking…";
    case "upToDate":
      return `${current} is the latest version.`;
    case "downloading":
      return `Downloading v${update.version}…`;
    case "ready":
      return `v${update.version} will install once the inbox is closed.`;
    case "installing":
      return `Installing v${update.version}…`;
    case "error":
      return `Update check failed: ${update.message}`;
  }
}
