import { native, type UpdateStatus } from "../lib/native";

/** Version + one-click update, in the inbox footer, so updating mid-game needs no Settings. */
export function UpdateControl({ version, status }: { version: string | null; status: UpdateStatus }) {
  const current = version ? `v${version}` : "";
  switch (status.phase) {
    case "checking":
      return <span className="update">checking for updates…</span>;
    case "downloading":
      return <span className="update">downloading v{status.version}…</span>;
    case "installing":
      return <span className="update busy">updating to v{status.version}…</span>;
    case "ready":
      return (
        <button className="update-btn ready" onClick={() => native.updateInstallNow()} title="The overlay restarts in a few seconds">
          ⬆ update to v{status.version}
        </button>
      );
    case "error":
      return (
        <button className="update-btn" onClick={() => native.updateInstallNow()} title={status.message}>
          {current} · update failed, retry
        </button>
      );
    default:
      return (
        <button className="update-btn" onClick={() => native.updateInstallNow()} title="Check for an update and install it right away">
          {current}
          {status.phase === "upToDate" ? " · latest ✓" : " · update"}
        </button>
      );
  }
}

/** Small pill outside the inbox while an update downloads or installs. */
export function UpdatePill({ status }: { status: UpdateStatus }) {
  if (status.phase === "installing") return <div className="update-pill glass">Updating T3 Overlay to v{status.version}…</div>;
  return null;
}
