// Cloudscape Alert: radius 12px, 2px 보더, 좌측 아이콘. 색은 스펙 §3.
import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';

export type AlertType = 'info' | 'success' | 'warning' | 'error';

const ALERT: Record<AlertType, { icon: IconName; box: string; icon_: string }> = {
  info: { icon: 'info-circle', box: 'border-cs-link bg-cs-info-bg', icon_: 'text-cs-link' },
  success: { icon: 'check-circle', box: 'border-cs-success bg-cs-success-bg', icon_: 'text-cs-success' },
  warning: { icon: 'alert-triangle', box: 'border-cs-warning bg-cs-warning-bg', icon_: 'text-cs-warning' },
  error: { icon: 'x-circle', box: 'border-cs-error bg-cs-error-bg', icon_: 'text-cs-error' },
};

export function Alert({ type, title, children, className }: {
  type: AlertType; title?: ReactNode; children?: ReactNode; className?: string;
}) {
  const a = ALERT[type];
  return (
    <div data-alert={type} role={type === 'error' ? 'alert' : undefined}
      className={`flex gap-3 rounded-xl border-2 px-4 py-3 text-sm ${a.box}${className ? ` ${className}` : ''}`}>
      <Icon name={a.icon} className={`mt-0.5 ${a.icon_}`} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
      </div>
    </div>
  );
}
