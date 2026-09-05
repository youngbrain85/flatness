// 루트 로딩 화면(loading.tsx 규약: layout 안 page 영역만 Suspense로 감싼다 -
// 셸(상단 바·사이드 내비)은 layout 소속이라 그대로 남는다). 스켈레톤 대신 중앙 스피너로
// "로딩 중"임을 명시적으로 알린다(사용자 피드백: 스켈레톤만으로는 인지 못 함).
// 본문 클래스는 page.tsx와 같은 PAGE_MAIN - 전환 시 레이아웃 점프 방지(스펙 §5).
import { Spinner } from '@/components/ui/spinner';
import { PAGE_MAIN } from '@/components/ui/page';

export default function Loading() {
  return (
    <main className={PAGE_MAIN} aria-busy="true">
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
        <Spinner size="md" />
        <p className="text-sm text-cs-text-secondary">불러오는 중…</p>
      </div>
    </main>
  );
}
