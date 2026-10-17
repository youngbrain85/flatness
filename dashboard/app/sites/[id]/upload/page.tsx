// 스캔 업로드(임시, Task 2): 옛 /upload 본문을 그대로 옮겼다(현장 고르기가 아직 남아 있다). 옛 링크
// /upload?location=X 는 app/upload/page.tsx 가 여기로 보낸다. 문서의 <main> 은 레이아웃 몫이라 본문은 div.
// Task 6 이 현장이 경로로 정해지는 업로드로 이 파일을 다시 쓴다.
import { redirect } from 'next/navigation';
import { getRequestUser } from '@/lib/auth/request-user';
import { createClient } from '@/lib/supabase/server';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { UploadForm } from '@/components/upload-form';
import type { LocationRow, SiteRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function UploadPage({ searchParams }: {
  searchParams: Promise<{ location?: string }>;
}) {
  const { location } = await searchParams;
  const supabase = await createClient();
  // proxy가 검증한 헤더를 읽는다(Auth 왕복 0회). 가드는 방어 심층으로 유지.
  const user = await getRequestUser();
  if (!user) redirect('/login');
  const [sitesRes, locationsRes] = await Promise.all([
    supabase.from('sites').select('*').order('name'),
    supabase.from('locations').select('*'),
  ]);
  const sites = (sitesRes.data ?? []) as SiteRow[];
  const locations = (locationsRes.data ?? []) as LocationRow[];
  return (
    <div className={PAGE_MAIN}>
      {/* 최종 리뷰 M2: 타 화면(설정·현장 상세·스캔 작업대 등)과 루트 크럼 라벨을
          '현장'으로 통일한다 - 이 화면만 '홈'을 쓰고 있었다.
          Cloudscape(스펙 §7-2): 마지막 크럼은 현재 페이지(비링크)이므로 href 없이 넘긴다. */}
      <PageHeader crumbs={[{ href: '/', label: '현장' }, { label: '스캔 업로드' }]} title="스캔 업로드" />
      {/* D4: 측정위치가 0개인 현장도 폼 안에서 바로 만들 수 있다(인라인 생성) -
          업로드 전 별도 페이지로 보내던 빈 상태 분기와 sites[0] 하드코딩을 없애고
          폼을 항상 렌더한다. */}
      <UploadForm sites={sites} locations={locations} userId={user.id} initialLocationId={location} />
    </div>
  );
}
