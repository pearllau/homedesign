"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { prefersReducedMotion, studioMotion } from "@/lib/studio-motion";

// React adaptation of E:/design-references/inspira-ui BlurReveal and AnimatedList.
// Content is visible in SSR; only new, visible content is animated, once.
export function InspiraReveal({ children, className, enabled = true, delay = 0 }: {
  children: ReactNode;
  className?: string;
  enabled?: boolean;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const played = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled || played.current || prefersReducedMotion()) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || played.current) return;
      played.current = true;
      observer.disconnect();
      const animation = node.animate([
        { opacity: 0.45, transform: "translateY(12px)", filter: "blur(3px)" },
        { opacity: 1, transform: "translateY(0)", filter: "blur(0)" },
      ], { duration: studioMotion.reveal, delay, easing: studioMotion.ease, fill: "backwards" });
      animation.finished.catch(() => {});
      animations.push(animation);
    });
    const animations: Animation[] = [];
    observer.observe(node);
    return () => { observer.disconnect(); animations.forEach((animation) => animation.cancel()); };
  }, [delay, enabled]);

  return <div ref={ref} className={className}>{children}</div>;
}
