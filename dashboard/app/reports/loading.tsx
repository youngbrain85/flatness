// 보고서 목록 로딩 스켈레톤 - 실제 화면(제목 + 4열 테이블)의 골격만 zinc로 비춘다.
export default function Loading() {
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6" aria-busy="true">
      <div className="flex items-center justify-between">
        <div className="h-7 w-32 animate-pulse rounded bg-zinc-200" />
        <div className="h-8 w-24 animate-pulse rounded-md bg-zinc-200" />
      </div>
      <div className="animate-pulse rounded-md border border-zinc-200 bg-white p-4">
        <div className="mb-3 h-4 w-full rounded bg-zinc-100" />
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-8 w-full rounded bg-zinc-100" />
          ))}
        </div>
      </div>
    </main>
  );
}
