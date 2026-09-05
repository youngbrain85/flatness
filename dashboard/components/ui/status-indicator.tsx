// Cloudscape StatusIndicator: 16px 아이콘 + 텍스트. 색은 스펙 §3.
import type { ReactNode } from 'react';
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

export function StatusIndicator({ type, children, className }: { type: StatusType; children: ReactNode; className?: string }) {
  const s = STATUS[type];
  return (
    <span data-status={type} className={`inline-flex items-center gap-1.5 text-sm ${s.color}${className ? ` ${className}` : ''}`}>
      <Icon name={s.icon} />
      {children}
    </span>
  );
}
