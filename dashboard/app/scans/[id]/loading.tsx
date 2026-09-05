// 스캔 작업대 로딩 화면 - 중앙 스피너로 로딩 중임을 명시한다. 본문 클래스는 PAGE_MAIN(스펙 §5).
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
