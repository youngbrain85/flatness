// D5 스캔 작업대: 스캔의 진행 단계를 한 줄로 보여주는 스트립.
// 업로드 → 사전 검사 → 단위 확정 → 분석 → 완료
//
// "현재 단계" 매핑(스캔 status는 워커·화면이 전이시키는 값이다):
// - uploaded: 사전 검사를 기다리는 중 → 현재 = 사전 검사
// - failed: 사전 검사가 실패한 상태(워커의 precheck 실패 전이) → 사전 검사를 실패 톤으로
// - awaiting_unit_confirm: 현재 = 단위 확정
// - ready/archived: 현재 = 분석. 단, 완료된 분석이 하나라도 있으면(hasDoneAnalysis)
//   현재 = 완료 (status에는 "분석 끝남"이 따로 없다 - analyses가 진실이다)
import type { ScanRow } from '@/lib/domain/types';

const STEPS = ['업로드', '사전 검사', '단위 확정', '분석', '완료'] as const;

function currentIndex(status: ScanRow['status'], hasDoneAnalysis: boolean): number {
  // 실패가 우선한다 - 상태와 분석 이력이 어긋난 조합에서도 실패를 숨기면 안 된다.
  if (status === 'failed' || status === 'uploaded') return 1;
  if (status === 'awaiting_unit_confirm') return 2;
  return hasDoneAnalysis ? 4 : 3; // ready/archived
}

export function ScanStepStrip({ status, hasDoneAnalysis }: {
  status: ScanRow['status'];
  hasDoneAnalysis: boolean;
}) {
  const cur = currentIndex(status, hasDoneAnalysis);
  const failed = status === 'failed';
  return (
    <ol className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden className="text-zinc-300">›</span>}
          <span className={
            i === cur
              ? (failed ? 'text-red-700 font-medium' : 'text-zinc-900 font-medium')
              : i < cur ? 'text-zinc-400' : 'text-zinc-300'
          }>
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}
