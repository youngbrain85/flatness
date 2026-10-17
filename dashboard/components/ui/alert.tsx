// 알림 상자(스펙 §6 Alert, 아트보드 Stage·Upload·RegistrationNew·RegistrationDetail):
// ground 바탕 + 1px 색 테두리 + 반지름 6px + 18px stroke 아이콘. 제목 14px 600 ink, 본문 13px ink-2.
// 경고 = warn(role=status) · 오류 = err(role=alert) · 안내 = line-3 테두리 + ink-2 아이콘(역할 없음).
// data-alert 로 테스트가 종류를 읽는다.
import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';

export type AlertType = 'info' | 'success' | 'warning' | 'error';

const ALERT: Record<AlertType, { icon: IconName; border: string; iconColor: string; role?: 'alert' | 'status' }> = {
  info: { icon: 'info-circle', border: 'border-line-3', iconColor: 'text-ink-2' },
  success: { icon: 'check-circle', border: 'border-ok', iconColor: 'text-ok', role: 'status' },
  warning: { icon: 'alert-triangle', border: 'border-warn', iconColor: 'text-warn', role: 'status' },
  error: { icon: 'alert-circle', border: 'border-err', iconColor: 'text-err', role: 'alert' },
};

export function Alert({ type, title, children, className }: {
  type: AlertType; title?: ReactNode; children?: ReactNode; className?: string;
}) {
  const a = ALERT[type];
  return (
    <div data-alert={type} role={a.role}
      className={`flex gap-2.5 rounded-control border bg-ground px-4 py-3.5 ${a.border}${className ? ` ${className}` : ''}`}>
      <Icon name={a.icon} size={18} className={`mt-0.5 ${a.iconColor}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {title && <p className="text-sm font-semibold text-ink">{title}</p>}
        {children && <div className="text-[13px] leading-[1.55] text-ink-2">{children}</div>}
      </div>
    </div>
  );
}
