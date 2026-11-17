"use client";

export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-6 text-ink">
      <section role="alert" className="max-w-md border border-line bg-surface p-6">
        <h1 className="text-xl font-semibold">页面暂时没有加载完成</h1>
        <p className="my-4 text-sm leading-6 text-muted">对话只保存在当前页面，刷新后需要重新描述需求；已经进入工作台的方案不受影响。</p>
        <div className="flex gap-3">
          <button className="bg-ink-strong px-4 py-2 text-sm text-white" onClick={() => window.location.reload()}>重新加载</button>
          <button className="border border-line px-4 py-2 text-sm" onClick={reset}>重试</button>
        </div>
      </section>
    </main>
  );
}
