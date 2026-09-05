// 현장 상세 (스펙 §7.3: 트리 + 측정 이력 + 현장 사진)
// Cloudscape 구조(아트보드 SiteDetail): PageHeader(현장 › 현장명, 설명=주소) → Container '측정위치 (n)'
// → Container '새 측정위치' → Container '현장 사진 (n)'. 쿼리·가드는 그대로다.
import { notFound } from 'next/navigation';
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
import type { AnalysisStatus, LocationRow, PhotoRow, ScanRow, SiteRow, Verdict } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: site, error: siteError } = await supabase.from('sites').select('*').eq('id', id).maybeSingle();
  // 저비용 개선(현장 상세 무음 에러): siteError를 확인하지 않으면 연결 실패도
  // "현장 없음"(notFound)으로 오인된다 - 홈(app/page.tsx)의 SupabaseErrorNotice 패턴을 적용
  if (siteError) {
    return <main className={PAGE_MAIN}><SupabaseErrorNotice message={siteError.message} /></main>;
  }
  if (!site) notFound();
  const [locationsRes, photosRes] = await Promise.all([
    supabase.from('locations').select('*').eq('site_id', id),
    supabase.from('photos').select('*').eq('site_id', id).order('created_at', { ascending: false }),
  ]);
  // 아래 `?? []`가 쿼리 실패를 조용히 흡수해 "측정위치가 없습니다"로 오인시키지
  // 않도록, 데이터를 비우기 전에 에러부터 확인한다.
  const parallelError = locationsRes.error ?? photosRes.error;
  if (parallelError) {
    return <main className={PAGE_MAIN}><SupabaseErrorNotice message={parallelError.message} /></main>;
  }
  const locations = (locationsRes.data ?? []) as LocationRow[];
  const photos = (photosRes.data ?? []) as PhotoRow[];
  const locationIds = locations.map((l) => l.id);
  const scansRes = locationIds.length
    ? await supabase.from('scans').select('*').in('location_id', locationIds)
        .is('deleted_at', null).order('scanned_at', { ascending: false })
    : { data: [] as ScanRow[], error: null };
  if (scansRes.error) {
    return <main className={PAGE_MAIN}><SupabaseErrorNotice message={scansRes.error.message} /></main>;
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
    return <main className={PAGE_MAIN}><SupabaseErrorNotice message={currentsRes.error.message} /></main>;
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
    <main className={PAGE_MAIN}>
      <PageHeader
        crumbs={[{ href: '/', label: '현장' }, { label: (site as SiteRow).name }]}
        title={(site as SiteRow).name}
        description={(site as SiteRow).address}
      />
      <Container title="측정위치" counter={locations.length}>
        <LocationTree tree={buildLocationTree(locations)} scansByLocation={scansByLocation} siteId={id} />
      </Container>
      <Container title="새 측정위치">
        <NewLocationForm siteId={id} />
      </Container>
      {/* 코드리뷰(Important): 아트보드(SiteDetail.dc.html:333-349)의 '현장 사진' 컨테이너는
          구분선이 하나(업로더 줄과 그리드 사이)뿐이고, 헤더 아래에는 구분선이 없다
          ('측정위치'/'새 측정위치'와 달리). title을 Container에 넘기면 공용 프리미티브가
          헤더 아래에 border-b를 무조건 그려 구분선이 두 개가 되므로, 여기서는 title을
          넘기지 않고 padded={false}로 제목·업로더 줄·구분선+그리드를 직접 배치한다.
          h2/카운터 클래스는 container.tsx 헤더의 것을 그대로 옮겨 시각적으로 동일하게 한다. */}
      <Container padded={false}>
        <div className="px-5 py-3">
          <h2 className="text-lg font-bold leading-[22px]">
            현장 사진
            <span className="ml-1.5 font-normal text-cs-text-secondary">({photos.length})</span>
          </h2>
        </div>
        <div className="px-5 pb-3">
          <RefreshOnUpload target={{ site_id: id }} />
        </div>
        <div className="border-t border-cs-divider p-5">
          <PhotoGallery photos={photos} />
        </div>
      </Container>
    </main>
  );
}
