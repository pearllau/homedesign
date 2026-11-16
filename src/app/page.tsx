"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { extractPlan as extractJson, getMessageText, type Plan } from "@/shared/plan-data";
import { useChat } from "@ai-sdk/react";
import { useChatStore } from "@/features/studio/lib/store";
import { GenerationFeedback, type GenerationPhase } from "@/features/studio/components/generation-feedback";
import { InspiraReveal } from "@/features/studio/components/inspira-reveal";
import { StudioViews } from "@/features/studio/components/studio-views";
import { prefersReducedMotion, studioMotion } from "@/features/studio/lib/studio-motion";
import { pixelArea, roomMetrics, type FloorPlanGeometry } from "@/shared/floorplan-geometry";
import { FloorplanImport } from "@/features/studio/components/floorplan-import";
import { compactDesignMessages } from "@/features/studio/lib/floorplan-chat";
import { viewerSrc } from "@/shared/viewer-contract";

function money(v: number): string {
  return "¥" + v.toLocaleString("zh-CN");
}

// 识别出的坐标换算会产生 5.430000000000001 这类浮点尾巴，展示前统一收两位。
function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

// 语言切换使用下拉选择，避免二态按钮让人猜不出当前语言。
const LANGUAGES = [
  { id: "zh", label: "简体中文" },
  { id: "zht", label: "繁體中文" },
  { id: "en", label: "English" },
] as const;

type LanguageId = (typeof LANGUAGES)[number]["id"];

// 语言只作用于三维工作台；对话内容不翻译，所以没有方案时直接禁用，避免点了没反应。
// 不做持久化：页面每次重载都从简体中文开始，和「对话只在内存里」保持一致。
function LanguageSwitch({ disabled }: { disabled?: boolean }) {
  const [language, setLanguage] = useState<LanguageId>("zh");
  return (
    <label className="studio-language-field text-xs text-muted" title="只切换三维工作台的界面语言，对话内容不翻译">
      <select
        aria-label="切换三维工作台语言"
        className="studio-language-select border border-line bg-surface px-2 py-1 text-xs text-ink"
        value={language}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value as LanguageId;
          setLanguage(next);
          document.documentElement.dataset.workbenchLanguage = next;
          document.querySelector<HTMLIFrameElement>(".studio-design-view iframe")?.contentWindow?.postMessage({ type: "studio-language", language: next }, window.location.origin);
        }}
      >
        {LANGUAGES.map((item) => (
          <option key={item.id} value={item.id}>{item.label}</option>
        ))}
      </select>
    </label>
  );
}

// 把方案转成可读纯文本（用于复制/分享）
function planToText(plan: Plan): string {
  const lines: string[] = [];
  lines.push(`【${plan.style}】${plan.overview}`);
  lines.push(`${plan.floorPlan ? "方案计价面积" : "建筑面积"}：${num(plan.totalArea)}㎡`);
  lines.push(plan.floorPlan && (plan.budget?.items?.length ?? 0) === 0 ? "总预算：待补充装修需求" : `总预算：${money(plan.budget?.total ?? 0)}`);
  lines.push("");
  lines.push("户型与房间：");
  (plan.rooms || []).forEach((r) => {
    const furn = r.furniture?.length
      ? "（" + r.furniture.map((f) => `${f.name}×${f.count}`).join("、") + "）"
      : "";
    lines.push(`· ${r.name}：${plan.floorPlan ? "" : `${num(r.width)}×${num(r.length)}m，`}${num(r.area)}㎡${furn}`);
  });
  lines.push("");
  lines.push("预算明细：");
  (plan.budget?.items || []).forEach((it) => {
    lines.push(`· ${it.category}｜${it.item}：${money(it.cost)}`);
  });
  if ((plan.budget?.items?.length ?? 0) > 0) lines.push(`合计：${money(plan.budget?.total ?? 0)}`);
  if (plan.highlights?.length) {
    lines.push("");
    lines.push("方案亮点：");
    plan.highlights.forEach((h: string, i: number) =>
      lines.push(`${i + 1}. ${h}`),
    );
  }
  return lines.join("\n");
}

