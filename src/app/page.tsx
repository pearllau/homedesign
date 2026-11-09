"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type MouseEvent } from "react";
import type { UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { extractPlan, getMessageText, type Plan } from "@/lib/plan-data";
import { useChatStore } from "@/lib/store";
import { Icon } from "@/components/studio/icon";
import { RoomScene } from "@/components/studio/room-scene";
import { DesignWorkspace } from "@/components/studio/design-workspace";

const money = (value: number) => "¥" + value.toLocaleString("zh-CN");
const SUGGESTIONS = [
  { text: "90㎡ 三室两厅，预算 18 万，日式原木风", title: "一家人的温暖日常", meta: "90 ㎡ / 三室两厅 / 日式原木" },
  { text: "120㎡ 大平层，四口之家，现代简约，需要书房", title: "留一间安静的书房", meta: "120 ㎡ / 四口之家 / 现代简约" },
  { text: "35㎡ 单身公寓，小户型收纳怎么设计", title: "小空间，也能好好生活", meta: "35 ㎡ / 单身公寓 / 灵活收纳" },
];
const ADJUST_SUGGESTIONS = ["总价控制在 12 万以内", "把客厅和阳台打通", "换成日式原木风"];

function planToText(plan: Plan) {
  return [
    `【${plan.style}】${plan.overview}`,
    `建筑面积：${plan.totalArea}㎡`,
    `总预算：${money(plan.budget.total)}`,
    "", "户型与房间：",
    ...plan.rooms.map((room) => `· ${room.name}：${room.width}×${room.length}m，${room.area}㎡${room.furniture?.length ? "（" + room.furniture.map((item) => `${item.name}×${item.count}`).join("、") + "）" : ""}`),
    "", "预算明细：",
    ...plan.budget.items.map((item) => `· ${item.category}｜${item.item}：${money(item.cost)}`),
    `合计：${money(plan.budget.total)}`,
    ...(plan.highlights?.length ? ["", "方案亮点：", ...plan.highlights.map((item, i) => `${i + 1}. ${item}`)] : []),
  ].join("\n");
}

type OpenWorkspace = (plan: Plan, id: string, event: MouseEvent<HTMLButtonElement>) => void;

function Thinking() {
  return <div className="thinking" role="status"><span className="thinking-mark"><i /><i /><i /></span><div><strong>正在梳理你的想法</strong><span>安排空间，也照顾预算。</span></div></div>;
}

function PlanCard({ plan, id, onOpen }: { plan: Plan; id: string; onOpen: OpenWorkspace }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(planToText(plan));
      setCopied(true); setCopyFailed(false);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch { setCopyFailed(true); }
  }

  return (
    <article className="plan-card" id={`plan-${id}`}>
      <div className="plan-card-heading"><span className="eyebrow">为你规划的家</span><span className="tag tag-sage"><Icon name="check" width="13" height="13" />方案已生成</span></div>
      <div className="plan-card-intro"><h3>{plan.style}</h3><p>{plan.overview}</p></div>
      <div className="plan-numbers"><div><span>建筑面积</span><strong>{plan.totalArea}<small>㎡</small></strong></div><div><span>整体预算</span><strong>{money(plan.budget.total)}</strong></div><div><span>空间规划</span><strong>{plan.rooms.length}<small>个空间</small></strong></div></div>
      <button className="plan-launch" onClick={(event) => onOpen(plan, id, event)} aria-haspopup="dialog" aria-label="打开设计工作台">
        <div className="plan-launch-illustration"><RoomScene compact /><span>2D / 3D</span></div>
        <div className="plan-launch-copy"><span className="eyebrow">从方案，走进空间</span><strong>看看家的布局</strong><span>摆放家具，挑选材质，再换个角度看看。</span><span className="launch-cta">打开设计工作台<Icon name="arrow" /></span></div>
      </button>
      <div className="plan-section"><div className="section-label"><h4>每个空间，都有安排</h4><span>{plan.rooms.length} 个空间</span></div><div className="room-list">{plan.rooms.map((room, index) => <div className="room-row" key={`${room.name}-${index}`}><span className="room-index">{String(index + 1).padStart(2, "0")}</span><div className="room-row-copy"><strong>{room.name}</strong><span>{room.furniture?.map((item) => `${item.name}${item.count > 1 ? ` × ${item.count}` : ""}`).join(" · ") || "可在工作台中继续布置"}</span>{room.notes && <p>{room.notes}</p>}</div><span className="room-size">{room.area} ㎡<small>{room.width} × {room.length} m</small></span></div>)}</div></div>
      <div className="plan-section"><div className="section-label"><h4>预算花在哪里</h4><span>参考估算</span></div><div className="budget-list">{plan.budget.items.map((item, index) => <div className="budget-row" key={`${item.item}-${index}`}><span className="budget-category">{item.category}</span><span>{item.item}</span><strong>{money(item.cost)}</strong></div>)}</div><div className="budget-total"><span>预计总计</span><strong>{money(plan.budget.total)}</strong></div></div>
      {!!plan.highlights?.length && <div className="plan-section"><div className="section-label"><h4>值得留意的小心思</h4></div><ul className="plan-highlights">{plan.highlights.map((item, index) => <li key={index}><span>{String(index + 1).padStart(2, "0")}</span>{item}</li>)}</ul></div>}
      <div className="plan-card-footer"><span>{copyFailed ? "暂时无法复制，可选中方案文字保存。" : "尺寸与预算供参考，落地前请结合实际测量。"}</span><button className="button button-quiet" onClick={copy}><Icon name={copied ? "check" : "copy"} width="16" height="16" />{copied ? "已复制" : "复制方案"}</button></div>
    </article>
  );
}

