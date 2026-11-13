"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { prefersReducedMotion, studioMotion } from "@/features/studio/lib/studio-motion";

type View = "chat" | "design";

// Keep both pages mounted. The same horizontal path is played in reverse on return.
export function StudioViews({ view, chat, design, onTransitionComplete }: { view: View; chat: ReactNode; design: ReactNode; onTransitionComplete?: (view: View) => void }) {
  const chatRef = useRef<HTMLDivElement>(null);
  const designRef = useRef<HTMLDivElement>(null);
  const previous = useRef(view);

  useEffect(() => {
    const nodes = { chat: chatRef.current, design: designRef.current };
    const from = previous.current;
    previous.current = view;
    const reduced = prefersReducedMotion();
    const direction = view === "design" ? 1 : -1;
    const animations: Animation[] = [];
    let cancelled = false;

    for (const key of ["chat", "design"] as const) {
      const node = nodes[key];
      if (!node) continue;
      const incoming = key === view;
      const current = getComputedStyle(node);
      const opacity = current.opacity;
      const transform = current.transform;
      node.style.visibility = "visible";
      node.style.zIndex = incoming ? "2" : "1";
      node.inert = !incoming;
      const target = { opacity: incoming ? 1 : 0, transform: reduced ? "none" : incoming ? "translateX(0)" : `translateX(${-direction * 28}px)` };
      if (from === view) {
        Object.assign(node.style, target, { visibility: incoming ? "visible" : "hidden" });
        node.dataset.phase = incoming ? "visible" : "hidden";
        continue;
      }
      const animation = node.animate([
        { opacity: Number(opacity), transform: reduced ? "none" : opacity === "0" ? `translateX(${direction * 28}px)` : transform },
        target,
      ], { duration: reduced ? 0 : studioMotion.reveal, easing: studioMotion.ease, fill: "forwards" });
      animations.push(animation);
      node.dataset.phase = incoming ? "entering" : "leaving";
      animation.finished.then(() => {
        Object.assign(node.style, target, { visibility: incoming ? "visible" : "hidden" });
        node.dataset.phase = incoming ? "visible" : "hidden";
        animation.cancel();
      }).catch(() => {});
    }
    if (from !== view) {
      void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
        if (!cancelled) onTransitionComplete?.(view);
      });
    }
    return () => {
      cancelled = true;
      for (const node of Object.values(nodes)) {
        if (!node) continue;
        const style = getComputedStyle(node);
        node.style.opacity = style.opacity;
        node.style.transform = style.transform;
      }
      animations.forEach((animation) => animation.cancel());
    };
  }, [view, onTransitionComplete]);

  return <div className="studio-views" data-view={view}>
    <div ref={chatRef} className="studio-view" data-panel="chat" aria-hidden={view !== "chat"} inert={view !== "chat"}>
      {chat}
    </div>
    <div ref={designRef} className="studio-view studio-design-view" data-panel="design" aria-hidden={view !== "design"} inert={view !== "design"}>
      {design}
    </div>
  </div>;
}
