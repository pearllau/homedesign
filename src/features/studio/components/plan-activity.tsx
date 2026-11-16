"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

// 一笔画房子：从地面左端出发，沿左墙向上（中途绕出窗洞），
// 到檐口后沿屋顶走一个来回，再沿右墙下行，最后沿地面收口回到起点。
// 整条轮廓必须是单条 path，才能用 stroke-dashoffset 做“画→退→再画”的连续动画。
const HOUSE_PATH = "M17 63V44H24V36H17V30L40 14L63 30V63H48V48H36V63H17Z";

export function PlanActivity({ active = true }: { active?: boolean }) {
  const nodeRef = useRef<HTMLSpanElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const [length, setLength] = useState(0);

  // 路径长度只有在浏览器里量得到；量到后写进 CSS 变量，供 dashoffset 动画复用。
  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const measured = path.getTotalLength();
    if (measured > 0) setLength(Math.ceil(measured * 10) / 10);
  }, []);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const sync = () => node.dataset.paused = String(!active || document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [active]);

  const style = !length
    ? undefined
    : ({ "--plan-length": length, strokeDasharray: length, strokeDashoffset: length } as CSSProperties);

  return (
    <span ref={nodeRef} className="plan-activity" aria-hidden="true">
      <svg viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path ref={pathRef} d={HOUSE_PATH} style={style} className="activity-house" />
      </svg>
    </span>
  );
}