// 思考中占位：只展示呼吸圆点，不暴露工具调用与中间 JSON
function Thinking({ phase }: { phase: GenerationPhase }) {
  return (
    <GenerationFeedback phase={phase} />
  );
}

// 新消息首次出现时轻微上浮；只在挂载时播一次，流式更新与重渲染不会重放。
function MessageIn({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || prefersReducedMotion()) return;
    node.animate(
      [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: studioMotion.reveal, easing: studioMotion.ease, fill: "backwards" },
    );
  }, []);
  return <div ref={ref} className={className}>{children}</div>;
}

// 方案卡片（把 AI 生成的结构化 JSON 渲染成可读界面）
function PlanCard({ plan, onOpenDesign }: { plan: Plan; onOpenDesign: (origin: HTMLButtonElement) => void }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(planToText(plan));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // 剪贴板不可用则忽略
    }
  }

  return (
    <InspiraReveal className="overflow-hidden border border-line bg-surface">
      <article data-testid="plan-card">
      {/* 方案摘要 */}
      <div className="border-b border-line bg-surface-muted px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-serif text-lg leading-7 text-ink">{plan.style}</p>
            <p className="mt-1 font-mono text-xs text-muted">{num(plan.totalArea)}㎡ · 方案预览</p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <button onClick={(event) => onOpenDesign(event.currentTarget)} className="bg-ink-strong px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-muted">查看户型</button>
            <button onClick={handleCopy} className="border border-line bg-surface px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-muted hover:text-ink">{copied ? "已复制" : "复制方案"}</button>
          </div>
        </div>
        <p className="mt-3 text-sm leading-6 text-ink">{plan.overview}</p>
      </div>

      {/* 房间列表 */}
      <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
        {plan.rooms?.map((r, i) => (
          <InspiraReveal key={r.name} delay={i * studioMotion.stagger} className="border border-line p-4">
            <div className="flex items-baseline justify-between">
              <span className="font-medium text-ink">{r.name}</span>
              <span className="font-mono text-xs text-muted">
                {plan.floorPlan ? "" : `${num(r.width)}×${num(r.length)}m · `}{num(r.area)}㎡
              </span>
            </div>
            {r.furniture && r.furniture.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {r.furniture.map((f) => (
                  <span
                    key={f.name}
                    className="border border-line bg-surface-muted px-2 py-0.5 text-xs text-muted"
                  >
                    {f.name} ×{f.count}
                  </span>
                ))}
              </div>
            )}
            {r.notes && (
              <p className="mt-3 text-xs leading-5 text-muted">{r.notes}</p>
            )}
          </InspiraReveal>
        ))}
      </div>

      {/* 预算明细 */}
      <div className="border-t border-line p-5">
        <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
          预算明细
        </div>
        {plan.floorPlan && plan.budget.items.length === 0 ? <p className="text-sm text-muted">切回对话，补充预算与风格后生成装修方案。</p> : <div className="space-y-2">
          {plan.budget?.items?.map((it) => (
            <div
              key={it.item}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-muted">
                <span className="mr-2 bg-surface-muted px-1.5 py-0.5 text-xs text-muted">
                  {it.category}
                </span>
                {it.item}
              </span>
              <span className="font-mono text-ink">{money(it.cost)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-line pt-3 text-sm">
            <span className="font-medium text-ink">合计</span>
            <span className="font-mono text-base font-semibold text-accent">
              {money(plan.budget?.total)}
            </span>
          </div>
        </div>}
      </div>

      {/* 亮点 */}
      {plan.highlights && plan.highlights.length > 0 && (
        <div className="border-t border-line p-5">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
            方案亮点
          </div>
          <ul className="space-y-1.5 pl-4 text-sm leading-6 text-ink">
            {plan.highlights.map((h: string) => (
              <li key={h} className="list-disc">
                {h}
              </li>
            ))}
          </ul>
        </div>
      )}
      </article>
    </InspiraReveal>
  );
}

// 单条 AI 消息：生成中只显示思考状态，完成后渲染结构化方案
function AssistantMessage({
  parts,
  streaming,
  phase,
  onRetry,
  onOpenDesign,
}: {
  parts: UIMessage["parts"];
  streaming: boolean;
  phase: GenerationPhase;
  onRetry: () => void;
  onOpenDesign: (plan: Plan, origin: HTMLButtonElement) => void;
}) {
  const fullText = getMessageText(parts);
  const plan = extractJson(fullText);

  // 生成中：不展示工具调用与流式 JSON，只给思考提示
  if (!plan && streaming) {
    return (
      <div className="w-full min-w-0 sm:max-w-[85%]">
        <Thinking phase={phase} />
      </div>
    );
  }

  if (plan) {
    return (
      <div className="w-full min-w-0 sm:max-w-[85%]">
        <PlanCard plan={plan} onOpenDesign={(origin) => onOpenDesign(plan, origin)} />
      </div>
    );
  }

  // 兜底：模型没有按 JSON 输出时给温和提示，不把原始 JSON 倒出来
  if (/^\s*[[{]/.test(fullText)) {
    return (
      <div className="max-w-[85%]"><GenerationFeedback phase="incomplete" onRetry={onRetry} /></div>
    );
  }

  return fullText ? (
    <InspiraReveal className="max-w-[85%] whitespace-pre-wrap border border-line bg-surface px-4 py-3 text-sm leading-6">
      {fullText}
    </InspiraReveal>
  ) : null;
}

// 从方案里提取户型数据，并生成稳定签名（供 iframe 内 floorplan-3d 使用）
function buildPlanPayload(plan: Plan) {
  const rooms = (plan.rooms || []).map((r) => ({
    name: String(r.name || "房间"),
    width: num(r.width),
    length: num(r.length),
    area: num(r.area),
    furniture: (r.furniture || []).map((f) => ({
      name: String(f.name || ""),
      count: Number(f.count) || 1,
    })),
  }));
  const key = JSON.stringify({
    style: plan.style,
    totalArea: plan.totalArea,
    rooms,
    floorPlan: plan.floorPlan,
  });
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  return {
    sig: h.toString(36),
    data: { style: plan.style, totalArea: plan.totalArea, rooms, floorPlan: plan.floorPlan },
  };
}

function planFromFloorPlan(geometry: FloorPlanGeometry, previous?: Plan | null): Plan {
  const existingPlan = previous?.floorPlan?.id === geometry.id ? previous : null;
  const rooms = geometry.rooms.map(room => {
    const scale = Math.max(geometry.source.width, geometry.source.height) / 12;
    const xs = room.polygon.map(p => p[0]), ys = room.polygon.map(p => p[1]);
    const metric = roomMetrics(room, geometry) || { width: Math.max(.01, (Math.max(...xs) - Math.min(...xs)) / scale), length: Math.max(.01, (Math.max(...ys) - Math.min(...ys)) / scale), area: Math.max(.01, pixelArea(room.polygon) / scale ** 2) };
    const previousName = existingPlan?.floorPlan?.rooms.find(item => item.id === room.id)?.name;
    const existing = existingPlan?.rooms.find(item => item.name === (previousName || room.name));
    return { name: room.name, width: num(metric.width), length: num(metric.length), area: num(metric.area), furniture: existing?.furniture || [], notes: existing?.notes };
  });
  return {
    style: existingPlan?.style || "原始户型",
    overview: !geometry.calibration ? "已还原图纸边界。当前尺寸为临时预览比例，请在工作台「测量 · 尺寸校准」中填一段已知墙的真实长度；校准前面积与预算不可作为实际工程数据。" : existingPlan?.overview || "已按上传图纸还原户型。可在户型中布置家具，或切回对话补充风格与预算。",
    totalArea: existingPlan?.totalArea ?? num(rooms.reduce((sum, room) => sum + room.area, 0)),
    rooms,
    budget: existingPlan?.budget || { total: 0, items: [] },
    highlights: existingPlan?.highlights,
    floorPlan: geometry,
  };
}

// URL fragment 只由 iframe 本地读取，不发送给服务器；禁用存储时也能展示方案。
function DesignView({ plan, visible }: { plan: Plan; visible: boolean }) {
  const { sig, data } = buildPlanPayload(plan);
  const fragment = encodeURIComponent(JSON.stringify({ sig, ...data }));
  const frameRef = useRef<HTMLIFrameElement>(null);

  // 工作台是独立文档：可见性与语言都要在加载完成后补发一次，否则首帧不同步。
  function announce() {
    const frame = frameRef.current?.contentWindow;
    if (!frame) return;
    frame.postMessage({ type: "studio-visibility", visible }, window.location.origin);
    const language = document.documentElement.dataset.workbenchLanguage || "zh";
    frame.postMessage({ type: "studio-language", language }, window.location.origin);
  }

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ type: "studio-visibility", visible }, window.location.origin);
  }, [visible]);

  return (
    <iframe
      ref={frameRef}
      key={sig}
      src={viewerSrc(fragment)}
      title="户型设计与 3D 预览"
      className="studio-viewer-frame h-full w-full border-0"
      onLoad={announce}
    />
  );
}

