// 페이지 헤더: 브레드크럼(선택) + h1 24px/30px 700 + 설명(선택) + 우측 액션.
import { Breadcrumbs, type Crumb } from './breadcrumbs';

export function PageHeader({ crumbs, title, description, actions }: {
  crumbs?: Crumb[]; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      {crumbs && crumbs.length > 0 && <Breadcrumbs items={crumbs} />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-bold leading-[30px]">{title}</h1>
          {description && <p className="text-sm text-cs-text-secondary">{description}</p>}
        </div>
        {/* 최종 리뷰 Important 5: shrink-0이면 액션 블록의 intrinsic 폭(보고서 상세의
            발행 안내문 등)이 그대로 자리를 차지해 제목을 밀어낸다 - 줄어들 수 있게 둔다. */}
        {actions && <div className="flex max-w-full items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
