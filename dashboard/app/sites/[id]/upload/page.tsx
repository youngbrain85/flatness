// 스캔 업로드(스펙 §5 행 05, 아트보드 Upload): 현장은 경로가 정한다. 측정위치 셀렉트는 이 현장의
// 측정위치만 보이고, 그 자리에서 만드는 새 측정위치도 이 현장에 들어간다. 업로드에 성공하면
// 지금처럼 스캔 작업대(/scans/[id])로 간다. 현장 헤더와 현장 존재 확인(notFound)은
// app/sites/[id]/layout.tsx가 맡는다. 옛 /upload 는 ?location= 의 현장으로 리다이렉트된다(T2).
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getRequestUser } from '@/lib/auth/request-user';
import { createClient } from '@/lib/supabase/server';
import { buildLocationTree } from '@/lib/domain/tree';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { UploadForm } from '@/components/upload-form';
import type { LocationRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';
// <title>은 'Flatness · 스캔 업로드'(스펙 §9). 앞부분은 app/layout.tsx 의 title.template 이 붙인다.
export const metadata: Metadata = { title: '스캔 업로드' };

export default async function SiteUploadPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ location?: string }>;
}) {
  const { id } = await params;
  const { location } = await searchParams;
  // proxy가 검증한 헤더를 읽는다(Auth 왕복 0회). 가드는 방어 심층으로 유지.
  const user = await getRequestUser();
  if (!user) redirect('/login');
  const supabase = await createClient();
  const { data, error } = await supabase.from('locations').select('*').eq('site_id', id);
  // `?? []`가 조회 실패를 조용히 "측정위치 없음"으로 바꾸지 않도록 에러부터 본다.
  if (error) {
    return <div className={PAGE_MAIN}><SupabaseErrorNotice message={error.message} /></div>;
  }
  // 셀렉트 순서는 측정위치 탭 트리와 같다(동 가나다 → 높은 층 먼저 → 공간 → 이름).
  const locations = buildLocationTree((data ?? []) as LocationRow[])
    .flatMap((b) => b.floors.flatMap((f) => f.rooms.flatMap((r) => r.locations)));
  // ?location= 이 이 현장의 측정위치가 아니면 미리 고르지 않는다 - 경로의 현장과 다른 현장의
  // 측정위치로 스캔이 올라가면(파일은 이 현장 경로에 저장된다) 데이터가 어긋난다.
  const initialLocationId = location && locations.some((l) => l.id === location) ? location : undefined;
  return (
    <div className={PAGE_MAIN}>
      {/* 스펙 §4.3: 현장 안 화면의 브레드크럼은 탭 이름부터 시작한다(현장은 헤더에 있다). */}
      <PageHeader crumbs={[{ href: `/sites/${id}/locations`, label: '측정위치' }, { label: '스캔 업로드' }]}
        title="스캔 업로드" />
      {/* D4: 측정위치가 0개인 현장도 폼 안에서 바로 만들 수 있다(인라인 생성) - 빈 상태 분기 없이
          폼을 항상 렌더한다. */}
      <UploadForm siteId={id} locations={locations} userId={user.id} initialLocationId={initialLocationId} />
    </div>
  );
}
