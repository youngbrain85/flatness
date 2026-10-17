// 현장 안 로딩 화면 - 중앙 스피너로 로딩 중임을 명시한다. 본문 클래스는 PAGE_MAIN(스펙 §5).
// app/sites/[id]/layout.tsx 의 <main> 안(현장 헤더 아래)에 그려지므로 main 을 또 두지 않고 div 로 연다(Task 2).
import { Spinner } from '@/components/ui/spinner';
import { PAGE_MAIN } from '@/components/ui/page';

export default function Loading() {
  return (
    <div className={PAGE_MAIN} aria-busy="true">
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
        <Spinner size="md" />
        <p className="text-sm text-cs-text-secondary">불러오는 중…</p>
      </div>
    </div>
  );
}
