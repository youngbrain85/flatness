// 정합 시작 화면 (단계 F Task 5, 스펙 §6.2 2단계)
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { RegistrationCreateForm } from '@/components/registration/registration-create-form';
import type { LocationRow, ScanRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function NewRegistrationPage(
  { searchParams }: { searchParams: Promise<{ location?: string }> },
) {
  const { location: locationId } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!locationId) notFound();

  const { data: location } = await supabase.from('locations').select('*')
    .eq('id', locationId).maybeSingle();
  if (!location) notFound();
  const loc = location as LocationRow;

  // 벽 스캔은 범위 밖이다 - 높이 뷰가 256x1 픽셀 띠라 클릭이 성립하지 않는다.
  const { data: scanRows } = await supabase.from('scans').select('*')
    .eq('location_id', locationId).eq('surface', 'floor').is('deleted_at', null)
    .order('scanned_at', { ascending: false });

  // 후보 조건은 세 가지다. 셋 다 정합의 전제이며 하나라도 빠지면 워커가 죽는다:
  //   - height_view_path: 대응점을 찍을 그림과 사이드카가 있어야 한다(설계 결정 F7).
  //     산출물 3종은 전부-있음 아니면 전부-없음이라 이 컬럼 하나로 판별된다.
  //   - unit_scale: 워커 load_source_points가 "단위가 확정되지 않아 정합할 수
  //     없습니다"로 거부한다.
  //   - status='ready': 단위 확정이 끝나 분석 가능한 상태.
  const candidates = ((scanRows ?? []) as ScanRow[]).filter(
    (s) => !!s.height_view_path && s.unit_scale !== null && s.status === 'ready',
  );

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-xl font-bold">스캔 정합 시작</h1>
      <p className="text-sm text-slate-600">
        {[loc.building, loc.floor, loc.room, loc.name].filter(Boolean).join(' / ')}
        {' '}측정위치의 바닥 스캔 두 개를 하나로 합칩니다. 같은 공간을 나눠 찍은 스캔에서
        같은 지점을 번갈아 찍어 대응점을 만들고, 그 대응점으로 정합한 뒤 서브셀 중앙값
        점군 하나로 병합합니다.
      </p>
      {candidates.length < 2 ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium">정합할 수 있는 스캔이 두 개 이상 필요합니다.</p>
          <p className="mt-1 text-xs text-slate-700">
            후보가 되려면 바닥 스캔이면서 사전 검사가 끝나 높이 뷰가 있고 단위가 확정된
            (분석 준비됨) 상태여야 합니다. 현재 이 측정위치의 후보는 {candidates.length}개입니다.
          </p>
          <Link href={`/upload?site=${loc.site_id}&location=${loc.id}`}
            className="mt-2 inline-block rounded bg-blue-700 px-3 py-1.5 text-xs text-white">
            스캔 업로드
          </Link>
        </div>
      ) : (
        <RegistrationCreateForm scans={candidates} userId={user.id} />
      )}
    </main>
  );
}
