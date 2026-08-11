import Link from 'next/link';

export function PageHeader({ crumbs, title, actions }: {
  crumbs?: { href?: string; label: string }[]; title: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      {crumbs && crumbs.length > 0 && (
        <nav className="mb-1 flex items-center gap-1 text-xs text-zinc-500">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden>›</span>}
              {c.href ? <Link href={c.href} className="hover:text-zinc-900 hover:underline">{c.label}</Link> : <span>{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{title}</h1>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
