"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { extractPlan as extractJson, getMessageText, type Plan } from "@/lib/plan-data";
import { useChat } from "@ai-sdk/react";
import { useChatStore } from "@/lib/store";
import { GenerationFeedback, type GenerationPhase } from "@/components/studio/generation-feedback";
import { InspiraReveal } from "@/components/studio/inspira-reveal";
import { StudioViews } from "@/components/studio/studio-views";
import { prefersReducedMotion, studioMotion } from "@/lib/studio-motion";
import { roomMetrics, type FloorPlanGeometry } from "@/lib/floorplan-geometry";
import { FloorplanImport } from "@/components/studio/floorplan-import";
import { compactDesignMessages } from "@/lib/floorplan-chat";

function money(v: number): string {
  return "¥" + v.toLocaleString("zh-CN");
}

// 把方案转成可读纯文本（用于复制/分享）
function planToText(plan: Plan): string {
  const lines: string[] = [];
  lines.push(`【${plan.style}】${plan.overview}`);
  lines.push(`${plan.floorPlan ? "方案计价面积" : "建筑面积"}：${plan.totalArea}㎡`);
  lines.push(plan.floorPlan && plan.budget.items.length === 0 ? "总预算：待补充装修需求" : `总预算：${money(plan.budget?.total)}`);
  lines.push("");
  lines.push("户型与房间：");
  (plan.rooms || []).forEach((r) => {
    const furn = r.furniture?.length
      ? "（" + r.furniture.map((f) => `${f.name}×${f.count}`).join("、") + "）"
      : "";
    lines.push(`· ${r.name}：${plan.floorPlan ? "" : `${r.width}×${r.length}m，`}${r.area}㎡${furn}`);
  });
  lines.push("");
  lines.push("预算明细：");
  (plan.budget?.items || []).forEach((it) => {
    lines.push(`· ${it.category}｜${it.item}：${money(it.cost)}`);
  });
  if (plan.budget.items.length) lines.push(`合计：${money(plan.budget?.total)}`);
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
    <InspiraReveal className="overflow-hidden rounded-xl border border-line bg-surface">
      <article data-testid="plan-card">
      {/* 方案摘要 */}
      <div className="border-b border-line bg-surface-muted px-5 py-4">
        <div className="flex flex-wrap items-start justify-end gap-2">
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <button onClick={(event) => onOpenDesign(event.currentTarget)} className="rounded-md bg-ink-strong px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#333] active:scale-[0.98]">查看户型</button>
            <button onClick={handleCopy} className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-ink">{copied ? "已复制" : "复制方案"}</button>
          </div>
        </div>
        <p className="mt-2 text-sm leading-6 text-ink">{plan.overview}</p>
      </div>

      {/* 房间列表 */}
      <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
        {plan.rooms?.map((r, i) => (
          <InspiraReveal key={r.name} delay={i * studioMotion.stagger} className="rounded-xl border border-line p-4">
            <div className="flex items-baseline justify-between">
              <span className="font-medium text-ink">{r.name}</span>
              <span className="font-mono text-xs text-muted">
                {plan.floorPlan ? "" : `${r.width}×${r.length}m · `}{r.area}㎡
              </span>
            </div>
            {r.furniture && r.furniture.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {r.furniture.map((f) => (
                  <span
                    key={f.name}
                    className="rounded-full border border-line bg-surface-muted px-2 py-0.5 text-xs text-muted"
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
                <span className="mr-2 rounded bg-surface-muted px-1.5 py-0.5 text-xs text-muted">
                  {it.category}
                </span>
                {it.item}
              </span>
              <span className="font-mono text-ink">{money(it.cost)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-line pt-3 text-sm">
            <span className="font-medium text-ink">合计</span>
            <span className="font-mono text-base font-semibold text-pastel-green-fg">
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
    <InspiraReveal className="max-w-[85%] whitespace-pre-wrap rounded-xl border border-line bg-surface px-4 py-3 text-sm leading-6">
      {fullText}
    </InspiraReveal>
  ) : null;
}

// 从方案里提取户型数据，并生成稳定签名（供 iframe 内 floorplan-3d 使用）
function buildPlanPayload(plan: Plan) {
  const rooms = (plan.rooms || []).map((r) => ({
    name: String(r.name || "房间"),
    width: Number(r.width) || 0,
    length: Number(r.length) || 0,
    area: Number(r.area) || 0,
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
    const metric = roomMetrics(room, geometry)!;
    const previousName = existingPlan?.floorPlan?.rooms.find(item => item.id === room.id)?.name;
    const existing = existingPlan?.rooms.find(item => item.name === (previousName || room.name));
    return { name: room.name, ...metric, furniture: existing?.furniture || [], notes: existing?.notes };
  });
  return {
    style: existingPlan?.style || "原始户型",
    overview: existingPlan?.overview || "已按上传图纸还原户型。可在户型中布置家具，或切回对话补充风格与预算。",
    totalArea: existingPlan?.totalArea ?? Math.round(rooms.reduce((sum, room) => sum + room.area, 0) * 100) / 100,
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

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ type: "studio-visibility", visible }, window.location.origin);
  }, [visible]);

  return (
    <iframe
      ref={frameRef}
      key={sig}
      src={`/floorplan-3d.html?v=layout-4#plan=${fragment}`}
      title="户型设计与 3D 预览"
      className="h-full w-full border-0"
      onLoad={() => frameRef.current?.contentWindow?.postMessage({ type: "studio-visibility", visible }, window.location.origin)}
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
  const saved = useChatStore((s) => s.messages);
  useEffect(() => {
    document.documentElement.dataset.appReady = "true";
    window.dispatchEvent(new Event("app-ready"));
  }, []);
  return <ChatPage key={isClient ? "client" : "server"} initialMessages={isClient ? saved : []} />;
}

function ChatPage({ initialMessages }: { initialMessages: UIMessage[] }) {
  const [view, setView] = useState<"chat" | "design">(() =>
    initialMessages.some((message) => message.role === "assistant" && extractJson(getMessageText(message.parts))) ? "design" : "chat"
  );
  const [designPlan, setDesignPlan] = useState<Plan | null>(null);
  const [importSession, setImportSession] = useState<{ geometry?: FloorPlanGeometry } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const designTabRef = useRef<HTMLButtonElement>(null);
  const inputOrigin = useRef<DOMRect | null>(null);
  const sentBubble = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const previousCount = useRef(initialMessages.length);
  const [paused, setPaused] = useState(false);
  const save = useChatStore((s) => s.setMessages);
  const clearHistory = useChatStore((s) => s.clear);
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

  function confirmFloorPlan(geometry: FloorPlanGeometry) {
    const plan = planFromFloorPlan(geometry, activePlan);
    const next: UIMessage[] = [...messages,
      { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: `已校对户型图：${geometry.source.name}` }] },
      { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "text", text: JSON.stringify(plan) }] },
    ];
    setMessages(next);
    save(next);
    setDesignPlan(plan);
    setView("design");
    setImportSession(null);
    setPaused(false);
    clearError();
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

  function handleClear() {
    void stop();
    clearError();
    setMessages([]);
    clearHistory();
    setView("chat");
    setDesignPlan(null);
    originRef.current = inputRef.current;
    setPaused(false);
    setInput("");
    followRef.current = true;
    inputRef.current?.focus({ preventScroll: true });
  }

  function switchView(next: "chat" | "design", origin?: HTMLElement, plan?: Plan) {
    if (next === "design") {
      originRef.current = origin || inputRef.current;
      if (plan) setDesignPlan(plan);
    }
    setView(next);
  }

  const onViewSettled = useCallback((next: "chat" | "design") => {
    const target = next === "chat" ? (originRef.current?.isConnected ? originRef.current : inputRef.current) : designTabRef.current;
    target?.focus({ preventScroll: true });
  }, []);

  function retry() {
    setPaused(false);
    setDesignPlan(null);
    clearError();
    followRef.current = true;
    void regenerate();
  }

  const tabCls = (active: boolean) =>
    `rounded-md px-3 py-1 text-xs transition-colors ${
      active ? "bg-ink-strong text-white" : "text-muted hover:text-ink"
    }`;

  return (
    <div className="interior-studio flex h-dvh flex-col bg-canvas text-ink">
      {/* 顶栏 */}
      <header className="studio-header flex items-center justify-between border-b border-line bg-surface/80 px-6 py-3 backdrop-blur-sm">
        <div className="studio-header-main flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-pastel-green-fg" />
            <h1 className="text-base font-semibold tracking-tight">
              AI Interior Designer
            </h1>
          </div>
          {activePlan && (
            <nav className="studio-tabs flex items-center gap-1 rounded-lg border border-line bg-surface p-0.5" aria-label="设计视图" data-active={view}>
              <span className="studio-tab-pill" aria-hidden="true" />
              <button onClick={() => switchView("chat")} aria-pressed={view === "chat"} className={tabCls(view === "chat")}>
                对话
              </button>
              <button
                ref={designTabRef}
                onClick={(event) => switchView("design", event.currentTarget)}
                aria-pressed={view === "design"}
                className={tabCls(view === "design")}
              >
                户型设计
              </button>
            </nav>
          )}
        </div>
        <div className="flex items-center gap-2">
          {activePlan?.floorPlan && <button disabled={loading} onClick={() => setImportSession({ geometry: activePlan.floorPlan })} className="rounded-md border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:text-ink disabled:opacity-40">校对户型</button>}
          <button disabled={loading} onClick={() => setImportSession({})} className="rounded-md border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:text-ink disabled:opacity-40">上传户型图</button>
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              className="rounded-md border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:text-ink"
            >
              清空
            </button>
          )}
        </div>
      </header>

      <StudioViews view={view} onTransitionComplete={onViewSettled} design={activePlan ? <DesignView plan={activePlan} visible={view === "design"} /> : null} chat={(
        <>
          {/* 对话区 */}
          <main ref={scrollRef} className="studio-chat-scroll flex-1 overflow-y-auto px-6 py-10" onScroll={(event) => { const node = event.currentTarget; followRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120; }}>
            <div className="mx-auto flex max-w-3xl flex-col gap-6">
              {messages.length === 0 ? (
                <InspiraReveal className="flex flex-col items-center gap-8 pt-16 text-center">
                  <div>
                    <h2 className="text-3xl font-semibold tracking-tight">
                      说出你的装修需求
                    </h2>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {SUGGESTIONS.map((s, index) => (
                      <InspiraReveal key={s} delay={(index + 1) * studioMotion.stagger}>
                      <button
                        onClick={() => { setInput(s); inputRef.current?.focus({ preventScroll: true }); }}
                        className="rounded-full border border-line bg-surface px-4 py-2 text-sm text-muted transition-colors hover:border-muted/40 hover:bg-surface-muted"
                      >
                        {s}
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
                          className="max-w-[80%] whitespace-pre-wrap rounded-xl bg-ink-strong px-4 py-3 text-sm leading-6 text-white"
                        >
                          {getMessageText(m.parts)}
                        </div>
                      </div>
                    );
                  }
                  if (isLast && !loading && (error || paused) && !extractJson(getMessageText(m.parts))) return null;
                  return (
                    <div key={m.id} className="flex justify-start">
                      <AssistantMessage
                        parts={m.parts}
                        streaming={isLast && loading}
                        phase={phase}
                        onRetry={retry}
                        onOpenDesign={(plan, origin) => switchView("design", origin, plan)}
                      />
                    </div>
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

          {/* 输入区 */}
          <footer className="studio-footer border-t border-line bg-surface px-6 py-4">
            {messages.length > 0 && (
              <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-2">
                {ADJUST_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setInput(s); inputRef.current?.focus({ preventScroll: true }); }}
                    className="rounded-full border border-line bg-surface-muted px-3 py-1 text-xs text-muted transition-colors hover:border-muted/40 hover:bg-surface"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <form
              onSubmit={handleSubmit}
              className="mx-auto flex max-w-3xl items-center gap-2"
            >
              <input
                ref={inputRef}
                aria-label="装修需求"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="描述你的装修需求，或对当前方案提出修改…"
                className="min-w-0 flex-1 rounded-xl border border-line bg-surface-muted px-4 py-3 text-sm outline-none transition-colors focus:border-muted focus:bg-surface"
              />
              {loading ? <button type="button" className="studio-stop rounded-md border border-line px-4 py-3 text-sm" onClick={() => { setPaused(true); void stop(); }}>停止生成</button> : <button
                type="submit"
                disabled={loading || !input.trim()}
                className="rounded-md bg-ink-strong px-5 py-3 text-sm font-medium text-white transition-all hover:bg-[#333] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                发送
              </button>}
            </form>
          </footer>
        </>
      )} />
      {importSession && <FloorplanImport initialGeometry={importSession.geometry} onClose={() => setImportSession(null)} onConfirm={confirmFloorPlan} />}
    </div>
  );
}
