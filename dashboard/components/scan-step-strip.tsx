// D5 스캔 작업대: 스캔의 진행 단계를 한 줄로 보여주는 스트립.
// 업로드 → 사전 검사 → 단위 확정 → 분석 → 완료
//
// "현재 단계" 매핑(스캔 status는 워커·화면이 전이시키는 값이다):
// - uploaded: 사전 검사를 기다리는 중 → 현재 = 사전 검사
// - failed: 사전 검사가 실패한 상태(워커의 precheck 실패 전이) → 사전 검사를 실패 톤으로
// - awaiting_unit_confirm: 현재 = 단위 확정
// - ready/archived: 현재 = 분석. 단, 완료된 분석이 하나라도 있으면(hasDoneAnalysis)
//   현재 = 완료 (status에는 "분석 끝남"이 따로 없다 - analyses가 진실이다)
//
// Cloudscape 재스킨(스펙 §4 ScanStepStrip): 가로 스텝 = 아이콘 + 라벨, 스텝 사이 1px·40px
// 연결선(아트보드). 완료=success check-circle, 현재=cs-link 700 clock(마지막 '완료' 단계가
// 현재면 check-circle - 종결 상태에 시계를 달면 "완료를 기다리는 중"으로 읽힌다),
// 이후=cs-disabled minus-circle, 실패=cs-error x-circle. 현재 단계의 진실은 스타일이 아니라
// li의 aria-current="step"이다(테스트·접근성 모두 이 속성을 본다).
import type { ScanRow } from '@/lib/domain/types';
import { Icon, type IconName } from '@/components/ui/icons';

const STEPS = ['업로드', '사전 검사', '단위 확정', '분석', '완료'] as const;

function currentIndex(status: ScanRow['status'], hasDoneAnalysis: boolean): number {
  // 실패가 우선한다 - 상태와 분석 이력이 어긋난 조합에서도 실패를 숨기면 안 된다.
  if (status === 'failed' || status === 'uploaded') return 1;
  if (status === 'awaiting_unit_confirm') return 2;
  return hasDoneAnalysis ? 4 : 3; // ready/archived
}

function toneOf(i: number, cur: number, failed: boolean): { className: string; icon: IconName } {
  if (i < cur) return { className: 'text-cs-success', icon: 'check-circle' };
  if (i > cur) return { className: 'text-cs-disabled', icon: 'minus-circle' };
  if (failed) return { className: 'font-bold text-cs-error', icon: 'x-circle' };
  return { className: 'font-bold text-cs-link', icon: i === STEPS.length - 1 ? 'check-circle' : 'clock' };
}

export function ScanStepStrip({ status, hasDoneAnalysis }: {
  status: ScanRow['status'];
  hasDoneAnalysis: boolean;
}) {
  const cur = currentIndex(status, hasDoneAnalysis);
  const failed = status === 'failed';
  return (
    <ol aria-label="스캔 진행 단계" className="flex flex-wrap items-center gap-3 text-sm leading-5">
      {STEPS.map((label, i) => {
        const t = toneOf(i, cur, failed);
        return (
          <li key={label} aria-current={i === cur ? 'step' : undefined}
            className={`flex items-center gap-3 ${t.className}`}>
            {i > 0 && <span aria-hidden data-connector className="h-px w-10 bg-cs-divider" />}
            <span className="inline-flex items-center gap-1.5">
              <Icon name={t.icon} />
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
