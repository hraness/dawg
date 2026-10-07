"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { CELL_H, CELL_W, drawScreen } from "./draw";
import { parseCast, Screen, type Cast } from "./vt";

/** Seconds the last frame stays up before the recording loops. */
const HOLD = 3;

/**
 * Replays the recorded highway (an asciinema cast of dawg's real renderer)
 * onto a canvas. The server-rendered poster frame stays in place until the
 * cast loads, and is all a reader sees with JavaScript off. With reduced
 * motion the poster stays until the reader presses play.
 */
export function HighwayPlayer({
  castUrl,
  label,
  children,
}: Readonly<{ castUrl: string; label: string; children: ReactNode }>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const castRef = useRef<Cast | null>(null);
  const stateRef = useRef({
    screen: null as Screen | null,
    next: 0,
    start: 0,
    offset: 0,
    raf: 0,
    visible: true,
  });
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [userPaused, setUserPaused] = useState(false);

  const paint = useCallback((screen: Screen) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas === null || ctx === null || ctx === undefined) return;
    const scale = Math.min(
      3,
      Math.max(
        1,
        Math.ceil(
          ((canvas.clientWidth || 800) * (window.devicePixelRatio || 1)) /
            (screen.cols * CELL_W),
        ),
      ),
    );
    const width = screen.cols * CELL_W * scale;
    const height = screen.rows * CELL_H * scale;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    drawScreen(ctx, screen, scale);
  }, []);

  // Load the cast once.
  useEffect(() => {
    let cancelled = false;
    fetch(castUrl)
      .then((response) =>
        response.ok
          ? response.text()
          : Promise.reject(new Error(String(response.status))),
      )
      .then((text) => {
        if (cancelled) return;
        const cast = parseCast(text);
        castRef.current = cast;
        const state = stateRef.current;
        state.screen = new Screen(cast.header.width, cast.header.height);
        state.next = 0;
        state.offset = 0;
        // Paint the last frame first so the canvas opens on the same picture as the poster.
        const last = new Screen(cast.header.width, cast.header.height);
        for (const frame of cast.frames) last.write(frame.data);
        paint(last);
        setReady(true);
        const reduce = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        setPlaying(!reduce);
      })
      .catch(() => {
        // The poster frame stays; nothing else to do.
      });
    return () => {
      cancelled = true;
    };
  }, [castUrl, paint]);

  // Pause while scrolled away or in a background tab.
  useEffect(() => {
    const element = frameRef.current;
    if (element === null) return;
    const state = stateRef.current;
    const observer = new IntersectionObserver(([entry]) => {
      state.visible = entry?.isIntersecting ?? true;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const cast = castRef.current;
    const state = stateRef.current;
    if (!ready || !playing || cast === null) return;
    const duration = (cast.frames.at(-1)?.time ?? 0) + HOLD;
    state.start = performance.now() - state.offset * 1000;
    const tick = (now: number) => {
      state.raf = requestAnimationFrame(tick);
      if (!state.visible || document.hidden) {
        state.start = now - state.offset * 1000;
        return;
      }
      let t = (now - state.start) / 1000;
      if (t >= duration) {
        state.start = now;
        t = 0;
        state.screen = new Screen(cast.header.width, cast.header.height);
        state.next = 0;
      }
      state.offset = t;
      const screen = state.screen!;
      let changed = false;
      while (
        state.next < cast.frames.length &&
        cast.frames[state.next]!.time <= t
      ) {
        screen.write(cast.frames[state.next]!.data);
        state.next += 1;
        changed = true;
      }
      if (changed) paint(screen);
    };
    state.raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(state.raf);
  }, [ready, playing, paint]);

  return (
    <div
      className="dawg-player"
      ref={frameRef}
      data-ready={ready ? "" : undefined}
    >
      <div className="dawg-player__screen">
        <div
          className="dawg-player__poster"
          aria-hidden={ready ? true : undefined}
        >
          {children}
        </div>
        <canvas
          ref={canvasRef}
          className="dawg-player__canvas"
          role="img"
          aria-label={label}
          hidden={!ready}
        />
      </div>
      {ready ? (
        <button
          type="button"
          className="dawg-player__toggle"
          onClick={() => {
            setPlaying((value) => !value);
            setUserPaused(playing);
          }}
        >
          {playing ? "Pause" : userPaused ? "Resume" : "Play demo"}
        </button>
      ) : null}
    </div>
  );
}
