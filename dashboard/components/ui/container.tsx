// 카드(스펙 §6 Card, 아트보드 공통): surface 바탕 + line-2 테두리 + 12px, 안쪽 20px 22px, 머리와 본문 사이 16px.
// 제목 h2 19px 600(Noto Sans KR 우선) · 카운터(IBM Plex Mono 15px muted) · 설명(14px muted) · 오른쪽 액션.
// padded={false}면 본문이 카드 가장자리까지 붙는다(머리만 안쪽 여백) - 카드 안에 표·목록을 꽉 채울 때 쓴다.
// 그때만 overflow-hidden 으로 둥근 모서리를 자른다(여백 있는 카드는 안쪽 팝오버·포커스 외곽선을 자르지 않게 둔다).
import type { ReactNode } from 'react';

export function Container({ title, counter, description, actions, padded = true, className, children }: {
  title?: ReactNode; counter?: number | string; description?: ReactNode; actions?: ReactNode;
  padded?: boolean; className?: string; children: ReactNode;
}) {
  const hasHeader = title !== undefined || actions !== undefined;
  const body = padded ? `px-[22px] pb-5 ${hasHeader ? 'pt-4' : 'pt-5'}` : '';
  return (
    <section className={`flex flex-col rounded-card border border-line-2 bg-surface${padded ? '' : ' overflow-hidden'}${className ? ` ${className}` : ''}`}>
      {hasHeader && (
        <header className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-[22px] pt-5${padded ? '' : ' pb-4'}`}>
          <div className="flex min-w-0 flex-col gap-4">
            {title !== undefined && (
              <h2 className="font-heading text-[19px] font-semibold">
                {title}
                {counter !== undefined && <span className="ml-1.5 font-mono text-[15px] font-normal text-muted">({counter})</span>}
              </h2>
            )}
            {description && <p className="text-sm leading-[1.6] text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
        </header>
      )}
      <div className={body}>{children}</div>
    </section>
  );
}
