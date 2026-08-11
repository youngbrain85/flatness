// 현장 상세 로딩 스켈레톤 - 헤더 + 측정위치 트리 + 현장 사진 그리드 골격.
export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6" aria-busy="true">
      <div className="space-y-2">
        <div className="h-3 w-24 animate-pulse rounded bg-zinc-200" />
        <div className="h-7 w-64 animate-pulse rounded bg-zinc-200" />
      </div>
      <section className="space-y-2">
        <div className="h-5 w-20 animate-pulse rounded bg-zinc-200" />
        <div className="animate-pulse rounded-md border border-zinc-200 bg-white p-4">
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-8 w-full rounded bg-zinc-100" />
            ))}
          </div>
        </div>
      </section>
      <section className="space-y-2">
        <div className="h-5 w-20 animate-pulse rounded bg-zinc-200" />
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="aspect-square animate-pulse rounded-md bg-zinc-100" />
          ))}
        </div>
      </section>
    </main>
  );
}
