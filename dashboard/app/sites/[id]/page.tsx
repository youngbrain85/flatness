// 현장 상세 (스펙 §7.3: 트리 + 측정 이력 + 현장 사진)
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { buildLocationTree } from '@/lib/domain/tree';
import { LocationTree, type ScanWithCurrent } from '@/components/location-tree';
import { NewLocationForm } from '@/components/new-location-form';
import { PhotoGallery } from '@/components/photo-gallery';
import { RefreshOnUpload } from '@/components/refresh-on-upload';
import type { AnalysisStatus, LocationRow, PhotoRow, ScanRow, SiteRow, Verdict } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: site } = await supabase.from('sites').select('*').eq('id', id).maybeSingle();
  if (!site) notFound();
  const [locationsRes, photosRes] = await Promise.all([
    supabase.from('locations').select('*').eq('site_id', id),
    supabase.from('photos').select('*').eq('site_id', id).order('created_at', { ascending: false }),
  ]);
  const locations = (locationsRes.data ?? []) as LocationRow[];
  const locationIds = locations.map((l) => l.id);
  const { data: scans } = locationIds.length
    ? await supabase.from('scans').select('*').in('location_id', locationIds)
        .is('deleted_at', null).order('scanned_at', { ascending: false })
    : { data: [] as ScanRow[] };
  const scanIds = (scans ?? []).map((s) => s.id);
  const { data: currents } = scanIds.length
    ? await supabase.from('analyses').select('id, scan_id, status, overall_verdict')
        .in('scan_id', scanIds).eq('is_current', true).is('deleted_at', null)
    : { data: [] };
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
