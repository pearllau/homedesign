"use client";

import { PlanActivity } from "./plan-activity";

export type GenerationPhase = "submitted" | "streaming" | "error" | "paused" | "incomplete";

// 只跟随真实请求状态推进，不编造进度。
function readableError(message?: string) {
  if (!message) return "服务暂时未能完成请求，请稍后重试。";
  if (message.length > 130) return "服务暂时未能完成请求，请稍后重试。";
  if (/^(provider_|\d{3}$)/.test(message)) return "服务暂时未能完成请求，请稍后重试。";
  return message;
}

export function GenerationFeedback({ phase, onRetry, errorMessage }: { phase: GenerationPhase; onRetry?: () => void; errorMessage?: string }) {
  const pending = phase === "submitted" || phase === "streaming";
  const title = phase === "submitted" ? "正在连接你的设计师" : phase === "streaming" ? "正在整理空间与预算" : phase === "paused" ? "已暂停这次生成" : phase === "incomplete" ? "这份方案还没有完整生成" : "这次连接没有完成";
  const hint = phase === "submitted"
    ? "通常 10–20 秒完成，期间可以随时停止。"
    : phase === "streaming"
      ? "正在接收结构化方案，完成后会自动打开工作台。"
      : "已有对话和方案都还在，可以继续生成。";
  return <div className={`generation-feedback${pending ? "" : " is-recovery"}`} data-phase={phase} role={phase === "error" ? "alert" : "status"}>
    <div className="generation-heading">
      <PlanActivity active={pending} />
      <div><strong>{title}</strong><p>{phase === "error" ? `${readableError(errorMessage)} ${hint}` : hint}</p></div>
    </div>
    {pending ? <ol className="generation-steps" aria-label="方案生成状态">
      <li data-state="complete"><span>✓</span>需求已发送</li>
      <li data-state={phase === "streaming" ? "active" : "waiting"}><span />{phase === "streaming" ? "正在接收方案" : "等待设计师响应"}</li>
    </ol> : onRetry && <button type="button" className="generation-retry" onClick={onRetry}>{phase === "paused" ? "继续生成" : "重新生成"}<span aria-hidden="true">↗</span></button>}
  </div>;
}
