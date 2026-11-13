import type { SVGProps } from "react";

export type IconName = "home" | "arrow" | "back" | "plus" | "plan" | "chat" | "copy" | "check" | "send" | "close" | "stop" | "leaf";

const paths: Record<IconName, React.ReactNode> = {
  home: <><path d="m3 10 9-7 9 7v10H3Z" /><path d="M9 20v-7h6v7" /></>,
  arrow: <><path d="M4 12h15m-6-6 6 6-6 6" /></>,
  back: <><path d="M20 12H5m6-6-6 6 6 6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  plan: <><path d="M4 4h16v16H4zM4 12h9V4m0 8v8m0-4h7" /></>,
  chat: <path d="M4 4h16v12H9l-5 4zM8 8h8M8 12h5" />,
  copy: <><path d="M9 8h11v13H9zM15 8V3H4v13h5" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  send: <><path d="m5 14 7-9 7 9M12 5v15" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  stop: <path d="M6 6h12v12H6z" />,
  leaf: <><path d="M19 4C8 3 3 9 7 15s13 3 12-11Z" /><path d="m5 20 9-10" /></>,
};

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
