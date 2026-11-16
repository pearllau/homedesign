// 动效规格的唯一真源：按压 140ms / 视图切换 240ms / 退场 180ms / 入场 360ms / 错峰 55ms。
export const studioMotion = {
  feedback: 140,
  change: 240,
  leave: 180,
  reveal: 360,
  stagger: 55,
  ease: "cubic-bezier(0.16, 1, 0.3, 1)",
  easeIn: "cubic-bezier(0.4, 0, 1, 1)",
};

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
