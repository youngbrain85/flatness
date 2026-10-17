'use client';
// 현장 메뉴 "대시보드 · 측정위치 · 보고서"(스펙 §4.3). 활성 하나에만 aria-current="page" + 2px 밑줄.
// 활성 판정은 순수 함수 siteNavActive 가 한다. 현장 밖 URL 을 그대로 둔 현장 화면(스캔·정합·보고서
// 생성·상세, 스펙 §4.2)도 여기서 탭이 정해진다. 레이아웃은 내비게이션에 다시 그려지지 않아 경로를
// 읽을 수 없으므로(Next 문서 layout.md "Pathname") 클라이언트 컴포넌트가 usePathname 으로 읽는다.
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type SiteNavKey = 'dashboard' | 'locations' | 'reports';

// base 이거나 base/ 아래인가. 세그먼트 경계를 지킨다(/sites/s1 은 /sites/s10 을 품지 않는다).
function under(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function siteNavActive(pathname: string, siteId: string): SiteNavKey | null {
  const site = `/sites/${siteId}`;
  if (pathname === site) return 'dashboard';
  if (under(pathname, `${site}/locations`) || under(pathname, `${site}/upload`)) return 'locations';
  if (under(pathname, `${site}/reports`)) return 'reports';
  // 현장 밖 URL 의 현장 화면: 스캔·정합은 측정위치 탭, 보고서 생성·상세는 보고서 탭(스펙 §4.2 표)
  if (pathname.startsWith('/scans/') || pathname.startsWith('/registrations/')) return 'locations';
  if (pathname.startsWith('/reports/')) return 'reports';
  return null;
}

const ITEMS: { key: SiteNavKey; label: string; href: (siteId: string) => string }[] = [
  { key: 'dashboard', label: '대시보드', href: (id) => `/sites/${id}` },
  { key: 'locations', label: '측정위치', href: (id) => `/sites/${id}/locations` },
  { key: 'reports', label: '보고서', href: (id) => `/sites/${id}/reports` },
];

// 아트보드 nav 링크: 최소 44px, 아래 2px 선(활성 ink · 비활성 투명), 글자 활성 ink 600 · 비활성 ink-2 500
const LINK = 'inline-flex min-h-11 items-center border-b-2';
const ACTIVE = 'border-ink font-semibold text-ink';
const INACTIVE = 'border-transparent font-medium text-ink-2 hover:text-ink';

export function SiteNav({ siteId }: { siteId: string }) {
  const active = siteNavActive(usePathname(), siteId);
  return (
    <nav aria-label="현장 메뉴" className="flex flex-wrap gap-x-[22px]">
      {ITEMS.map((item) => {
        const on = item.key === active;
        return (
          <Link key={item.key} href={item.href(siteId)} aria-current={on ? 'page' : undefined}
            className={`${LINK} ${on ? ACTIVE : INACTIVE}`}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
