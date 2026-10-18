// 상태 표시(스펙 §6 StatusIndicator, 아트보드 상태 점): 8px 점 + 글자(ink 14px).
// 점 색은 스펙 §3 상태 색: 완료 ok · 경고 warn · 오류 err · 대기 muted · 진행 중은 속 빈 ink 고리.
// 색만으로 말하지 않는다 - 글자가 늘 함께 있다. data-status 로 테스트가 읽는다.
import type { ReactNode } from 'react';
import type { ScanStatus } from '@/lib/domain/types';

export type StatusType = 'success' | 'warning' | 'error' | 'in-progress' | 'pending' | 'info';

const DOT: Record<StatusType, string> = {
  success: 'bg-ok',
  warning: 'bg-warn',
  error: 'bg-err',
  'in-progress': 'border-2 border-ink bg-transparent',
  pending: 'bg-muted',
  info: 'bg-ink-2',
};

// Badge 톤(pass/warn/fail/unknown/busy) -> 상태 타입. 상태를 점으로 그리던 옛 컴포넌트의
// 소비자는 전부 이 표를 거쳐 StatusIndicator로 옮겨왔다(T12에서 옛 파일 삭제).
export const TONE_STATUS: Record<'pass' | 'warn' | 'fail' | 'unknown' | 'busy', StatusType> = {
  pass: 'success', warn: 'warning', fail: 'error', unknown: 'pending', busy: 'in-progress',
};

// 스캔 상태 → StatusIndicator 타입(표시 매핑, 스캔 정보의 '상태' 칸). 종결(ready)=success,
// 실패=error, 사전 검사 대기(uploaded)=in-progress(워커가 곧 처리), 사용자 입력 대기·
// 보관=pending. 아트보드: ScanUnitConfirm '단위 확인 대기' muted 점, ScanProcessing '분석 준비됨' ok 점.
//
// 최종 리뷰 Important 2: 측정위치 트리가 미분석 스캔의 모든 상태를 시계로 그려 같은
// 스캔이 두 화면에서 다른 아이콘을 달았다(failed는 '실패'인데 시계, archived는 '보관됨'인데
// 시계). 두 화면이 이 표 하나를 공유하도록 스캔 상세에서 여기로 올렸다.
export const SCAN_STATUS_TYPE: Record<ScanStatus, StatusType> = {
  uploaded: 'in-progress', awaiting_unit_confirm: 'pending', ready: 'success',
  archived: 'pending', failed: 'error',
};

export function StatusIndicator({ type, children, className }: { type: StatusType; children: ReactNode; className?: string }) {
  return (
    <span data-status={type} className={'inline-flex items-center gap-2 text-sm text-ink' + (className ? ` ${className}` : '')}>
      <span aria-hidden="true" data-dot="" className={`h-2 w-2 shrink-0 rounded-full ${DOT[type]}`} />
      {children}
    </span>
  );
}
