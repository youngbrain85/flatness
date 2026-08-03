// 현장 상세 (스펙 §7.3: 트리 + 측정 이력 + 현장 사진)
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { buildLocationTree } from '@/lib/domain/tree';
import { LocationTree, type ScanWithCurrent } from '@/components/location-tree';
import { NewLocationForm } from '@/components/new-location-form';
import { PhotoGallery } from '@/components/photo-gallery';
import { RefreshOnUpload } from '@/components/refresh-on-upload';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import type { AnalysisStatus, LocationRow, PhotoRow, ScanRow, SiteRow, Verdict } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: site, error: siteError } = await supabase.from('sites').select('*').eq('id', id).maybeSingle();
  // 저비용 개선(현장 상세 무음 에러): siteError를 확인하지 않으면 연결 실패도
  // "현장 없음"(notFound)으로 오인된다 - 홈(app/page.tsx)의 SupabaseErrorNotice 패턴을 적용
  if (siteError) {
    return <main className="mx-auto max-w-6xl p-6"><SupabaseErrorNotice message={siteError.message} /></main>;
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
    return <main className="mx-auto max-w-6xl p-6"><SupabaseErrorNotice message={parallelError.message} /></main>;
  }
  const locations = (locationsRes.data ?? []) as LocationRow[];
  const locationIds = locations.map((l) => l.id);
  const scansRes = locationIds.length
    ? await supabase.from('scans').select('*').in('location_id', locationIds)
        .is('deleted_at', null).order('scanned_at', { ascending: false })
    : { data: [] as ScanRow[], error: null };
  if (scansRes.error) {
    return <main className="mx-auto max-w-6xl p-6"><SupabaseErrorNotice message={scansRes.error.message} /></main>;
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
    return <main className="mx-auto max-w-6xl p-6"><SupabaseErrorNotice message={currentsRes.error.message} /></main>;
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
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-bold">{(site as SiteRow).name}</h1>
        {(site as SiteRow).address && <p className="text-sm text-slate-500">{(site as SiteRow).address}</p>}
      </div>
      <section>
        <h2 className="mb-2 font-semibold">측정위치</h2>
        <LocationTree tree={buildLocationTree(locations)} scansByLocation={scansByLocation} siteId={id} />
        <div className="mt-3 rounded border bg-white p-3">
          <NewLocationForm siteId={id} />
        </div>
      </section>
      <section>
        <h2 className="mb-2 font-semibold">현장 사진</h2>
        <RefreshOnUpload target={{ site_id: id }} />
        <div className="mt-2">
          <PhotoGallery photos={(photosRes.data ?? []) as PhotoRow[]} />
        </div>
      </section>
    </main>
  );
}
