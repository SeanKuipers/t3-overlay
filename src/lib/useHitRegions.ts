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
        // CSS pixels plus the viewport size: Rust scales them by the window's real size, so a
        // devicePixelRatio that disagrees with the window can't shift the clickable areas.
        const regions = [...document.querySelectorAll<HTMLElement>("[data-hit]")].map((el) => {
          const r = el.getBoundingClientRect();
          // `data-hover-id` regions get hover events from Rust (see useHoverId).
          const id = el.dataset.hoverId ?? null;
          return { x: r.x, y: r.y, width: r.width, height: r.height, id };
        });
        const viewport: [number, number] = [window.innerWidth, window.innerHeight];
        const key = JSON.stringify([regions, viewport]);
        if (key !== last) {
          last = key;
          native.setHitRegions(regions, viewport).catch(() => {});
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
