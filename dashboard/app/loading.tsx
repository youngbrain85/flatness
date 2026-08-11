// 루트 로딩 화면(loading.tsx 규약: layout 안 page 영역만 Suspense로 감싼다 -
// 사이드바는 layout 소속이라 그대로 남는다). 스켈레톤 대신 중앙 스피너로
// "로딩 중"임을 명시적으로 알린다(사용자 피드백: 스켈레톤만으로는 인지 못 함).
import { Spinner } from '@/components/ui/spinner';

export default function Loading() {
  return (
    <main className="p-6" aria-busy="true">
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
        <Spinner size="md" />
        <p className="text-sm text-zinc-500">불러오는 중…</p>
      </div>
    </main>
  );
}
