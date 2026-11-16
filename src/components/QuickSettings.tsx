import { useEffect, useState, type ReactNode } from "react";
import { errorMessage, native, type Config, type UpdateStatus } from "../lib/native";
import { CONTEXT_LABEL, type useLayout } from "../lib/useLayout";
import { HotkeyInput, updateText } from "./Settings";

// Settings inside the overlay, in its own style: no separate window, no native dropdowns
// (those open behind the overlay). Every change saves right away.

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className="qs-row qs-toggle" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span className="qs-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <span className={`switch${checked ? " on" : ""}`} aria-hidden>
        <i />
      </span>
    </button>
  );
}

function Segmented<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="qs-row qs-stack">
      <span className="qs-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            className={o.value === value ? "on" : ""}
            title={o.title}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Stepper({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void }) {
  return (
    <div className="qs-row">
      <span className="qs-text">
        <span>{label}</span>
      </span>
      <div className="stepper">
        <button type="button" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} aria-label="Less">
          −
        </button>
        <span>
          {value} {unit}
        </span>
        <button type="button" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} aria-label="More">
          +
        </button>
      </div>
    </div>
  );
}

/** A "save to slot" button that briefly says it worked. */
function SaveSlot({ index, filled, onSave }: { index: number; filled: boolean; onSave: () => void }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(false), 1200);
    return () => window.clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className={done ? "on" : ""}
      title={filled ? `Replace layout ${index + 1}` : `Save as layout ${index + 1}`}
      onClick={() => {
        onSave();
        setDone(true);
      }}
    >
      {done ? "✓" : index + 1}
    </button>
  );
}

interface Props {
  config: Config | null;
  connected: boolean;
  update: { version: string | null; status: UpdateStatus };
  layouts: ReturnType<typeof useLayout>;
  onClose: () => void;
}

