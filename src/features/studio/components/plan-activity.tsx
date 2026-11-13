"use client";

import { useEffect, useRef } from "react";
import { makePlanAnimation } from "./plan-animation";

type AnimationItem = {
  play: () => void;
  pause: () => void;
  destroy: () => void;
  addEventListener: (event: string, handler: () => void) => void;
};
type Player = { loadAnimation: (options: Record<string, unknown>) => AnimationItem };
declare global { interface Window { lottie?: Player } }

let playerPromise: Promise<Player> | null = null;
function loadPlayer() {
  if (window.lottie) return Promise.resolve(window.lottie);
  if (playerPromise) return playerPromise;
  playerPromise = new Promise<Player>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/lottie-web/lottie_light.min.js";
    script.async = true;
    script.onload = () => window.lottie ? resolve(window.lottie) : reject(new Error("Player unavailable"));
    script.onerror = () => { script.remove(); reject(new Error("Player unavailable")); };
    document.head.appendChild(script);
  }).catch((error: unknown) => { playerPromise = null; throw error; });
  return playerPromise;
}

export function PlanActivity({ complete = false, active = true }: { complete?: boolean; active?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let disposed = false;
    let animation: AnimationItem | undefined;
    let inView = true;
    let finished = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      if (!animation) return;
      if (reduced.matches || document.hidden || !inView || finished) animation.pause();
      else animation.play();
    };
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync(); });
    observer.observe(node);
    const create = () => {
      if (!active || reduced.matches || animation || disposed) return;
      void loadPlayer().then((player) => {
        if (disposed || reduced.matches || animation) return;
        const container = node.querySelector<HTMLElement>(".activity-player");
        if (!container) return;
        animation = player.loadAnimation({ container, animationData: makePlanAnimation(complete), renderer: "svg", loop: !complete, autoplay: false, rendererSettings: { progressiveLoad: true } });
        if (complete) animation.addEventListener("complete", () => { finished = true; });
        animation.addEventListener("DOMLoaded", () => { node.dataset.renderer = "lottie"; sync(); });
        animation.addEventListener("data_failed", () => { delete node.dataset.renderer; });
        sync();
      }).catch(() => { /* The static floor plan remains visible. */ });
    };
    const onReduced = () => {
      if (reduced.matches) { animation?.destroy(); animation = undefined; delete node.dataset.renderer; }
      else create();
    };
    create();
    document.addEventListener("visibilitychange", sync);
    reduced.addEventListener("change", onReduced);
    return () => {
      disposed = true;
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      reduced.removeEventListener("change", onReduced);
      animation?.destroy();
      delete node.dataset.renderer;
    };
  }, [active, complete]);

  return <span ref={ref} className={`plan-activity${complete ? " is-complete" : ""}`} aria-hidden="true">
    <svg className="activity-fallback" viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      {complete ? <path d="m20 42 14 14 27-31" /> : <><path d="M17 63V17h46v46H44M17 38h24V17M41 63V47h14" /><path d="M27 24h7" /></>}
    </svg>
    <span className="activity-player" />
  </span>;
}
