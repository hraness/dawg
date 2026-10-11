"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { frameDelay, paintFrames, type FramesFile } from "./frames";

/** The shortest a frame stays up, so typing reads as typing. */
const PACE = 90;
/** How long the finished screen holds before the loop starts again. */
const HOLD = 3200;

/**
 * Replays the frames dawg drew on the way to a captured screen
 * (../docs/screens/frames/<id>.json, served at /screens/<id>.json) over the
 * still the server rendered. It only swaps the text of fixed-size rows, so
 * nothing reflows. It waits until the screen scrolls into view, pauses when
 * it leaves or the tab is hidden, and never starts under
 * prefers-reduced-motion: the still is the whole screen.
 */
export function ScreenPlayer({
  id,
  children,
}: Readonly<{ id: string; children: ReactNode }>) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    const grid = el?.querySelector("pre");
    if (!el || !grid) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches) {
      el.dataset.animated = "still";
      return;
    }
    const rows = [...grid.querySelectorAll<HTMLElement>(".dawg-screen__row")];
    let frames: ReturnType<typeof paintFrames> | undefined;
    let loading = false;
    let visible = false;
    let index = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const paint = () => {
      const frame = frames![index]!;
      frame.rows.forEach((html, y) => {
        const row = rows[y];
        if (row && row.innerHTML !== html) row.innerHTML = html;
      });
    };
    const stop = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (el.dataset.animated === "playing") el.dataset.animated = "paused";
    };
    const tick = () => {
      if (stopped || !frames || !visible || document.hidden) return stop();
      paint();
      el.dataset.animated = "playing";
      const delay = frameDelay(frames, index, PACE, HOLD);
      index = (index + 1) % frames.length;
      timer = setTimeout(tick, delay);
    };
    const start = () => {
      if (timer !== undefined || !visible || document.hidden) return;
      if (frames) return tick();
      if (loading) return;
      loading = true;
      void fetch(`/screens/${id}.json`)
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status));
          return response.json() as Promise<FramesFile>;
        })
        .then((file) => {
          if (file.rows !== rows.length) return;
          frames = paintFrames(file);
          // The still is the last frame: hold it, then play from the top.
          index = 0;
          timer = setTimeout(() => {
            timer = undefined;
            start();
          }, 900);
        })
        .catch(() => {
          el.dataset.animated = "still";
        });
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? false;
        if (visible) start();
        else stop();
      },
      { rootMargin: "80px" },
    );
    observer.observe(el);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    const onMotion = () => {
      if (!motion.matches) return;
      stopped = true;
      stop();
      if (frames) {
        index = frames.length - 1;
        paint();
      }
      el.dataset.animated = "still";
    };
    motion.addEventListener("change", onMotion);
    return () => {
      stopped = true;
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", onMotion);
    };
  }, [id]);
  return (
    <div ref={root} className="dawg-screen__player" data-animated="idle">
      {children}
    </div>
  );
}
