// Cloudscape 컨테이너: 흰 배경 + 그림자 + 16px 라운드, 헤더(제목 18px 700 · 카운터 · 액션).
import type { ReactNode } from 'react';

export function Container({ title, counter, description, actions, padded = true, className, children }: {
  title?: ReactNode; counter?: number | string; description?: ReactNode; actions?: ReactNode;
  padded?: boolean; className?: string; children: ReactNode;
}) {
  const hasHeader = title !== undefined || actions !== undefined;
  return (
    <section className={`rounded-cs-container bg-white shadow-cs-container${className ? ` ${className}` : ''}`}>
      {hasHeader && (
        <header className="flex items-start justify-between gap-4 border-b border-cs-divider px-5 py-3">
          <div className="min-w-0">
            {title !== undefined && (
              <h2 className="text-lg font-bold leading-[22px]">
                {title}
                {counter !== undefined && <span className="ml-1.5 font-normal text-cs-text-secondary">({counter})</span>}
              </h2>
            )}
            {description && <p className="mt-1 text-sm text-cs-text-secondary">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}
