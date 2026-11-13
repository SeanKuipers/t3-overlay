import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { native, on, type UpdateStatus } from "./native";

/** The running version and the updater's progress. */
export function useUpdate() {
  const [version, setVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<UpdateStatus>({ phase: "idle" });
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
    native.updateStatus().then(setStatus).catch(() => {});
    return on<UpdateStatus>("update://status", setStatus);
  }, []);
  return { version, status };
}
