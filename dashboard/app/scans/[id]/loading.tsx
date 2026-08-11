// 스캔 작업대 로딩 화면 - 중앙 스피너로 로딩 중임을 명시한다.
import { Spinner } from '@/components/ui/spinner';

export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6" aria-busy="true">
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
        <Spinner size="md" />
        <p className="text-sm text-zinc-500">불러오는 중…</p>
      </div>
    </main>
  );
}