export function QuickSettings({ config: saved, connected, update, layouts, onClose }: Props) {
  // Local copy so the controls react instantly; saved in the background.
  const [config, setConfig] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setConfig(saved), [saved]);

  // Esc closes the panel (unless a hotkey box is recording: it uses Esc itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(document.activeElement as HTMLElement | null)?.classList.contains("hotkey")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!config) return <div className="body">Loading…</div>;

  const set = <K extends keyof Config>(key: K, value: Config[K]) => {
    const next = { ...config, [key]: value };
    setConfig(next);
    setError(null);
    native.saveConfig(next).catch((e) => {
      setError(errorMessage(e));
      setConfig(saved);
    });
  };

  const checking = ["checking", "downloading", "installing"].includes(update.status.phase);

  return (
    <div className="quick-settings">
      <div className="qs-scroll">
        <section>
          <h3>Sending</h3>
          <Segmented
            label="Enter sends as"
            hint={`Ctrl+Enter sends as ${config.sendMode === "steer" ? "queue" : "steer"}.`}
            value={config.sendMode}
            onChange={(v) => set("sendMode", v)}
            options={[
              { value: "queue", label: "Queue", title: "Runs as the next turn, after the agent finishes" },
              { value: "steer", label: "Steer", title: "Joins the turn the agent is working on now" },
              { value: "auto", label: "Auto", title: "Starts an idle chat, steers a running one" },
            ]}
          />
        </section>

        <section>
          <h3>In game</h3>
          <Toggle label="Open the inbox when I die" checked={config.openOnDeath} onChange={(v) => set("openOnDeath", v)} />
          <Toggle label="Open the inbox when the game ends" checked={config.openOnGameEnd} onChange={(v) => set("openOnGameEnd", v)} />
          <Stepper
            label="Keep chats up front for"
            value={config.recentHours}
            min={1}
            max={48}
            unit={config.recentHours === 1 ? "hour" : "hours"}
            onChange={(v) => set("recentHours", v)}
          />
        </section>

        <section>
          <h3>Layout · {CONTEXT_LABEL[layouts.context]}</h3>
          <p className="qs-hint">
            {layouts.context === "desktop"
              ? "Outside games, drag the ticker anywhere. League, TFT and other games each keep their own layout."
              : "Drag the inbox by its top bar, resize it from the corner. Each game keeps its own. Ctrl+1/2/3 switches while the inbox is open."}
          </p>
          <div className="qs-row">
            <span className="qs-text">Switch to</span>
            <div className="segmented slots">
              {layouts.slots.map((slot, i) => (
                <button key={i} type="button" disabled={!slot} title={slot ? `Ctrl+${i + 1}` : "Empty: save one first"} onClick={() => layouts.applySlot(i)}>
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
          <div className="qs-row">
            <span className="qs-text">Save current as</span>
            <div className="segmented slots">
              {layouts.slots.map((slot, i) => (
                <SaveSlot key={i} index={i} filled={!!slot} onSave={() => layouts.saveSlot(i)} />
              ))}
            </div>
          </div>
          <div className="qs-row">
            <span className="qs-text">Back to the default spot and size</span>
            <button type="button" className="qs-btn" onClick={layouts.reset}>
              Reset
            </button>
          </div>
        </section>

        <section>
          <h3>Outside games</h3>
          <Segmented
            label="Show the dock"
            value={config.hubMode}
            onChange={(v) => set("hubMode", v)}
            options={[
              { value: "always", label: "Always" },
              { value: "client", label: "With League client", title: "Only while the League client is open" },
              { value: "off", label: "Never" },
            ]}
          />
        </section>

        <section>
          <h3>Hotkeys</h3>
          <div className="qs-row">
            <span className="qs-text">Open / close inbox</span>
            <HotkeyInput value={config.hotkeyInbox} onChange={(v) => set("hotkeyInbox", v)} />
          </div>
          <div className="qs-row">
            <span className="qs-text">Previous chat</span>
            <HotkeyInput value={config.hotkeyPrev} onChange={(v) => set("hotkeyPrev", v)} />
          </div>
          <div className="qs-row">
            <span className="qs-text">Next chat</span>
            <HotkeyInput value={config.hotkeyNext} onChange={(v) => set("hotkeyNext", v)} />
          </div>
          <Toggle label="Voice replies with Hex" checked={config.voiceEnabled} onChange={(v) => set("voiceEnabled", v)} />
          {config.voiceEnabled && (
            <div className="qs-row">
              <span className="qs-text">Hold to talk</span>
              <HotkeyInput value={config.hotkeyVoice} onChange={(v) => set("hotkeyVoice", v)} />
            </div>
          )}
          <p className="qs-hint">Click a box, then press the keys. Backspace clears it.</p>
        </section>

        <section>
          <h3>App</h3>
          <Toggle label="Start with Windows" checked={config.launchAtLogin} onChange={(v) => set("launchAtLogin", v)} />
          <Toggle
            label="Install updates automatically"
            hint="Quietly, whenever the inbox is closed. Even mid-game."
            checked={config.autoUpdate}
            onChange={(v) => set("autoUpdate", v)}
          />
          <div className="qs-row">
            <span className="qs-text">
              <span>Version</span>
              <small>{updateText(update.status, update.version)}</small>
            </span>
            {update.status.phase === "ready" ? (
              <button type="button" className="qs-btn primary" onClick={() => native.updateInstallNow()}>
                Update now
              </button>
            ) : (
              <button type="button" className="qs-btn" disabled={checking} onClick={() => native.updateCheck()}>
                Check
              </button>
            )}
          </div>
        </section>
      </div>

      {error && <div className="send-error">{error}</div>}
      <div className="qs-foot">
        <span className={`qs-conn ${connected ? "ok" : "err"}`}>
          <span className="dot" /> {connected ? "Connected to T3" : "Not connected"}
        </span>
        <button type="button" className="qs-link" onClick={() => native.openSettings()} title="Server address, connecting, diagnostics">
          Connection & diagnostics…
        </button>
      </div>
    </div>
  );
}
