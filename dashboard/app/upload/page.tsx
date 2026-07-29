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
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-xl font-bold">스캔 업로드</h1>
      <UploadForm
        sites={(sitesRes.data ?? []) as SiteRow[]}
        locations={(locationsRes.data ?? []) as LocationRow[]}
        userId={user.id}
        initialSiteId={site}
        initialLocationId={location}
      />
    </main>
  );
}
