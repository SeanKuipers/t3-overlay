import { useEffect } from "react";
import { native } from "./native";

/**
 * Reports the on-screen rectangles of every `[data-hit]` element to Rust, which makes the
 * overlay clickable only there. Everywhere else, clicks go to the game.
 */
export function useHitRegions(deps: unknown[]) {
  useEffect(() => {
    let frame = 0;
    let last = "";
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const scale = window.devicePixelRatio || 1;
        const regions = [...document.querySelectorAll<HTMLElement>("[data-hit]")].map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x * scale, y: r.y * scale, width: r.width * scale, height: r.height * scale };
        });
        const key = JSON.stringify(regions);
        if (key !== last) {
          last = key;
          native.setHitRegions(regions).catch(() => {});
        }
      });
    };
    report();
    const resize = new ResizeObserver(report);
    document.querySelectorAll("[data-hit]").forEach((el) => resize.observe(el));
    const mutations = new MutationObserver(() => {
      document.querySelectorAll("[data-hit]").forEach((el) => resize.observe(el));
      report();
    });
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener("resize", report);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", report);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
