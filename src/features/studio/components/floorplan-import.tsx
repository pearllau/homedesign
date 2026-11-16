"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { floorPlanGeometrySchema, type FloorPlanGeometry, type Point } from "@/shared/floorplan-geometry";
import { cropFloorplanImage, processFloorplanImage, rotateFloorplanImage, type ProcessedFloorplanImage } from "@/features/studio/lib/floorplan-image";
import "./floorplan-import.css";

type Props = { initialFile?: File; onClose: () => void; onConfirm: (geometry: FloorPlanGeometry) => void };

type Stage = "idle" | "prepare" | "upload" | "repair";

// 只负责「选图 → 识别 → 交给工作台」。
// 尺寸校准和墙体纠偏都在工作台里完成，这里不再保留旧版校准校对页。
export function FloorplanImport({ initialFile, onClose, onConfirm }: Props) {
  const [image, setImage] = useState<ProcessedFloorplanImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");
  const [cropMode, setCropMode] = useState(false);
  const [points, setPoints] = useState<Point[]>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>([0, 0]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoRef = useRef(true);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { abortRef.current?.abort(); onCloseRef.current(); return; }
      if (event.key !== "Tab") return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]');
      const focusable = Array.from(nodes || []).filter(node => node.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); abortRef.current?.abort(); previous?.focus(); };
  }, []);

  // 首页把文件直接带进来时，不再需要用户二次点击。
  useEffect(() => {
    if (initialFile) void chooseFile(initialFile);
  }, [initialFile]);

  // 选好图或调整过图片后自动识别，用户不需要再点一次「开始识别」。
  useEffect(() => {
    if (!image || !autoRef.current) return;
    autoRef.current = false;
    void recognize(image);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  // 识别中只给一句阶段文案；不显示秒数，也不猜进度，等多久都不会显得在假装推进。
  // 打开弹窗就先探一次服务是否就绪，并顺便预热视觉模型：没配视觉模型时立刻说清楚，
  // 冷启动的那一段耗时则放到用户选图、裁剪的时候。
  useEffect(() => {
    let active = true;
    void fetch("/api/floorplan/recognize", { method: "GET" })
      .then(async response => {
        if (active && response.status === 503) {
          const body: unknown = await response.json().catch(() => null);
          const message = body && typeof body === "object" ? (body as Record<string, unknown>).error : null;
          setError(typeof message === "string" ? message : "户型识别服务还没有配置，请先设置 VISION_API_KEY 与 VISION_MODEL。");
        }
      })
      .catch(() => undefined);
    void fetch("/api/floorplan/recognize?warm=1", { method: "GET" }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function chooseFile(file?: File) {
    if (!file) return;
    abortRef.current?.abort(); abortRef.current = null;
    setBusy(true); setError(""); setStage("prepare");
    try {
      const result = await processFloorplanImage(file);
      setImage(result); setCropMode(false); setPoints([]); setZoom(1); setPan([0, 0]);
      autoRef.current = true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "图片处理失败，请重试。"); }
    finally { setBusy(false); setStage("idle"); }
    if (inputRef.current) inputRef.current.value = "";
  }

  async function recognize(target: ProcessedFloorplanImage) {
    // 上一次识别（如换图、旋转、重试）先中止；这里不能直接 return，
    // 否则 abortRef 里残留的 controller 会让新图永远识别不了。
    abortRef.current?.abort();
    const controller = new AbortController(); abortRef.current = controller;
    setBusy(true); setError(""); setScanning(true); setStage("upload");
    try {
      const response = await fetch("/api/floorplan/recognize", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: target.recognitionDataUrl, name: target.name, width: target.width, height: target.height }),
      });
      if (response.ok) setStage("repair");
      const body: unknown = await response.json().catch(() => null);
      const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
      if (!response.ok || !payload.geometry) throw new Error(typeof payload.error === "string" ? payload.error : "识别没有完成，请重试。");
      const result = floorPlanGeometrySchema.safeParse(payload.geometry);
      if (!result.success) throw new Error("识别结果不完整，请重试。");
      onConfirm(result.data);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "识别失败，请重试。"); }
    finally {
      if (abortRef.current === controller) { abortRef.current = null; setBusy(false); setScanning(false); setStage("idle"); }
    }
  }

  async function transformImage(action: "left" | "right" | "crop") {
    if (!image) return;
    // 旋转/裁剪会换一张识别输入，先中止上一次识别，避免自动识别被旧请求挡住。
    abortRef.current?.abort(); abortRef.current = null;
    setBusy(true); setError("");
    try {
      const result = action === "crop" ? await cropFloorplanImage(image, points[0], points[1]) : await rotateFloorplanImage(image, action === "right");
      setImage(result); setCropMode(false); setPoints([]); setZoom(1); setPan([0, 0]);
      autoRef.current = true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "图片处理失败。"); }
    finally { setBusy(false); }
  }

  function pointAt(event: { clientX: number; clientY: number }, svg: SVGSVGElement): Point {
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const matrix = svg.getScreenCTM(); const local = matrix ? point.matrixTransform(matrix.inverse()) : point;
    return [Math.round(Math.max(0, Math.min(image?.width || 0, local.x)) * 10) / 10, Math.round(Math.max(0, Math.min(image?.height || 0, local.y)) * 10) / 10];
  }

  function onCanvasDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (!image || busy) return;
    const svg = event.currentTarget;
    if (!cropMode) {
      const start: Point = [event.clientX, event.clientY]; const origin = pan;
      const move = (pointer: PointerEvent) => setPan([origin[0] + pointer.clientX - start[0], origin[1] + pointer.clientY - start[1]]);
      const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", end, { once: true }); return;
    }
    const value = pointAt(event, svg);
    setPoints([value, value]);
    const move = (pointer: PointerEvent) => setPoints([value, pointAt(pointer, svg)]);
    const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end, { once: true });
  }

  function cancelRecognition() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setScanning(false);
  }

  const sourceWidth = image?.width || 1000, sourceHeight = image?.height || 800;
  const stageText = stage === "prepare" ? "正在整理图片…" : stage === "repair" ? "正在识别墙体与房间…" : "正在上传户型图…";

  // 识别等待时收起所有导航与上传栏，只留画面正中的预览卡片 + 扫描动效。
  if (scanning && image) {
    return <div className="floorplan-import-backdrop is-scanning"><section className="floorplan-scan-dialog" data-stage={stage} role="dialog" aria-modal="true" aria-label="正在识别户型图" aria-live="polite" tabIndex={-1} ref={dialogRef}>
      <div className="floorplan-scan-card">
        <div className="floorplan-scan-frame" style={{ aspectRatio: `${sourceWidth} / ${sourceHeight}` }}>
          <img src={image.dataUrl} alt="户型图预览" />
          <span className="floorplan-scan-grid" aria-hidden="true" />
          <span className="floorplan-scan-beam" aria-hidden="true" />
          <span className="floorplan-scan-corners" aria-hidden="true" />
        </div>
        <div className="floorplan-scan-status">
          <span className="floorplan-scan-pulse" aria-hidden="true" />
          <span className="floorplan-scan-text">{stageText}</span>
          <button className="floorplan-scan-cancel" onClick={cancelRecognition}>取消识别</button>
        </div>
      </div>
    </section></div>;
  }

  return <div className="floorplan-import-backdrop"><section className="floorplan-import floorplan-upload-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="floorplan-upload-title" tabIndex={-1}>
    <header className="floorplan-import-header"><div><span className="floorplan-eyebrow">户型图导入</span><h2 id="floorplan-upload-title">上传户型图</h2><p>识别完成后直接进入工作台；真实尺寸可在「测量 · 尺寸校准」中按一面已知墙长换算。</p></div><button className="floorplan-icon-button" onClick={onClose} aria-label="关闭户型图上传">×</button></header>
    <div className="floorplan-import-body">
      <aside className="floorplan-import-sidebar">
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event => void chooseFile(event.target.files?.[0])} />
        <div className="floorplan-upload-panel">
          <button className="floorplan-upload-drop" onClick={() => inputRef.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void chooseFile(event.dataTransfer.files[0]); }} disabled={busy}>
            <strong>{image ? "重新选择图片" : "点击或拖入户型图"}</strong><small>JPG、PNG、WebP · 最大 10MB</small>
          </button>
          {image && <>
            <div className="floorplan-file-meta"><span>{image.name}</span><small>{image.width} × {image.height} · 约 {Math.max(1, Math.round(image.bytes / 1024))}KB</small></div>
            <div className="floorplan-row-actions"><button onClick={() => void transformImage("left")} disabled={busy}>左转 90°</button><button onClick={() => void transformImage("right")} disabled={busy}>右转 90°</button><button onClick={() => { setCropMode(value => !value); setPoints([]); }} disabled={busy}>{cropMode ? "取消裁剪" : "框选裁剪"}</button></div>
            {cropMode && <><p className="floorplan-hint">在图片上拖出需要保留的区域。</p><button className="floorplan-secondary" onClick={() => void transformImage("crop")} disabled={points.length !== 2 || busy}>应用裁剪并重新识别</button></>}
            <button className="floorplan-primary" onClick={() => void recognize(image)} disabled={busy}>{busy ? "正在识别户型图…" : "重新识别"}</button>
            {busy && <button className="floorplan-secondary" onClick={cancelRecognition}>取消识别</button>}
          </>}
        </div>
        {error && <div className="floorplan-error" role="alert">{error}</div>}
      </aside>
      <main className="floorplan-canvas-wrap" aria-label="户型图上传与识别" onClick={!image && !busy ? () => inputRef.current?.click() : undefined} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) void chooseFile(event.dataTransfer.files[0]); }}>
        {image ? <svg className="floorplan-review-canvas" viewBox={`0 0 ${sourceWidth} ${sourceHeight}`} style={{ transform: `translate(${pan[0]}px,${pan[1]}px) scale(${zoom})` }} onPointerDown={onCanvasDown}>
          <rect width={sourceWidth} height={sourceHeight} fill="#fff" pointerEvents="none" /><image href={image.dataUrl} width={sourceWidth} height={sourceHeight} />
          {cropMode && points.length === 2 && <rect x={Math.min(points[0][0], points[1][0])} y={Math.min(points[0][1], points[1][1])} width={Math.abs(points[0][0] - points[1][0])} height={Math.abs(points[0][1] - points[1][1])} className="floorplan-crop-box" />}
        </svg> : <div className="floorplan-empty"><span className="floorplan-upload-grid" aria-hidden="true"><svg viewBox="0 0 64 48" fill="none"><path d="M32 5v27m0-27L22 15m10-10 10 10M8 29v12h48V29" /></svg></span><strong>{busy ? "正在识别户型图…" : "点击此处上传户型图"}</strong><small>{error || "JPG、PNG、WebP · 识别完成后直接进入可编辑工作台"}</small></div>}
        {image && <div className="floorplan-zoom-controls"><button onClick={() => setZoom(value => Math.max(.5, value - .25))} aria-label="缩小原图">−</button><button onClick={() => { setZoom(1); setPan([0, 0]); }}>适应</button><button onClick={() => setZoom(value => Math.min(5, value + .25))} aria-label="放大原图">＋</button></div>}
      </main>
    </div>
  </section></div>;
}

export default FloorplanImport;
