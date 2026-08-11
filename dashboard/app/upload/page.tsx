import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { UploadForm } from '@/components/upload-form';
import type { LocationRow, SiteRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function UploadPage({ searchParams }: {
  searchParams: Promise<{ location?: string }>;
}) {
  const { location } = await searchParams;
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
      <PageHeader crumbs={[{ href: '/', label: '홈' }]} title="스캔 업로드" />
      {/* D4: 측정위치가 0개인 현장도 폼 안에서 바로 만들 수 있다(인라인 생성) -
          업로드 전 별도 페이지로 보내던 빈 상태 분기와 sites[0] 하드코딩을 없애고
          폼을 항상 렌더한다. */}
      <UploadForm sites={sites} locations={locations} userId={user.id} initialLocationId={location} />
    </main>
  );
}
