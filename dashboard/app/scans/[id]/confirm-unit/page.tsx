import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { UnitConfirmForm } from '@/components/unit-confirm-form';
import type { ScanRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function ConfirmUnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: scan } = await supabase.from('scans').select('*').eq('id', id).maybeSingle();
  if (!scan) notFound();
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-xl font-bold">단위 확인</h1>
      <UnitConfirmForm scan={scan as ScanRow} userId={user.id} />
    </main>
  );
}
