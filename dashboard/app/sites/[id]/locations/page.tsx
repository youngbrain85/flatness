// 측정위치 탭(스펙 §5 행 04, 아트보드 SiteDetail): h1 '측정위치 (n)' → 동 › 층 › 공간 트리 카드
// → '새 측정위치' 카드 → '현장 사진 (n)' 카드. 현장 이름은 현장 헤더가, 현장 존재 확인(notFound)은
// app/sites/[id]/layout.tsx가 맡는다. 탭 첫 화면이라 브레드크럼이 없다(스펙 §4.3).
// 조회와 에러 가드는 옛 현장 상세(app/sites/[id]/page.tsx)에서 문장 그대로 옮겼다.
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { buildLocationTree } from '@/lib/domain/tree';
import { LocationTree, type ScanWithCurrent } from '@/components/location-tree';
import { NewLocationForm } from '@/components/new-location-form';
import { PhotoGallery } from '@/components/photo-gallery';
import { RefreshOnUpload } from '@/components/refresh-on-upload';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { Container } from '@/components/ui/container';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import type { AnalysisStatus, LocationRow, PhotoRow, ScanRow, Verdict } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';
// <title>은 'Flatness · 측정위치'(스펙 §9). 앞부분은 app/layout.tsx 의 title.template 이 붙인다.
export const metadata: Metadata = { title: '측정위치' };

export default async function LocationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [locationsRes, photosRes] = await Promise.all([
    supabase.from('locations').select('*').eq('site_id', id),
    supabase.from('photos').select('*').eq('site_id', id).order('created_at', { ascending: false }),
  ]);
  // 아래 `?? []`가 쿼리 실패를 조용히 흡수해 "측정위치가 없습니다"로 오인시키지
  // 않도록, 데이터를 비우기 전에 에러부터 확인한다.
  const parallelError = locationsRes.error ?? photosRes.error;
  if (parallelError) {
    return <div className={PAGE_MAIN}><SupabaseErrorNotice message={parallelError.message} /></div>;
  }
  const locations = (locationsRes.data ?? []) as LocationRow[];
  const photos = (photosRes.data ?? []) as PhotoRow[];
  const locationIds = locations.map((l) => l.id);
  const scansRes = locationIds.length
    ? await supabase.from('scans').select('*').in('location_id', locationIds)
        .is('deleted_at', null).order('scanned_at', { ascending: false })
    : { data: [] as ScanRow[], error: null };
  if (scansRes.error) {
    return <div className={PAGE_MAIN}><SupabaseErrorNotice message={scansRes.error.message} /></div>;
  }
  const scans = scansRes.data;
  const scanIds = (scans ?? []).map((s) => s.id);
  // 단계 C 회귀 차단: kind 필터가 없으면 같은 scan_id의 구배 현재분석이 Map을 덮어써
  // 조회 순서에 따라 배지가 비결정적으로 바뀐다. 트리는 평활도만 보여 기존 동작을 유지한다.
  const currentsRes = scanIds.length
    ? await supabase.from('analyses').select('id, scan_id, status, overall_verdict, kind')
        .in('scan_id', scanIds).eq('is_current', true).eq('kind', 'flatness').is('deleted_at', null)
    : { data: [], error: null };
  if (currentsRes.error) {
    return <div className={PAGE_MAIN}><SupabaseErrorNotice message={currentsRes.error.message} /></div>;
  }
  const currents = currentsRes.data;
  const currentByScan = new Map(
    (currents ?? []).map((a) => [a.scan_id as string, {
      id: a.id as string, status: a.status as AnalysisStatus,
      overall_verdict: a.overall_verdict as Verdict | null,
    }]),
  );
  const scansByLocation = new Map<string, ScanWithCurrent[]>();
  for (const s of (scans ?? []) as ScanRow[]) {
    const arr = scansByLocation.get(s.location_id) ?? [];
    arr.push({ ...s, current: currentByScan.get(s.id) });
    scansByLocation.set(s.location_id, arr);
  }
  return (
    <div className={PAGE_MAIN}>
      {/* 스펙 §5 행 04: 제목 '측정위치 (개수)'. 개수는 PageHeader 의 counter(아트보드처럼 h1 옆 mono 13px muted). */}
      <PageHeader title="측정위치" counter={locations.length} />
      {/* 아트보드: 트리 카드는 제목 없이 h1 바로 아래에 온다(제목은 h1이 대신한다). */}
      <Container>
        <LocationTree tree={buildLocationTree(locations)} scansByLocation={scansByLocation} siteId={id} />
      </Container>
      <Container title="새 측정위치">
        <NewLocationForm siteId={id} />
      </Container>
      {/* 아트보드: 카드 제목 '현장 사진 (n)' 아래 업로더 줄, 그 아래 사진 격자(구분선 없음). */}
      <Container title="현장 사진" counter={photos.length}>
        <div className="flex flex-col gap-4">
          <RefreshOnUpload target={{ site_id: id }} />
          <PhotoGallery photos={photos} />
        </div>
      </Container>
    </div>
  );
}
