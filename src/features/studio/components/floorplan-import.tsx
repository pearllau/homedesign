"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { floorPlanGeometrySchema, pixelsPerMeter, roomMetrics, validateGeometry, type FloorPlanGeometry, type FloorPlanOpening, type Point } from "@/shared/floorplan-geometry";
import { cropFloorplanImage, getFloorplanDraft, processFloorplanImage, rotateFloorplanImage, saveFloorplanDraft, type ProcessedFloorplanImage } from "@/features/studio/lib/floorplan-image";
import "./floorplan-import.css";

type Props = { initialGeometry?: FloorPlanGeometry; onClose: () => void; onConfirm: (geometry: FloorPlanGeometry) => void };
type Mode = "select" | "calibrate" | "room" | "outline" | "wall" | "crop";
type Selection = { kind: "room" | "wall" | "opening" | "outline"; id: string } | null;
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const id = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const pointsAttr = (points: Point[]) => points.map(point => point.join(",")).join(" ");
const openingNames = { door: "门", window: "窗", passage: "洞口" };

export function FloorplanImport({ initialGeometry, onClose, onConfirm }: Props) {
  const [geometry, setGeometry] = useState<FloorPlanGeometry | null>(initialGeometry ? copy(initialGeometry) : null);
  const [image, setImage] = useState<ProcessedFloorplanImage | null>(null);
  const [review, setReview] = useState(Boolean(initialGeometry));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<Mode>("select");
  const [selection, setSelection] = useState<Selection>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [length, setLength] = useState(initialGeometry?.calibration?.lengthMeters.toString() || "");
  const [scaleChecked, setScaleChecked] = useState(Boolean(initialGeometry?.confirmed));
  const [opacity, setOpacity] = useState(.68);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>([0, 0]);
  const [history, setHistory] = useState<FloorPlanGeometry[]>([]);
  const [future, setFuture] = useState<FloorPlanGeometry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreImageRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const sourceWidth = image?.width || geometry?.source.width || 1000;
  const sourceHeight = image?.height || geometry?.source.height || 1000;
  const selectedRoom = selection?.kind === "room" ? geometry?.rooms.find(room => room.id === selection.id) : null;
  const selectedWall = selection?.kind === "wall" ? geometry?.walls.find(wall => wall.id === selection.id) : null;
  const selectedOpening = selection?.kind === "opening" ? geometry?.openings.find(opening => opening.id === selection.id) : null;
  const currentScale = geometry && scaleChecked ? pixelsPerMeter(geometry) : null;
  const issues = useMemo(() => {
    if (!geometry) return [];
    const result = floorPlanGeometrySchema.safeParse(geometry);
    if (!result.success) return ["请补全外轮廓、至少一个房间和墙线，并检查名称与数值。"];
    return validateGeometry(result.data);
  }, [geometry]);

  useEffect(() => {
    if (!initialGeometry) return;
    let alive = true;
    void getFloorplanDraft(initialGeometry.id).then(draft => {
      if (!alive) return;
      if (draft?.imageDataUrl) setImage({ dataUrl: draft.imageDataUrl, ...initialGeometry.source });
      else setNotice("本机没有保存原图，可继续修改线稿；需要对照时请重新上传原图。");
    });
    return () => { alive = false; };
  }, [initialGeometry]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { abortRef.current?.abort(); onCloseRef.current(); return; }
      if (event.key !== "Tab") return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]');
      const focusable = Array.from(nodes || []).filter(node => node.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); abortRef.current?.abort(); previous?.focus(); };
  }, []);

  function saveHistory() {
    if (!geometry) return;
    setHistory(previous => [...previous.slice(-29), copy(geometry)]); setFuture([]);
  }

  function edit(mutator: (draft: FloorPlanGeometry) => void, remember = true) {
    if (remember) saveHistory();
    setGeometry(current => {
      if (!current) return current;
      const next = copy(current); mutator(next); next.confirmed = false;
      // Validation messages copied into the recognition notes should disappear
      // when the corresponding geometry error has actually been repaired.
      const previousIssues = validateGeometry(current), remainingIssues = validateGeometry(next);
      next.warnings = next.warnings.filter(warning => !previousIssues.includes(warning) || remainingIssues.includes(warning));
      return next;
    });
    setError("");
  }

  function chooseMode(next: Mode) { setMode(next); setPoints([]); setError(""); }
  function close() { abortRef.current?.abort(); onClose(); }

  async function chooseFile(file?: File) {
    if (!file) return;
    abortRef.current?.abort(); setBusy(true); setError(""); setNotice("");
    try {
      const result = await processFloorplanImage(file);
      setImage(result); setGeometry(null); setReview(false); setZoom(1); setPan([0, 0]); setMode("select"); setPoints([]); setScaleChecked(false); setHistory([]); setFuture([]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "图片处理失败，请重试。"); }
    finally { setBusy(false); }
    if (inputRef.current) inputRef.current.value = "";
  }

  // The upload surface is the entry point: once the image is prepared, start recognition automatically.
  useEffect(() => {
    if (image && !review && !geometry) void recognize();
    // Recognition is intentionally tied to the selected image only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  async function reattachImage(file?: File) {
    if (!file || !geometry) return;
    setBusy(true); setError("");
    try {
      const result = await processFloorplanImage(file);
      if (result.width !== geometry.source.width || result.height !== geometry.source.height) throw new Error(`请附加与识别时同尺寸的原图（${geometry.source.width} × ${geometry.source.height}），或返回上传重新识别。`);
      setImage(result); setNotice("原图已附加，当前校对内容已保留。");
      if (!await saveFloorplanDraft(geometry.id, geometry, result.dataUrl)) setNotice("原图已附加。本机无法保存，当前仍可继续校对。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "原图附加失败。"); }
    finally { setBusy(false); }
    if (restoreImageRef.current) restoreImageRef.current.value = "";
  }

  async function transformImage(action: "left" | "right" | "crop") {
    if (!image) return;
    setBusy(true); setError("");
    try {
      const result = action === "crop" ? await cropFloorplanImage(image, points[0], points[1]) : await rotateFloorplanImage(image, action === "right");
      setImage(result); setMode("select"); setPoints([]); setZoom(1); setPan([0, 0]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "图片处理失败。"); }
    finally { setBusy(false); }
  }

  async function recognize() {
    if (!image) return;
    const controller = new AbortController(); abortRef.current = controller;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/floorplan/recognize", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: image.dataUrl, name: image.name, width: image.width, height: image.height }) });
      const body: unknown = await response.json().catch(() => null);
      const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
      if (!response.ok || !payload.geometry) throw new Error(typeof payload.error === "string" ? payload.error : "识别没有完成，请重试或手工描图。");
      const result = floorPlanGeometrySchema.safeParse(payload.geometry);
      if (!result.success) throw new Error("识别结果不完整，请重试或手工描图。");
      await saveFloorplanDraft(result.data.id, result.data, image.dataUrl);
      onConfirm(result.data);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "识别失败，请重试。"); }
    finally { if (abortRef.current === controller) { abortRef.current = null; setBusy(false); } }
  }

  function manualDraft() {
    if (!image) return;
    setGeometry({ version: 1, id: crypto.randomUUID(), source: { name: image.name, width: image.width, height: image.height }, outline: [], rooms: [], walls: [], openings: [], calibration: null, ceilingHeight: 2.8, confirmed: false, warnings: [] });
    setReview(true); setScaleChecked(false); setError(""); setNotice("手工描图：先沿原图点击外轮廓顶点，再补房间、墙线和门窗。"); chooseMode("outline");
  }

  function pointAt(event: { clientX: number; clientY: number }, svg: SVGSVGElement): Point {
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const matrix = svg.getScreenCTM(); const local = matrix ? point.matrixTransform(matrix.inverse()) : point;
    return [Math.round(Math.max(0, Math.min(sourceWidth, local.x)) * 10) / 10, Math.round(Math.max(0, Math.min(sourceHeight, local.y)) * 10) / 10];
  }

  function onCanvasDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (busy) return;
    const svg = event.currentTarget;
    if (mode === "select") {
      if (event.target !== svg && (event.target as SVGElement).tagName !== "image" && event.button !== 1) return;
      const start: Point = [event.clientX, event.clientY]; const origin = pan;
      const move = (pointer: PointerEvent) => setPan([origin[0] + pointer.clientX - start[0], origin[1] + pointer.clientY - start[1]]);
      const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", end, { once: true }); return;
    }
    const value = pointAt(event, svg);
    if (mode === "crop") {
      setPoints([value, value]);
      const move = (pointer: PointerEvent) => setPoints([value, pointAt(pointer, svg)]);
      const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", end, { once: true }); return;
    }
    if (mode === "calibrate") { setScaleChecked(false); setPoints(previous => previous.length >= 2 ? [value] : [...previous, value]); }
    else if (mode === "wall" && points.length === 1) {
      const newId = id("wall"); edit(draft => draft.walls.push({ id: newId, start: points[0], end: value, thicknessMm: 200, structural: "unknown" })); setSelection({ kind: "wall", id: newId }); setPoints([]); setMode("select");
    } else setPoints(previous => [...previous, value]);
  }

  function dragPoint(event: ReactPointerEvent<SVGCircleElement>, update: (draft: FloorPlanGeometry, point: Point) => void) {
    if (mode !== "select") return;
    event.stopPropagation(); event.preventDefault(); const svg = event.currentTarget.ownerSVGElement; if (!svg) return;
    saveHistory();
    const move = (pointer: PointerEvent) => edit(draft => update(draft, pointAt(pointer, svg)), false);
    const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end, { once: true }); window.addEventListener("pointercancel", end, { once: true });
  }

  function finishPolygon() {
    if (!geometry || points.length < 3) return;
    if (mode === "outline") { edit(draft => { draft.outline = points; }); setSelection({ kind: "outline", id: "outline" }); }
    else { const roomId = id("room"); edit(draft => draft.rooms.push({ id: roomId, name: `房间 ${draft.rooms.length + 1}`, polygon: points })); setSelection({ kind: "room", id: roomId }); }
    setPoints([]); setMode("select");
  }

  function calibrate() {
    const meters = Number(length);
    const reference = points.length === 2 ? { start: points[0], end: points[1] } : geometry?.calibration;
    if (!reference || !Number.isFinite(meters) || meters <= 0 || meters > 200 || Math.hypot(reference.end[0] - reference.start[0], reference.end[1] - reference.start[1]) < 2) { setError("请在图上选择两个不同的点，并输入 0–200 米内的真实长度。"); return; }
    edit(draft => { draft.calibration = { start: reference.start, end: reference.end, lengthMeters: meters, source: "manual" }; });
    setScaleChecked(true); setPoints([]); setMode("select"); setNotice("尺寸已确认。请继续检查房间边界和门窗位置。");
  }

  function addOpening(kind: FloorPlanOpening["kind"]) {
    const wall = selectedWall || geometry?.walls[0]; if (!wall) return;
    const openingId = id("opening"); edit(draft => draft.openings.push({ id: openingId, wallId: wall.id, kind, offset: .1, width: .2, swing: 1, entry: false })); setSelection({ kind: "opening", id: openingId });
  }

  async function confirm() {
    if (!geometry || issues.length || !scaleChecked) { setError(issues[0] || "请先确认尺寸校准。"); return; }
    setBusy(true);
    try {
      const result = copy(geometry); result.confirmed = true; result.warnings = [];
      if (!await saveFloorplanDraft(result.id, result, image?.dataUrl)) setNotice("本机无法保存原图，本次仍会生成户型。");
      onConfirm(result);
    } finally { setBusy(false); }
  }

  function undo() { const value = history.at(-1); if (!value || !geometry) return; setFuture(previous => [...previous, copy(geometry)]); setGeometry(value); setHistory(previous => previous.slice(0, -1)); setScaleChecked(false); }
  function redo() { const value = future.at(-1); if (!value || !geometry) return; setHistory(previous => [...previous, copy(geometry)]); setGeometry(value); setFuture(previous => previous.slice(0, -1)); setScaleChecked(false); }
  const handle = (point: Point, key: string | number, update: (draft: FloorPlanGeometry, point: Point) => void) => <circle key={key} cx={point[0]} cy={point[1]} r={Math.max(5, sourceWidth / 140)} className="floorplan-vertex" onPointerDown={event => dragPoint(event, update)} />;
  const select = (value: Selection) => { if (mode === "select") setSelection(value); };
  const drawing = mode === "room" || mode === "outline";
  const calibrationLine = points.length === 2 && mode === "calibrate" ? { start: points[0], end: points[1] } : geometry?.calibration;

  function locateIssue(issue: string) {
    if (!geometry) return;
    if (/校准|比例|尺寸/.test(issue)) { chooseMode("calibrate"); return; }
    chooseMode("select");
    const room = geometry.rooms.find(item => issue.includes(item.name));
    if (/外轮廓/.test(issue)) setSelection({ kind: "outline", id: "outline" });
    else if (room) setSelection({ kind: "room", id: room.id });
    else if (/门窗/.test(issue) && geometry.openings[0]) setSelection({ kind: "opening", id: geometry.openings[0].id });
    else if (/墙/.test(issue) && geometry.walls[0]) setSelection({ kind: "wall", id: geometry.walls[0].id });
    else setSelection({ kind: "outline", id: "outline" });
  }

  const properties = geometry && <div className="floorplan-properties-content">
    <h3>校对图元</h3>
    <label>选择图元<select value={selection ? `${selection.kind}:${selection.id}` : ""} onChange={event => { const [kind, itemId] = event.target.value.split(":"); setSelection(itemId ? { kind: kind as NonNullable<Selection>["kind"], id: itemId } : null); }}><option value="">选择房间、墙线或门窗</option><option value="outline:outline">户型外轮廓</option>{geometry.rooms.map(room => <option key={room.id} value={`room:${room.id}`}>{room.name}</option>)}{geometry.walls.map((wall, index) => <option key={wall.id} value={`wall:${wall.id}`}>墙线 {index + 1}</option>)}{geometry.openings.map((opening, index) => <option key={opening.id} value={`opening:${opening.id}`}>{openingNames[opening.kind]} {index + 1}</option>)}</select></label>
    {selection?.kind === "outline" && <><p className="floorplan-hint">拖动橙色顶点调整外轮廓。双击边界附近可补点。</p><button className="floorplan-secondary" onClick={() => chooseMode("outline")}>重新描外轮廓</button></>}
    {selectedRoom && <><label>房间名称<input value={selectedRoom.name} maxLength={60} onChange={event => edit(draft => { const room = draft.rooms.find(item => item.id === selectedRoom.id); if (room) room.name = event.target.value; })} /></label><p className="floorplan-hint">{currentScale ? `面积 ${roomMetrics(selectedRoom, geometry)?.area} ㎡` : "未校准，暂不计算面积"} · 拖动顶点调整边界</p><button className="floorplan-secondary danger" disabled={geometry.rooms.length <= 1} onClick={() => { edit(draft => { draft.rooms = draft.rooms.filter(room => room.id !== selectedRoom.id); }); setSelection(null); }}>删除此房间</button></>}
    {selectedWall && <><label>墙厚（毫米）<input type="number" min={60} max={1000} value={selectedWall.thicknessMm} onChange={event => edit(draft => { const wall = draft.walls.find(item => item.id === selectedWall.id); if (wall) wall.thicknessMm = Number(event.target.value); })} /></label><label>结构属性<select value={selectedWall.structural} onChange={event => edit(draft => { const wall = draft.walls.find(item => item.id === selectedWall.id); if (wall) wall.structural = event.target.value as typeof wall.structural; })}><option value="unknown">未知（默认保留）</option><option value="bearing">承重墙（已核实）</option><option value="partition">非承重墙（已核实）</option></select></label><p className="floorplan-hint">拖动两端点调整墙线；仅凭图片无法确定承重属性。</p><button className="floorplan-secondary danger" disabled={geometry.walls.length <= 1} onClick={() => { edit(draft => { draft.walls = draft.walls.filter(wall => wall.id !== selectedWall.id); draft.openings = draft.openings.filter(opening => opening.wallId !== selectedWall.id); }); setSelection(null); }}>删除墙线及其门窗</button></>}
    {selectedOpening && <><label>类型<select value={selectedOpening.kind} onChange={event => edit(draft => { const opening = draft.openings.find(item => item.id === selectedOpening.id); if (opening) { opening.kind = event.target.value as typeof opening.kind; if (opening.kind !== "door") opening.entry = false; } })}>{Object.entries(openingNames).map(([kind, name]) => <option key={kind} value={kind}>{name}</option>)}</select></label><label>所属墙线<select value={selectedOpening.wallId} onChange={event => edit(draft => { const opening = draft.openings.find(item => item.id === selectedOpening.id); if (opening) opening.wallId = event.target.value; })}>{geometry.walls.map((wall, index) => <option key={wall.id} value={wall.id}>墙线 {index + 1}</option>)}</select></label><label>距墙起点（%）<input type="number" min={0} max={99} step={1} value={Math.round(selectedOpening.offset * 100)} onChange={event => edit(draft => { const opening = draft.openings.find(item => item.id === selectedOpening.id); if (opening) opening.offset = Number(event.target.value) / 100; })} /></label><label>占墙长度（%）<input type="number" min={1} max={100} step={1} value={Math.round(selectedOpening.width * 100)} onChange={event => edit(draft => { const opening = draft.openings.find(item => item.id === selectedOpening.id); if (opening) opening.width = Number(event.target.value) / 100; })} /></label>{selectedOpening.kind === "door" && <><label>开启侧<select value={selectedOpening.swing} onChange={event => edit(draft => { const opening = draft.openings.find(item => item.id === selectedOpening.id); if (opening) opening.swing = Number(event.target.value) as 1 | -1; })}><option value={1}>墙线左侧</option><option value={-1}>墙线右侧</option></select></label><label className="floorplan-entry-door"><span>标记为入户门（用于玄关锚点和主通路）</span><input type="checkbox" aria-label="标记为入户门" checked={Boolean(selectedOpening.entry)} onChange={event => edit(draft => { for (const opening of draft.openings) if (opening.kind === "door") opening.entry = false; const opening = draft.openings.find(item => item.id === selectedOpening.id); if (opening) opening.entry = event.target.checked; })} /></label></>}<button className="floorplan-secondary danger" onClick={() => { edit(draft => { draft.openings = draft.openings.filter(item => item.id !== selectedOpening.id); }); setSelection(null); }}>删除门窗</button></>}
    <label>层高（米）<input type="number" min={2} max={6} step={.1} value={geometry.ceilingHeight} onChange={event => edit(draft => { draft.ceilingHeight = Number(event.target.value); })} /></label>
  </div>;

  return <div className={`floorplan-import-backdrop${review ? " is-review" : " is-upload"}`}><section className="floorplan-import" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="floorplan-import-title" tabIndex={-1}>
    {review && <header className="floorplan-import-header"><div><span className="floorplan-eyebrow">户型图导入</span><h2 id="floorplan-import-title">校准并校对户型</h2><p>对照原图修正边界、墙线与门窗，再进入现有 2D / 3D 编辑器。</p></div><button className="floorplan-icon-button" onClick={close} aria-label="关闭户型图导入">×</button></header>}
    <div className={`floorplan-import-body${review ? " is-review" : ""}`}>
      <aside className="floorplan-import-sidebar">
        <ol className="floorplan-steps" aria-label="导入进度"><li className={!review ? "active" : "done"}>1 <b>上传识别</b></li><li className={review ? "active" : ""}>2 <b>校准校对</b></li><li>3 <b>2D / 3D 户型</b></li></ol>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event => void chooseFile(event.target.files?.[0])} />
        <input ref={restoreImageRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event => void reattachImage(event.target.files?.[0])} />
        {review && !image && <button className="floorplan-secondary" onClick={() => restoreImageRef.current?.click()} disabled={busy}>附加原图作对照</button>}
        {!review && <div className="floorplan-upload-panel"><button className="floorplan-upload-drop" onClick={() => inputRef.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void chooseFile(event.dataTransfer.files[0]); }} disabled={busy}><strong>{image ? "重新选择图片" : "点击或拖入户型图"}</strong><small>JPG、PNG、WebP · 最大 10MB</small></button>{image && <><div className="floorplan-file-meta"><span>{image.name}</span><small>{image.width} × {image.height}</small></div><div className="floorplan-row-actions"><button onClick={() => void transformImage("left")} disabled={busy}>左转 90°</button><button onClick={() => void transformImage("right")} disabled={busy}>右转 90°</button><button onClick={() => chooseMode(mode === "crop" ? "select" : "crop")} disabled={busy}>{mode === "crop" ? "取消裁剪" : "框选裁剪"}</button></div>{mode === "crop" && <><p className="floorplan-hint">在图片上拖出需要保留的区域。</p><button className="floorplan-secondary" onClick={() => void transformImage("crop")} disabled={points.length !== 2 || busy}>应用裁剪</button></>}<button className="floorplan-primary" onClick={() => void recognize()} disabled={busy}>{busy ? "正在识别图纸…" : "开始识别"}</button>{busy ? <button className="floorplan-secondary" onClick={() => { abortRef.current?.abort(); setBusy(false); }}>取消识别</button> : <button className="floorplan-secondary" onClick={manualDraft}>手工描图</button>}</>}</div>}
        {review && geometry && <div className="floorplan-review-panel"><div className="floorplan-toolbar"><button className={mode === "select" ? "selected" : ""} onClick={() => chooseMode("select")}>选择 / 平移</button><button className={mode === "calibrate" ? "selected" : ""} onClick={() => chooseMode("calibrate")}>尺寸校准</button><button onClick={() => chooseMode("outline")}>描外轮廓</button><button onClick={() => chooseMode("room")}>加房间</button><button onClick={() => chooseMode("wall")}>加墙线</button><button onClick={() => addOpening("door")} disabled={!geometry.walls.length}>加门</button><button onClick={() => addOpening("window")} disabled={!geometry.walls.length}>加窗</button><button onClick={() => addOpening("passage")} disabled={!geometry.walls.length}>加洞口</button></div><div className="floorplan-row-actions"><button disabled={!history.length} onClick={undo}>撤销</button><button disabled={!future.length} onClick={redo}>重做</button></div>{drawing && <div className="floorplan-calibration"><strong>{mode === "outline" ? "沿外轮廓依次点选顶点" : "沿房间边界依次点选顶点"}</strong><small>至少 3 点，保留凹凸和斜边。</small><button disabled={points.length < 3} onClick={finishPolygon}>完成{mode === "outline" ? "外轮廓" : "房间"}（{points.length} 点）</button><button onClick={() => setPoints(previous => previous.slice(0, -1))} disabled={!points.length}>退回一点</button></div>}{mode === "wall" && <p className="floorplan-hint">依次点选墙线的起点、终点。</p>}<div className="floorplan-calibration"><strong>尺寸校准{scaleChecked ? " · 已确认" : " · 待确认"}</strong><small>{mode === "calibrate" ? `在图上点选一段已知长度的两端（${points.length}/2）` : geometry.calibration ? "读取到参考尺寸，请核对后确认。" : "选择“尺寸校准”，在图上点击两点。"}</small><label>参考长度（米）<input type="number" min={.01} max={200} step={.01} value={length} onChange={event => { setLength(event.target.value); setScaleChecked(false); }} /></label><button onClick={calibrate}>确认尺寸</button></div><label className="floorplan-range">底图透明度<input type="range" min={0} max={1} step={.05} value={opacity} onChange={event => setOpacity(Number(event.target.value))} /></label><div className="floorplan-validation">{issues.length ? <><strong>需要处理 {issues.length} 项</strong>{issues.map(issue => <button className="floorplan-issue-link" key={issue} onClick={() => locateIssue(issue)}>{issue}<span>定位修正 →</span></button>)}</> : <strong className="ok">图元检查通过</strong>}</div>{geometry.warnings.length > 0 && <details className="floorplan-recognition-notes"><summary>识别时的提示（{geometry.warnings.length}）</summary>{geometry.warnings.map(warning => <p key={warning}>{warning}</p>)}<button className="floorplan-secondary" onClick={() => edit(draft => { draft.warnings = []; })}>这些提示已核对</button></details>}<button className="floorplan-primary" onClick={() => void confirm()} disabled={Boolean(issues.length) || !scaleChecked || busy}>确认并生成 2D / 3D</button><button className="floorplan-secondary" onClick={() => { setReview(false); chooseMode("select"); }}>返回上传（重新识别）</button><details className="floorplan-mobile-properties"><summary>房间、墙线与门窗属性</summary>{properties}</details></div>}
        {error && <div className="floorplan-error" role="alert">{error}</div>}{notice && <p className="floorplan-notice" role="status">{notice}</p>}
      </aside>
      <main className="floorplan-canvas-wrap" aria-label="户型图上传与识别" onClick={!review && !busy ? () => inputRef.current?.click() : undefined} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!review && !busy) void chooseFile(event.dataTransfer.files[0]); }}>
        {!review && <div className="upload-status" onClick={event => event.stopPropagation()}><button onClick={close} aria-label="关闭户型图导入">关闭</button>{busy && <span role="status">正在识别户型图…</span>}{error && <><span role="alert">{error}</span><button onClick={() => void recognize()}>重试</button><button onClick={manualDraft}>手工描图</button></>}{busy && <button onClick={() => { abortRef.current?.abort(); setBusy(false); }}>取消识别</button>}</div>}
        {image || geometry ? <svg className="floorplan-review-canvas" viewBox={`0 0 ${sourceWidth} ${sourceHeight}`} style={{ transform: `translate(${pan[0]}px,${pan[1]}px) scale(${zoom})` }} onPointerDown={onCanvasDown}>
          <rect width={sourceWidth} height={sourceHeight} fill="#fff" pointerEvents="none" />{image && <image href={image.dataUrl} width={sourceWidth} height={sourceHeight} opacity={review ? opacity : 1} />}
          {review && geometry && <>
            <polygon className="floorplan-outline" points={pointsAttr(geometry.outline)} onClick={() => select({ kind: "outline", id: "outline" })} onDoubleClick={event => { if (mode !== "select" || selection?.kind !== "outline") return; const svg = event.currentTarget.ownerSVGElement; if (!svg) return; const point = pointAt(event, svg); edit(draft => { let nearest = 0, minimum = Infinity; for (let i = 0; i < draft.outline.length; i++) { const a = draft.outline[i], b = draft.outline[(i + 1) % draft.outline.length]; const distance = Math.hypot(point[0] - (a[0] + b[0]) / 2, point[1] - (a[1] + b[1]) / 2); if (distance < minimum) { nearest = i; minimum = distance; } } draft.outline.splice(nearest + 1, 0, point); }); }} />
            {geometry.rooms.map(room => <g key={room.id}><polygon className={selectedRoom?.id === room.id ? "floorplan-room selected" : "floorplan-room"} points={pointsAttr(room.polygon)} onClick={() => select({ kind: "room", id: room.id })} /><text x={room.polygon.reduce((sum, point) => sum + point[0], 0) / room.polygon.length} y={room.polygon.reduce((sum, point) => sum + point[1], 0) / room.polygon.length} textAnchor="middle" className="floorplan-room-label" style={{ fontSize: sourceWidth / 55 }}>{room.name}</text></g>)}
            {geometry.walls.map(wall => <line key={wall.id} x1={wall.start[0]} y1={wall.start[1]} x2={wall.end[0]} y2={wall.end[1]} className={selectedWall?.id === wall.id ? "floorplan-wall selected" : "floorplan-wall"} style={{ strokeWidth: Math.max(sourceWidth / 150, 5) }} onClick={() => select({ kind: "wall", id: wall.id })} />)}
            {geometry.openings.map(opening => { const wall = geometry.walls.find(item => item.id === opening.wallId); if (!wall) return null; const along = (value: number): Point => [wall.start[0] + (wall.end[0] - wall.start[0]) * value, wall.start[1] + (wall.end[1] - wall.start[1]) * value]; const a = along(opening.offset), b = along(opening.offset + opening.width); return <line key={opening.id} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={`floorplan-opening-line ${opening.kind}${selectedOpening?.id === opening.id ? " selected" : ""}`} style={{ strokeWidth: Math.max(sourceWidth / 100, 8) }} onClick={() => select({ kind: "opening", id: opening.id })} />; })}
            {selection?.kind === "outline" && geometry.outline.map((point, index) => handle(point, `outline-${index}`, (draft, value) => { draft.outline[index] = value; }))}
            {selectedRoom?.polygon.map((point, index) => handle(point, `room-${index}`, (draft, value) => { const room = draft.rooms.find(item => item.id === selectedRoom.id); if (room) room.polygon[index] = value; }))}
            {selectedWall && [handle(selectedWall.start, "wall-start", (draft, value) => { const wall = draft.walls.find(item => item.id === selectedWall.id); if (wall) wall.start = value; }), handle(selectedWall.end, "wall-end", (draft, value) => { const wall = draft.walls.find(item => item.id === selectedWall.id); if (wall) wall.end = value; })]}
            {calibrationLine && <line className="floorplan-calibration-line" x1={calibrationLine.start[0]} y1={calibrationLine.start[1]} x2={calibrationLine.end[0]} y2={calibrationLine.end[1]} />}
          </>}
          {points.length > 0 && mode !== "crop" && <><polyline className="floorplan-drawing-line" points={pointsAttr(points)} />{points.map((point, index) => <circle key={index} cx={point[0]} cy={point[1]} r={sourceWidth / 150} className="floorplan-drawing-point" />)}</>}
          {mode === "crop" && points.length === 2 && <rect x={Math.min(points[0][0], points[1][0])} y={Math.min(points[0][1], points[1][1])} width={Math.abs(points[0][0] - points[1][0])} height={Math.abs(points[0][1] - points[1][1])} className="floorplan-crop-box" />}
        </svg> : <div className="floorplan-empty"><span className="floorplan-upload-grid" aria-hidden="true"><svg viewBox="0 0 64 48" fill="none"><path d="M32 5v27m0-27L22 15m10-10 10 10M8 29v12h48V29" /></svg></span><strong>{busy ? "正在识别户型图…" : "点击此处上传户型图"}</strong><small>{error || "JPG、PNG、WebP · 识别完成后直接进入可编辑工作台"}</small></div>}
        {(image || geometry) && <div className="floorplan-zoom-controls"><button onClick={() => setZoom(value => Math.max(.5, value - .25))} aria-label="缩小原图">−</button><button onClick={() => { setZoom(1); setPan([0, 0]); }}>适应</button><button onClick={() => setZoom(value => Math.min(5, value + .25))} aria-label="放大原图">＋</button></div>}
      </main>
      {review && <aside className="floorplan-properties">{properties}</aside>}
    </div>
  </section></div>;
}

export default FloorplanImport;
