"use client";

export default function PageError() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-6 text-ink">
      <section role="alert" className="max-w-md rounded-xl border border-line bg-surface p-6">
        <h1 className="text-xl font-semibold">页面暂时没有加载完成</h1>
        <p className="my-4 text-sm text-muted">请重新加载页面。你保存的装修方案和对话会保留。</p>
        <button className="rounded-md bg-ink-strong px-4 py-2 text-white" onClick={() => window.location.reload()}>
          重新加载
        </button>
      </section>
    </main>
  );
}
