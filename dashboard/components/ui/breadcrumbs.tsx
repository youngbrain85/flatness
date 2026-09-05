// 브레드크럼: 링크 cs-link, 구분 chevron, 마지막 항목은 현재 페이지(비링크·보조색). 루트는 '현장'(스펙 §7-2).
import Link from 'next/link';
import { Icon } from './icons';

export type Crumb = { href?: string; label: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="breadcrumb" className="flex flex-wrap items-center gap-2 text-sm">
      {items.map((c, i) => (
        <span key={`${c.label}-${i}`} className="flex items-center gap-2">
          {i > 0 && <Icon name="chevron-right" size={14} className="text-cs-text-secondary" />}
          {c.href
            ? <Link href={c.href} className="text-cs-link hover:text-cs-link-hover hover:underline">{c.label}</Link>
            : <span className="text-cs-text-secondary">{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}
