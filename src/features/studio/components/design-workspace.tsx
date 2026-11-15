"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { Plan } from "@/shared/plan-data";
import { viewerSrc } from "@/shared/viewer-contract";
import { Icon } from "./icon";

export function buildPlanPayload(plan: Plan) {
  const data = {
    style: plan.style,
    totalArea: plan.totalArea,
    rooms: plan.rooms.map(({ name, width, length, area, furniture }) => ({ name, width, length, area, furniture: furniture || [] })),
    ...(plan.floorPlan ? { floorPlan: plan.floorPlan } : {}),
  };
  const key = JSON.stringify(data);
  let hash = 5381;
  for (let i = 0; i < key.length; i++) hash = ((hash * 33) ^ key.charCodeAt(i)) >>> 0;
  return { sig: hash.toString(36), ...data };
}

type Props = {
  plan: Plan;
  open: boolean;
  origin: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
};

export function DesignWorkspace({ plan, open, origin, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const payload = buildPlanPayload(plan);
  const src = viewerSrc(encodeURIComponent(JSON.stringify(payload)));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || (!open && !dialog.open)) return;
    if (open && !dialog.open) dialog.showModal();
    const from = origin.current?.getBoundingClientRect();
    const to = dialog.getBoundingClientRect();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const collapsed = from && from.width > 0 && from.height > 0
      ? `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`
      : "translateY(12px) scale(0.98)";
    const keyframes = reduced
      ? [{ opacity: open ? 0 : 1 }, { opacity: open ? 1 : 0 }]
      : [{ transform: open ? collapsed : "none", opacity: open ? 0.25 : 1 }, { transform: open ? "none" : collapsed, opacity: open ? 1 : 0.05 }];
    const animation = dialog.animate(keyframes, { duration: reduced ? 120 : open ? 380 : 260, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
    let cancelled = false;
    dialog.dataset.phase = open ? "opening" : "closing";
    if (open) {
      frameRef.current?.contentWindow?.postMessage({ type: "studio-visibility", visible: true }, window.location.origin);
      backRef.current?.focus({ preventScroll: true });
    }
    animation.finished.then(() => {
      if (cancelled) return;
      dialog.dataset.phase = open ? "open" : "closed";
      if (!open) {
        frameRef.current?.contentWindow?.postMessage({ type: "studio-visibility", visible: false }, window.location.origin);
        dialog.close();
        origin.current?.focus({ preventScroll: true });
      }
    }).catch(() => {});
    return () => { cancelled = true; animation.cancel(); };
  }, [open, origin]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.source === frameRef.current?.contentWindow && event.data?.type === "studio-close" && open) onClose();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onClose, open]);

  return (
    <dialog ref={dialogRef} className="workspace-dialog" aria-labelledby="workspace-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className="workspace-heading">
        <button ref={backRef} className="button button-quiet workspace-back" onClick={onClose}><Icon name="back" />返回方案</button>
        <div className="workspace-title"><h2 id="workspace-title">{plan.style} · 空间工作台</h2><span>{Math.round(plan.totalArea * 100) / 100} ㎡<i />{plan.rooms.length} 个空间</span></div>
        <span className="workspace-save"><span className="status-dot" />编辑自动保存在本机</span>
        <button className="icon-button workspace-dismiss" onClick={onClose} aria-label="收起设计工作台"><Icon name="close" /></button>
      </div>
      <div className="workspace-canvas">
        <iframe ref={frameRef} key={payload.sig} src={src} title="户型设计与 3D 预览" onLoad={() => frameRef.current?.contentWindow?.postMessage({ type: "studio-visibility", visible: open }, window.location.origin)} />
      </div>
      <div className="workspace-bottom"><span>先调整平面布局，再切换 3D 看看空间。</span><span>返回后可以继续对话，当前布置会保留。<kbd>Esc</kbd> 返回</span></div>
    </dialog>
  );
}
