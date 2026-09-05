// Cloudscape StatusIndicator: 16px 아이콘 + 텍스트. 색은 스펙 §3.
import type { ReactNode } from 'react';
import type { ScanStatus } from '@/lib/domain/types';
import { Icon, type IconName } from './icons';

export type StatusType = 'success' | 'warning' | 'error' | 'in-progress' | 'pending' | 'info';

const STATUS: Record<StatusType, { icon: IconName; color: string }> = {
  success: { icon: 'check-circle', color: 'text-cs-success' },
  warning: { icon: 'alert-triangle', color: 'text-cs-warning' },
  error: { icon: 'x-circle', color: 'text-cs-error' },
  'in-progress': { icon: 'clock', color: 'text-cs-text-secondary' },
  pending: { icon: 'minus-circle', color: 'text-cs-na' },
  info: { icon: 'info-circle', color: 'text-cs-link' },
};

// Badge 톤(pass/warn/fail/unknown/busy) -> 상태 타입. 상태를 점으로 그리던 옛 컴포넌트의
// 소비자는 전부 이 표를 거쳐 StatusIndicator로 옮겨왔다(T12에서 옛 파일 삭제).
export const TONE_STATUS: Record<'pass' | 'warn' | 'fail' | 'unknown' | 'busy', StatusType> = {
  pass: 'success', warn: 'warning', fail: 'error', unknown: 'pending', busy: 'in-progress',
};

// 스캔 상태 → StatusIndicator 타입(표시 매핑, 스캔 정보의 '상태' 칸). 종결(ready)=success,
// 실패=error, 사전 검사 대기(uploaded)=in-progress(워커가 곧 처리), 사용자 입력 대기·
// 보관=pending. 아트보드: UnitConfirm '단위 확인 대기' minus-circle, Done '분석 준비됨' check.
//
// 최종 리뷰 Important 2: 측정위치 트리가 미분석 스캔의 모든 상태를 시계로 그려 같은
// 스캔이 두 화면에서 다른 아이콘을 달았다(failed는 '실패'인데 시계, archived는 '보관됨'인데
// 시계). 두 화면이 이 표 하나를 공유하도록 스캔 상세에서 여기로 올렸다.
export const SCAN_STATUS_TYPE: Record<ScanStatus, StatusType> = {
  uploaded: 'in-progress', awaiting_unit_confirm: 'pending', ready: 'success',
  archived: 'pending', failed: 'error',
};

export function StatusIndicator({ type, children, className }: { type: StatusType; children: ReactNode; className?: string }) {
  const s = STATUS[type];
  return (
    <span data-status={type} className={`inline-flex items-center gap-1.5 text-sm ${s.color}${className ? ` ${className}` : ''}`}>
      <Icon name={s.icon} />
      {children}
    </span>
  );
}
