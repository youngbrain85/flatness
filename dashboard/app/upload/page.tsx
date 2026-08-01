import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { UploadForm } from '@/components/upload-form';
import type { LocationRow, SiteRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function UploadPage({ searchParams }: {
  searchParams: Promise<{ site?: string; location?: string }>;
}) {
  const { site, location } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const [sitesRes, locationsRes] = await Promise.all([
    supabase.from('sites').select('*').order('name'),
    supabase.from('locations').select('*'),
  ]);
  const sites = (sitesRes.data ?? []) as SiteRow[];
  const locations = (locationsRes.data ?? []) as LocationRow[];
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-xl font-bold">스캔 업로드</h1>
      {locations.length === 0 ? (
        // C3: 측정위치가 하나도 없으면 빈 드롭다운만 보여서 처음 온 사용자가
        // 막힌다 — 무엇을 먼저 해야 하는지 안내하고 다음 동작으로 바로 연결한다.
        <div className="rounded border border-dashed bg-slate-50 p-6 text-sm">
          <p className="text-slate-600">
            먼저 현장과 측정위치를 만들어야 업로드할 수 있습니다.
          </p>
          {sites.length === 0 ? (
            <Link href="/sites/new"
              className="mt-3 inline-block rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">
              새 현장 만들기
            </Link>
          ) : (
            <Link href={`/sites/${sites[0].id}`}
              className="mt-3 inline-block rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">
              측정위치 추가하러 가기
            </Link>
          )}
        </div>
      ) : (
        <UploadForm
          sites={sites}
          locations={locations}
          userId={user.id}
          initialSiteId={site}
          initialLocationId={location}
        />
      )}
    </main>
  );
}
