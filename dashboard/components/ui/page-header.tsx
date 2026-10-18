// 페이지 머리(아트보드 제목 줄): 브레드크럼(선택) + h1(Noto Sans KR 우선, clamp(24px, 2.6vw, 30px), 700, 1.2)
// + 카운터(선택, IBM Plex Mono 13px muted - 아트보드 SiteDetail '측정위치 (14)'·Reports '보고서 (4)')
// + 설명(14px muted) + 오른쪽 액션. 줄이 좁아지면 액션이 제목 아래로 내려간다(flex-wrap, 아래 맞춤).
import { Breadcrumbs, type Crumb } from './breadcrumbs';

export function PageHeader({ crumbs, title, counter, description, actions }: {
  crumbs?: Crumb[]; title: React.ReactNode; counter?: number | string;
  description?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      {crumbs && crumbs.length > 0 && <Breadcrumbs items={crumbs} />}
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3.5">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="font-heading text-[clamp(24px,2.6vw,30px)] font-bold leading-[1.2] [overflow-wrap:anywhere]">{title}</h1>
            {counter !== undefined && <span className="font-mono text-[13px] text-muted">({counter})</span>}
          </div>
          {description && <p className="text-sm text-muted">{description}</p>}
        </div>
        {/* 최종 리뷰 Important 5: shrink-0이면 액션 블록의 intrinsic 폭(보고서 상세의
            발행 안내문 등)이 그대로 자리를 차지해 제목을 밀어낸다 - 줄어들 수 있게 둔다. */}
        {actions && <div className="flex max-w-full flex-wrap items-center gap-3">{actions}</div>}
      </div>
    </div>
  );
}