function AssistantMessage({ message, streaming, onOpen }: { message: UIMessage; streaming: boolean; onOpen: OpenWorkspace }) {
  const text = getMessageText(message.parts);
  const plan = extractPlan(text);
  if (streaming) return <Thinking />;
  if (plan) return <PlanCard plan={plan} id={message.id} onOpen={onOpen} />;
  if (/^\s*[[{]/.test(text)) return <div className="message-text message-warning">这次方案还不完整。你可以补充需求，让我重新整理一份。</div>;
  return text ? <div className="message-text">{text}</div> : null;
}

const subscribeToClient = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export default function Home() {
  const isClient = useSyncExternalStore(subscribeToClient, clientSnapshot, serverSnapshot);
  const saved = useChatStore((state) => state.messages);
  useEffect(() => {
    document.documentElement.dataset.appReady = "true";
    window.dispatchEvent(new Event("app-ready"));
  }, []);
  return <ChatPage key={isClient ? "client" : "server"} initialMessages={isClient ? saved : []} />;
}

function ChatPage({ initialMessages }: { initialMessages: UIMessage[] }) {
  const save = useChatStore((state) => state.setMessages);
  const clearHistory = useChatStore((state) => state.clear);
  const { messages, sendMessage, status, setMessages, stop, error, clearError } = useChat({
    messages: initialMessages,
    onFinish({ messages: finished, isError, isAbort, isDisconnect }) {
      if (!isError && !isAbort && !isDisconnect) save(finished);
    },
  });
  const [input, setInput] = useState("");
  const [selected, setSelected] = useState<{ plan: Plan; id: string } | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [resetPrompt, setResetPrompt] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<HTMLButtonElement | null>(null);
  const followRef = useRef(true);
  const loading = status === "submitted" || status === "streaming";
  const latest = (() => {
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index].role !== "assistant") continue;
      const plan = extractPlan(getMessageText(messages[index].parts));
      if (plan) return { plan, id: messages[index].id };
    }
    return null;
  })();

  useEffect(() => {
    if (workspaceOpen || !followRef.current) return;
    const frame = requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end", behavior: "instant" }));
    return () => cancelAnimationFrame(frame);
  }, [messages.length, status, workspaceOpen]);

  function chooseSuggestion(text: string) {
    setInput(text);
    inputRef.current?.focus({ preventScroll: true });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    followRef.current = true;
    clearError();
    void sendMessage({ text });
    setInput("");
  }

  function reset() {
    void stop(); clearError(); setMessages([]); clearHistory(); setSelected(null);
    setWorkspaceOpen(false); setResetPrompt(false); setInput(""); followRef.current = true;
    inputRef.current?.focus({ preventScroll: true });
  }

  const openWorkspace: OpenWorkspace = (plan, id, event) => {
    originRef.current = event.currentTarget;
    followRef.current = false;
    setSelected({ plan, id });
    setWorkspaceOpen(true);
  };
  const closeWorkspace = useCallback(() => setWorkspaceOpen(false), []);

  return (
    <div className="studio-shell">
      <a className="skip-link" href="#studio-content">跳到设计内容</a>
      <aside className="studio-rail" aria-label="设计工作室">
        <div className="studio-wordmark"><span className="brand-mark"><Icon name="home" width="25" height="25" /></span><div><strong>家的设计室</strong><span>HOME, IN THE MAKING</span></div></div>
        <button className="button button-new" onClick={() => messages.length ? setResetPrompt(true) : inputRef.current?.focus()}><Icon name="plus" />新的设计<span>＋</span></button>
        <div className="rail-section"><span className="eyebrow">从想法到你的家</span><ol className="design-steps"><li className={latest ? "done" : "current"}><span>{latest ? <Icon name="check" width="13" height="13" /> : "01"}</span><div><strong>说说你的想法</strong><small>面积、预算与生活习惯</small></div></li><li className={latest ? "current" : ""}><span>02</span><div><strong>看看设计方案</strong><small>空间安排与预算清单</small></div></li><li><span>03</span><div><strong>走进空间，慢慢打磨</strong><small>平面布置与 3D 预览</small></div></li></ol></div>
        {latest && <div className="rail-project"><span className="eyebrow">当前方案</span><strong>{latest.plan.style}</strong><span>{latest.plan.totalArea} ㎡ · {latest.plan.rooms.length} 个空间</span><button className="rail-project-link" onClick={(event) => { document.getElementById(`plan-${latest.id}`)?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); event.currentTarget.blur(); }}>回看完整方案<Icon name="arrow" width="15" height="15" /></button></div>}
        <div className="rail-bottom"><Icon name="leaf" /><p>好设计，<br />从好好生活开始。</p><span>AI 智能装修设计师</span></div>
      </aside>

      <div className="studio-main">
        <header className="studio-topbar"><div className="topbar-path"><span className="mobile-brand"><Icon name="home" /></span><h1>AI 智能装修设计师</h1><span className="path-separator">/</span><span>{latest ? "我的设计方案" : "新的设计"}</span></div><div className="topbar-actions">{messages.length > 0 && <button className="button button-quiet new-mobile" onClick={() => setResetPrompt(true)}><Icon name="plus" width="16" height="16" /><span>新对话</span></button>}<span className={`studio-status${loading ? " is-working" : ""}`} role="status"><span className="status-dot" />{loading ? "正在为你设计" : "设计师已就绪"}</span></div></header>

        <main ref={scrollRef} id="studio-content" className={`studio-content ${messages.length ? "has-conversation" : "is-welcome"}`} onScroll={() => { const el = scrollRef.current; if (el) followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; }}>
          {!messages.length ? <div className="welcome-content"><section className="welcome-main"><div className="welcome-copy"><div className="eyebrow welcome-eyebrow"><span />一起，把家想清楚</div><h2 aria-label="说出你的装修需求">说出你的<br /><span>装修需求</span><i>。</i></h2><p className="welcome-description">你描述理想的生活，<br />我们一起安排家的每一处。</p><p className="welcome-detail">从户型与预算出发，得到一份可以继续修改的设计方案。</p><a className="welcome-start" href="#design-input" onClick={(event) => { event.preventDefault(); inputRef.current?.focus(); }}>从你的想法开始<Icon name="arrow" width="18" height="18" /></a></div><figure className="welcome-scene"><span className="scene-label"><span className="status-dot" />给想法，一点空间</span><RoomScene /><figcaption><span>构思 · 布局 · 日常</span><span>每一处，都为生活留白。</span></figcaption></figure></section><section className="inspiration-section" aria-label="从一个想法开始"><div className="inspiration-heading"><h3>还没想好？从一个想法开始</h3><span>点击填入，你还可以继续补充</span></div><div className="inspiration-list">{SUGGESTIONS.map((item, index) => <button key={item.text} className="inspiration-button" aria-label={item.text} onClick={() => chooseSuggestion(item.text)}><span className="inspiration-number">0{index + 1}</span><span><strong>{item.title}</strong><small>{item.meta}</small></span><Icon name="arrow" width="17" height="17" /></button>)}</div></section></div> : <div className="conversation"><div className="conversation-heading"><span className="eyebrow">你的家，从这段对话开始</span><span>想法可以随时调整</span></div>{messages.map((message, index) => message.role === "user" ? <div className="user-message" key={message.id}><span className="message-author">你</span><div>{getMessageText(message.parts)}</div></div> : <div className="assistant-message" key={message.id}><div className="assistant-byline"><span className="assistant-avatar"><Icon name="home" width="15" height="15" /></span><strong>你的家居设计师</strong><span>让想法有个着落</span></div><AssistantMessage message={message} streaming={index === messages.length - 1 && loading} onOpen={openWorkspace} /></div>)}{loading && messages.at(-1)?.role === "user" && <div className="assistant-message"><Thinking /></div>}{error && <div className="connection-error" role="alert"><strong>这次连接没有完成</strong><span>已有方案和对话都还在。检查网络后，可以重新发送需求。</span><button className="button button-quiet" onClick={() => chooseSuggestion(getMessageText([...messages].reverse().find((message) => message.role === "user")?.parts || []))}>重新填写刚才的需求<Icon name="back" width="16" height="16" /></button></div>}</div>}
          <div ref={endRef} className="conversation-end" />
        </main>

        <footer className="studio-composer"><div className="composer-inner">{messages.length > 0 && <div className="adjustments"><span>继续打磨</span>{ADJUST_SUGGESTIONS.map((text) => <button key={text} onClick={() => chooseSuggestion(text)}>{text}<Icon name="plus" width="12" height="12" /></button>)}</div>}<form className="composer-form" onSubmit={submit}><label htmlFor="design-input" className="sr-only">装修需求</label><textarea ref={inputRef} id="design-input" rows={2} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={messages.length ? "想调整哪里？告诉我，我们继续完善。" : "比如：90 ㎡三室两厅，预算 18 万，喜欢温暖的原木风…"} /><div className="composer-toolbar"><span><Icon name="plan" width="15" height="15" />{latest ? "带着已有方案，继续聊聊" : "户型 · 面积 · 预算 · 风格"}</span>{loading ? <button type="button" className="button button-primary" onClick={() => void stop()}><Icon name="stop" width="15" height="15" />停止生成</button> : <button type="submit" className="button button-primary" disabled={!input.trim()}><span>发送</span><Icon name="send" width="17" height="17" /></button>}</div></form><div className="composer-note"><span><span className="status-dot" />对话与方案保存在当前浏览器</span><span><kbd>Enter</kbd> 发送 <i /> <kbd>Shift + Enter</kbd> 换行</span></div></div></footer>
      </div>

      {selected && <DesignWorkspace plan={selected.plan} open={workspaceOpen} origin={originRef} onClose={closeWorkspace} />}
      {resetPrompt && <div className="reset-backdrop" onKeyDown={(event) => { if (event.key === "Escape") setResetPrompt(false); }}><section className="reset-panel" role="alertdialog" aria-modal="true" aria-labelledby="reset-title"><span className="eyebrow">新的想法，新的开始</span><h2 id="reset-title">开始一份新的设计？</h2><p>当前对话会被清空。已保存的户型布置仍保留在这个浏览器。</p><div><button className="button button-quiet" onClick={() => setResetPrompt(false)}>继续当前设计</button><button className="button button-primary" onClick={reset}>开始新设计</button></div></section></div>}
    </div>
  );
}