const SUGGESTIONS = [
  "90㎡ 三室两厅，预算 18 万，日式原木风",
  "120㎡ 大平层，四口之家，现代简约，需要书房",
  "35㎡ 单身公寓，小户型收纳怎么设计",
];

const ADJUST_SUGGESTIONS = [
  "总价控制在 12 万以内",
  "把客厅和阳台打通",
  "换成日式原木风",
];

const subscribeToClient = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export default function Home() {
  const isClient = useSyncExternalStore(subscribeToClient, clientSnapshot, serverSnapshot);
  useEffect(() => {
    document.documentElement.dataset.appReady = "true";
    window.dispatchEvent(new Event("app-ready"));
  }, []);
  return <ChatPage key={isClient ? "client" : "server"} initialMessages={[]} />;
}

function ChatPage({ initialMessages }: { initialMessages: UIMessage[] }) {
  const [view, setView] = useState<"chat" | "design">("chat");
  useEffect(() => {
    const syncPath = () => setView(window.location.pathname === "/design" || new URLSearchParams(window.location.search).get("view") === "design" ? "design" : "chat");
    syncPath();
    const onPopState = () => syncPath();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const [designPlan, setDesignPlan] = useState<Plan | null>(null);
  const [importSession, setImportSession] = useState<{ file: File } | null>(null);
  const [draggingFloorplan, setDraggingFloorplan] = useState(false);
  const floorplanInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const inputOrigin = useRef<DOMRect | null>(null);
  const sentBubble = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const previousCount = useRef(initialMessages.length);
  const [paused, setPaused] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  const exportTimer = useRef<number | null>(null);
  useEffect(() => () => { if (exportTimer.current) window.clearTimeout(exportTimer.current); }, []);
  const save = useChatStore((s) => s.setMessages);
  useEffect(() => {
    save([]);
    try { localStorage.removeItem("ai-decor-chat"); } catch { /* storage may be disabled */ }
  }, [save]);
  const [transport] = useState(() => new DefaultChatTransport({ prepareSendMessagesRequest: ({ messages, body }) => ({ body: { ...body, messages: compactDesignMessages(messages) } }) }));
  const { messages, sendMessage, status, setMessages, stop, error, clearError, regenerate } = useChat({
    transport,
    messages: initialMessages,
    onFinish({ message, messages: finishedMessages, isError, isAbort, isDisconnect }) {
      if (isAbort) {
        save(finishedMessages);
        setPaused(true);
        return;
      }
      if (isError || isDisconnect) return;
      save(finishedMessages);
      const finishedPlan = extractJson(getMessageText(message.parts));
      if (finishedPlan) {
        setPaused(false);
        setDesignPlan(finishedPlan);
        setView("design");
        if (window.location.pathname !== "/design") window.history.pushState({ view: "design" }, "", "/design");
      }
    },
    onError() {
      setView("chat");
    },
  });
  const [input, setInput] = useState("");

  const loading = status === "submitted" || status === "streaming";
  const phase: GenerationPhase = status === "streaming" ? "streaming" : "submitted";

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || view !== "chat" || !followRef.current) return;
    const frame = requestAnimationFrame(() => {
      scroll.scrollTo({ top: scroll.scrollHeight, behavior: "instant" });
      if (messages.length > previousCount.current && inputOrigin.current && sentBubble.current && !prefersReducedMotion()) {
        const from = inputOrigin.current;
        const to = sentBubble.current.getBoundingClientRect();
        sentBubble.current.animate([
          { opacity: 0.2, transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(.97)` },
          { opacity: 1, transform: "translate(0, 0) scale(1)" },
        ], { duration: studioMotion.reveal, easing: studioMotion.ease });
        inputOrigin.current = null;
      }
      previousCount.current = messages.length;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages.length, status, view]);

  // 提取最新方案（从最近一条 assistant 消息里解析）
  const latestPlan = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      const text = getMessageText(m.parts);
      const plan = extractJson(text);
      if (plan && plan.rooms) return plan;
    }
    return null;
  })();
  const activePlan = designPlan || latestPlan;

  useEffect(() => {
    if (view === "design" && !activePlan) {
      window.history.replaceState({ view: "chat" }, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }, [activePlan, view]);

  function confirmFloorPlan(geometry: FloorPlanGeometry) {
    const plan = planFromFloorPlan(geometry, activePlan);
    const next: UIMessage[] = [...messages,
      { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: `已导入户型图：${geometry.source.name}` }] },
      { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "text", text: JSON.stringify(plan) }] },
    ];
    setMessages(next);
    save(next);
    setDesignPlan(plan);
    setView("design");
    if (window.location.pathname !== "/design") window.history.pushState({ view: "design" }, "", "/design");
    setImportSession(null);
    setPaused(false);
    clearError();
  }

  // 视觉模型空闲后的第一次识别会明显变慢。用户点「上传户型图」时就开始预热，
  // 让冷启动发生在系统文件选择框打开的那段时间里，而不是选完图之后的等待里。
  function warmRecognition() {
    void fetch("/api/floorplan/recognize?warm=1", { method: "GET" }).catch(() => undefined);
  }

  // 首页卡片与顶栏共用：选中/拖入图片后直接进入识别，不再经过多余的全屏浮层。
  function acceptFloorplanFile(file?: File | null) {
    if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) return;
    setImportSession({ file });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    inputOrigin.current = inputRef.current?.getBoundingClientRect() || null;
    followRef.current = true;
    setPaused(false);
    setDesignPlan(null);
    clearError();
    void sendMessage({ text });
    setInput("");
  }

  function switchView(next: "chat" | "design", origin?: HTMLElement, plan?: Plan) {
    if (next === "design") {
      originRef.current = origin || inputRef.current;
      if (plan) setDesignPlan(plan);
    }
    setView(next);
    const target = next === "design" ? "/design" : "/";
    if (window.location.pathname + window.location.search !== target) window.history.pushState({ view: next }, "", target);
  }

  const onViewSettled = useCallback((next: "chat" | "design") => {
    if (next === "chat") {
      (originRef.current?.isConnected ? originRef.current : inputRef.current)?.focus({ preventScroll: true });
      return;
    }
    document.querySelector<HTMLIFrameElement>(".studio-design-view iframe")?.focus({ preventScroll: true });
  }, []);

  // 工作台在 iframe 里导出，父页面收不到完成事件；这里只用短暂提示告诉用户「已发出导出指令」。
  function exportPlan(format: "image" | "json") {
    const frame = document.querySelector<HTMLIFrameElement>(".studio-design-view iframe");
    if (!frame?.contentWindow) { setExportNotice("工作台还没准备好，请稍后再试。"); return; }
    frame.contentWindow.postMessage({ type: "studio-export", format }, window.location.origin);
    setExportNotice(format === "image" ? "正在导出图片…" : "正在下载方案文件…");
    if (exportTimer.current) window.clearTimeout(exportTimer.current);
    exportTimer.current = window.setTimeout(() => setExportNotice(""), 2600);
  }

  function retry() {
    setPaused(false);
    setDesignPlan(null);
    clearError();
    followRef.current = true;
    void regenerate();
  }

  return (
    <div className={`interior-studio flex h-dvh flex-col bg-canvas text-ink${messages.length === 0 ? " is-home" : ""}`} data-workspace={view === "design"}>
      {/* 顶栏 */}
      <header className="studio-header flex items-center justify-between border-b border-line bg-surface px-6 py-3">
        <div className="studio-header-main flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <span className="brand-mark" aria-label="间筑 Logo"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 17V5l7-3v12M10 6l7-3v12l-7 3M3 17l7-3 7 1" stroke="currentColor" strokeWidth="1.5"/></svg></span>
            <h1 className="brand-name text-base">间筑</h1>
          </div>
        </div>
        <div className="studio-header-actions flex items-center gap-2">
          {(view === "design" || messages.length > 0) && <button onClick={() => { warmRecognition(); floorplanInputRef.current?.click(); }} className="border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-muted hover:text-ink">上传户型图</button>}
          {view === "design" && <button onClick={() => switchView("chat")} className="border border-line px-2.5 py-1 text-xs text-ink transition-colors hover:border-muted">返回对话</button>}
          <LanguageSwitch disabled={!activePlan} />
          {activePlan && <details className="studio-export"><summary>导出</summary><div>
            <button onClick={() => exportPlan("image")}>导出图片</button>
            <button onClick={() => exportPlan("json")}>导出方案</button>
          </div></details>}
          {exportNotice && <span className="studio-export-notice" role="status">{exportNotice}</span>}
        </div>
      </header>

      <StudioViews view={view} onTransitionComplete={onViewSettled} design={activePlan ? <DesignView plan={activePlan} visible={view === "design"} /> : <div className="empty-workspace"><p>尚无户型方案，请先上传户型图或描述装修需求。</p><button onClick={() => switchView("chat")}>返回首页</button></div>} chat={(
        <>
          {/* 对话区 */}
          <main ref={scrollRef} className="studio-chat-scroll flex-1 overflow-y-auto px-6 py-10" onScroll={(event) => { const node = event.currentTarget; followRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120; }}>
            <div className="mx-auto flex max-w-3xl flex-col gap-6">
              {messages.length === 0 ? (
                <InspiraReveal className="flex flex-col items-center gap-5 pt-8 text-center">
                  <div>
                    <h2 className="font-serif text-3xl font-medium">
                      说出你的装修需求
                    </h2>
                  </div>
                  <div className="home-examples flex flex-wrap justify-center gap-4">
                    {SUGGESTIONS.map((s, index) => (
                      <InspiraReveal key={s} delay={(index + 1) * studioMotion.stagger}>
                      <button
                        onClick={() => { setInput(s); inputRef.current?.focus({ preventScroll: true }); }}
                        className="home-example border border-line bg-surface px-4 py-2 text-sm text-muted transition-colors hover:border-muted/40 hover:bg-surface-muted"
                      >
                        <span>{s}</span><span className="home-example-arrow" aria-hidden="true">↗</span>
                      </button>
                      </InspiraReveal>
                    ))}
                  </div>
                </InspiraReveal>
              ) : (
                messages.map((m, idx) => {
                  const isLast = idx === messages.length - 1;
                  if (m.role === "user") {
                    return (
                      <div key={m.id} className="flex justify-end">
                        <div
                          ref={isLast ? sentBubble : undefined}
                          className="max-w-[80%] whitespace-pre-wrap bg-ink-strong px-4 py-3 text-sm leading-6 text-white"
                        >
                          {getMessageText(m.parts)}
                        </div>
                      </div>
                    );
                  }
                  if (isLast && !loading && (error || paused) && !extractJson(getMessageText(m.parts))) return null;
                  return (
                    <MessageIn key={m.id} className="flex justify-start">
                      <AssistantMessage
                        parts={m.parts}
                        streaming={isLast && loading}
                        phase={phase}
                        onRetry={retry}
                        onOpenDesign={(plan, origin) => switchView("design", origin, plan)}
                      />
                    </MessageIn>
                  );
                })
              )}
              {/* 刚发出、助手消息还没落地时也先显示思考状态 */}
              {loading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex justify-start">
                  <Thinking phase={phase} />
                </div>
              )}
              {!loading && (error || paused) && <GenerationFeedback phase={error ? "error" : "paused"} errorMessage={error?.message} onRetry={retry} />}
            </div>
          </main>

          {messages.length === 0 && <button
            className={`home-upload-entry${draggingFloorplan ? " is-dragging" : ""}`}
            onClick={() => { warmRecognition(); floorplanInputRef.current?.click(); }}
            onDragOver={(event) => { event.preventDefault(); setDraggingFloorplan(true); }}
            onDragLeave={() => setDraggingFloorplan(false)}
            onDrop={(event) => { event.preventDefault(); setDraggingFloorplan(false); acceptFloorplanFile(event.dataTransfer.files?.[0]); }}
          >
            <svg viewBox="0 0 64 48" fill="none" aria-hidden="true"><path d="M32 5v27m0-27L22 15m10-10 10 10M8 29v12h48V29" /></svg>
            <strong>上传户型图</strong><span>点击选择或拖入图片 · 识别完成后直接进入可编辑工作台</span>
          </button>}
          {/* 输入区 */}
          <footer className="studio-footer border-t border-line bg-surface px-6 py-4">
            {messages.length > 0 && !loading && (
              <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-2">
                {ADJUST_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setInput(s); inputRef.current?.focus({ preventScroll: true }); }}
                    className="border border-line bg-surface-muted px-3 py-1 text-xs text-muted transition-colors hover:border-muted/40 hover:bg-surface"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <form
              onSubmit={handleSubmit}
              className="studio-composer mx-auto flex max-w-3xl items-center gap-2"
            >
              <input
                ref={inputRef}
                aria-label="装修需求"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="描述你的装修需求，或对当前方案提出修改…"
                className="min-w-0 flex-1 border border-line bg-surface-muted px-4 py-3 text-sm outline-none transition-colors focus:border-muted focus:bg-surface"
              />
              {loading ? <button type="button" className="studio-stop px-4 py-3 text-sm" onClick={() => { setPaused(true); void stop(); }}>停止生成</button> : <button
                type="submit"
                disabled={loading || !input.trim()}
                className="px-5 py-3 text-sm font-medium disabled:cursor-not-allowed"
              >
                <span aria-hidden="true">↑</span><span className="sr-only">发送</span>
              </button>}
            </form>
          </footer>
        </>
      )} />
      <input ref={floorplanInputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { acceptFloorplanFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
      {importSession && <FloorplanImport initialFile={importSession.file} onClose={() => setImportSession(null)} onConfirm={confirmFloorPlan} />}
    </div>
  );
}
