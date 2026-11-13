"use client";

import { PlanActivity } from "./plan-activity";

export type GenerationPhase = "submitted" | "streaming" | "error" | "paused" | "incomplete";

// Adapted from Inspira UI MultiStepLoader: external request state advances steps.
// No timers, fabricated progress or internal tool names are exposed.
export function GenerationFeedback({ phase, onRetry, errorMessage }: { phase: GenerationPhase; onRetry?: () => void; errorMessage?: string }) {
  const pending = phase === "submitted" || phase === "streaming";
  const title = phase === "submitted" ? "正在连接你的设计师" : phase === "streaming" ? "正在整理空间与预算" : phase === "paused" ? "已暂停这次生成" : phase === "incomplete" ? "这份方案还没有完整生成" : "这次连接没有完成";
  return <div className={`generation-feedback${pending ? "" : " is-recovery"}`} data-phase={phase} role={phase === "error" ? "alert" : "status"}>
    <div className="generation-heading">
      <PlanActivity active={pending} />
      <div><strong>{title}</strong><p>{pending ? "你可以随时停止，已有方案会保留。" : phase === "error" ? `${errorMessage && /^(设计服务|计算尚未|这份方案)/.test(errorMessage) && errorMessage.length < 100 ? errorMessage : "服务暂时未能完成请求，请稍后重试。"} 已有对话和方案会保留。` : "已有对话和方案都还在，可以继续生成。"}</p></div>
    </div>
    {pending ? <ol className="generation-steps" aria-label="方案生成状态">
      <li data-state="complete"><span>✓</span>需求已发送</li>
      <li data-state={phase === "streaming" ? "active" : "waiting"}><span />{phase === "streaming" ? "正在接收方案" : "等待设计师响应"}</li>
      <li data-state="waiting"><span />等待完整方案</li>
    </ol> : onRetry && <button type="button" className="generation-retry" onClick={onRetry}>{phase === "paused" ? "继续生成" : "重新生成"}<span aria-hidden="true">↗</span></button>}
  </div>;
}
