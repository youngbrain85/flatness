// 스캔 작업대 로딩 스켈레톤 - 헤더 + 단계 스트립 + 메타 dl + 결과 섹션 골격.
export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6" aria-busy="true">
      <div className="space-y-2">
        <div className="h-3 w-64 animate-pulse rounded bg-zinc-200" />
        <div className="h-7 w-80 animate-pulse rounded bg-zinc-200" />
      </div>
      {/* 단계 스트립 자리 */}
      <div className="h-10 w-full max-w-2xl animate-pulse rounded-md bg-zinc-100" />
      {/* 메타데이터 dl 자리 */}
      <div className="max-w-xl animate-pulse rounded-md border border-zinc-200 bg-white p-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="h-4 w-full rounded bg-zinc-100" />
          ))}
        </div>
      </div>
      {/* 분석 결과 섹션 자리 */}
      <div className="h-48 w-full animate-pulse rounded-md border border-zinc-200 bg-zinc-100" />
    </main>
  );
}
