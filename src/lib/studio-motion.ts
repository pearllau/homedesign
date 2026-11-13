// Shared timing for input feedback, content reveal and reversible page transitions.
export const studioMotion = {
  feedback: 140,
  change: 240,
  reveal: 360,
  stagger: 55,
  ease: "cubic-bezier(0.16, 1, 0.3, 1)",
};

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
