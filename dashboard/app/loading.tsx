// 루트 로딩 스켈레톤(loading.tsx 규약: layout 안 page 영역만 Suspense로 감싼다 -
// 사이드바는 layout 소속이라 그대로 남는다). 계측 콘솔 톤: zinc 중립 + animate-pulse만.
export default function Loading() {
  return (
    <main className="p-6" aria-busy="true">
      {/* 페이지 헤더 자리(브레드크럼 + 제목) */}
      <div className="mb-6 space-y-2">
        <div className="h-3 w-40 animate-pulse rounded bg-zinc-200" />
        <div className="h-7 w-56 animate-pulse rounded bg-zinc-200" />
      </div>
      {/* 지표 카드 스트립 자리 */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-md border border-zinc-200 bg-zinc-100" />
        ))}
      </div>
      {/* 본문 테이블/목록 자리 */}
      <div className="animate-pulse rounded-md border border-zinc-200 bg-white p-4">
        <div className="mb-3 h-4 w-full rounded bg-zinc-100" />
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 w-full rounded bg-zinc-100" />
          ))}
        </div>
      </div>
    </main>
  );
}
