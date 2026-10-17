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
// 다크 C안(아트보드 ScanUnitConfirm·ScanProcessing·ScanDone): 가로 단계 = 표시 + 글자, 단계 사이
// 1px line-3 연결선(제목 아래 놓이면 40px, 스캔 정보 카드 안이면 32px). 지난 단계 = ink-2 글자 +
// 초록 check-circle, 현재 = ink 600 + 속 빈 고리(마지막 '완료'가 현재면 초록 check-circle - 종결
// 상태에 고리를 달면 "아직 진행 중"으로 읽힌다), 이후 = muted 글자 + minus-circle, 실패 = err 600 +
// x-circle. 현재 단계의 진실은 스타일이 아니라 li의 aria-current="step"이다(테스트·접근성 모두 이 속성을 본다).
import type { ScanRow } from '@/lib/domain/types';
import { Icon } from '@/components/ui/icons';

const STEPS = ['업로드', '사전 검사', '단위 확정', '분석', '완료'] as const;

type StepState = 'done' | 'current' | 'current-final' | 'failed' | 'todo';

function currentIndex(status: ScanRow['status'], hasDoneAnalysis: boolean): number {
  // 실패가 우선한다 - 상태와 분석 이력이 어긋난 조합에서도 실패를 숨기면 안 된다.
  if (status === 'failed' || status === 'uploaded') return 1;
  if (status === 'awaiting_unit_confirm') return 2;
  return hasDoneAnalysis ? 4 : 3; // ready/archived
}

function stateOf(i: number, cur: number, failed: boolean): StepState {
  if (i < cur) return 'done';
  if (i > cur) return 'todo';
  if (failed) return 'failed';
  return i === STEPS.length - 1 ? 'current-final' : 'current';
}

const LI_TONE: Record<StepState, string> = {
  done: 'text-ink-2',
  current: 'font-semibold text-ink',
  'current-final': 'font-semibold text-ink',
  failed: 'font-semibold text-err',
  todo: 'text-muted',
};

function StepMark({ state }: { state: StepState }) {
  if (state === 'done' || state === 'current-final') return <Icon name="check-circle" className="text-ok" />;
  if (state === 'failed') return <Icon name="x-circle" />;
  if (state === 'todo') return <Icon name="minus-circle" />;
  // 진행 중 = 속 빈 고리(StatusIndicator의 in-progress와 같은 모양). 16px 칸 가운데에 둔다.
  return (
    <span aria-hidden data-mark="ring" className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
      <span className="h-[11px] w-[11px] rounded-full border-2 border-ink" />
    </span>
  );
}

export function ScanStepStrip({ status, hasDoneAnalysis, placement = 'page' }: {
  status: ScanRow['status'];
  hasDoneAnalysis: boolean;
  /** 'page' = 제목 아래(단위 확인 화면), 'card' = 스캔 정보 카드 안(분석 중·완료 화면). 연결선 길이만 다르다. */
  placement?: 'page' | 'card';
}) {
  const cur = currentIndex(status, hasDoneAnalysis);
  const failed = status === 'failed';
  return (
    <ol aria-label="스캔 진행 단계" className="m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-2.5 p-0 text-sm">
      {STEPS.map((label, i) => {
        const state = stateOf(i, cur, failed);
        return (
          <li key={label} aria-current={i === cur ? 'step' : undefined} data-step-state={state}
            className={['flex items-center gap-3', placement === 'card' ? 'min-h-6' : '', LI_TONE[state]].filter(Boolean).join(' ')}>
            {i > 0 && (
              <span aria-hidden data-connector
                className={`h-px shrink-0 bg-line-3 ${placement === 'card' ? 'w-8' : 'w-10'}`} />
            )}
            <span className="inline-flex items-center gap-2">
              <StepMark state={state} />
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
