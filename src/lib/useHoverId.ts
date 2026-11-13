import { useEffect, useState } from "react";
import { on } from "./native";

/**
 * Which `data-hover-id` region the cursor is over, as tracked by the overlay's hit-test
 * loop. (CSS :hover can't be trusted here: once the cursor leaves the clickable regions
 * the window ignores the mouse, so the page never sees it leave.) Leaving is delayed a
 * little so a quick wobble doesn't snap things shut.
 */
export function useHoverId(leaveDelayMs = 250) {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let timer: number | undefined;
    const off = on<string | null>("overlay://hover", (next) => {
      window.clearTimeout(timer);
      if (next) setId(next);
      else timer = window.setTimeout(() => setId(null), leaveDelayMs);
    });
    return () => {
      window.clearTimeout(timer);
      off();
    };
  }, [leaveDelayMs]);
  return id;
}
