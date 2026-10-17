// 브레드크럼(스펙 §4.3, 아트보드 nav aria-label="위치"): IBM Plex Mono 12px, 구분자 '/'(dim),
// 링크 ink-2, 마지막 항목은 현재 페이지(비링크 · ink · aria-current="page").
// 현장 안 화면은 현장 이름이 아니라 탭 이름부터 시작한다(예: 측정위치 / 101동 · 3층 · 301호 · 거실 / 스캔 …).
import { Fragment } from 'react';
import Link from 'next/link';

export type Crumb = { href?: string; label: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="위치" className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 font-mono text-xs text-dim">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <Fragment key={`${c.label}-${i}`}>
            {i > 0 && <span aria-hidden="true">/</span>}
            {last
              ? <span aria-current="page" className="text-ink">{c.label}</span>
              : c.href
                ? <Link href={c.href} className="text-ink-2 underline hover:text-ink">{c.label}</Link>
                : <span className="text-ink-2">{c.label}</span>}
          </Fragment>
        );
      })}
    </nav>
  );
}
