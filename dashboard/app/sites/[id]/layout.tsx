// 현장 작업 공간 셸(스펙 §4.2·§4.3): 현장 헤더 + 도면 격자 본문. 현장 안 화면(대시보드·측정위치·
// 보고서·업로드)과 그 loading.tsx 는 이 레이아웃 아래에서 본문만 그린다. 문서의 <main> 은 여기 하나라
// 그 화면들은 <div className={PAGE_MAIN}> 으로 본문을 연다(main 이 둘이면 랜드마크가 깨진다).
// 활성 메뉴는 SiteNav(클라이언트)가 usePathname 으로 정한다 - 레이아웃은 내비게이션에 다시 그려지지
// 않아 경로를 읽을 수 없다(node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md).
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { getRequestUser } from '@/lib/auth/request-user';
import { createClient } from '@/lib/supabase/server';
import { EntryHeader } from '@/components/shell/entry-header';
import { SiteHeader } from '@/components/shell/site-header';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { MAIN_BG, PAGE_MAIN } from '@/components/ui/page';

export default async function SiteLayout({ children, params }: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  // perf-auth-roundtrips: 사용자는 proxy 가 실어 준 헤더에서 읽는다(Auth 왕복 0회). 현장 조회와 병렬.
  const [user, siteRes] = await Promise.all([
    getRequestUser(),
    supabase.from('sites').select('id, name').eq('id', id).maybeSingle(),
  ]);
  const email = user?.email ?? null;
  // 연결 실패를 "현장 없음"(notFound)으로 오인하지 않는다(옛 현장 상세의 저비용 개선을 옮겼다).
  // 현장을 모르니 현장 헤더 대신 진입 헤더를 그리고, 아래 화면은 그리지 않는다.
  if (siteRes.error) {
    return (
      <>
        <EntryHeader email={email} />
        <main className={MAIN_BG}>
          <div className={PAGE_MAIN}>
            <SupabaseErrorNotice message={siteRes.error.message} />
          </div>
        </main>
      </>
    );
  }
  if (!siteRes.data) notFound();
  const site = siteRes.data as { id: string; name: string };
  return (
    <>
      <SiteHeader site={{ id: site.id, name: site.name }} email={email} />
      <main className={MAIN_BG}>{children}</main>
    </>
  );
}
