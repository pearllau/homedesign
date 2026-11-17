"use client";

import { useEffect, useRef } from "react";

export function PlanActivity({ complete = false, active = true }: { complete?: boolean; active?: boolean }) {
  const nodeRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const sync = () => { if (nodeRef.current) nodeRef.current.dataset.active = String(active && !document.hidden); };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [active]);
  return <span ref={nodeRef} className={`plan-activity${complete ? " is-complete" : ""}`} data-renderer="svg" data-active={active} aria-hidden="true">
    <svg className="activity-outline-svg" viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      <path className={complete ? "activity-check" : "activity-outline"} pathLength="1" d={complete ? "m20 42 14 14 27-31" : "M16 63V34L40 14L64 34V63H46V44H34V63H16"} />
    </svg>
  </span>;
}
