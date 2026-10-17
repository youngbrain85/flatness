// 정합 시작 화면 (단계 F Task 5, 스펙 §6.2 2단계). 아트보드: docs/design/dark/RegistrationNew.dc.html
// 현장 밖 경로라 현장 헤더를 이 페이지가 직접 그린다 - 현장은 측정위치 → 현장으로 찾는다(스펙 §4.2).
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getRequestUser } from '@/lib/auth/request-user';
import { createClient } from '@/lib/supabase/server';
import { RegistrationCreateForm } from '@/components/registration/registration-create-form';
import { EntryHeader } from '@/components/shell/entry-header';
import { SiteHeader } from '@/components/shell/site-header';
import { Alert } from '@/components/ui/alert';
import { LinkButton } from '@/components/ui/button';
import { MAIN_BG, PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { locationCrumb } from '@/lib/domain/location-label';
import type { LocationRow, ScanRow, SiteRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '스캔 정합 시작' };

export default async function NewRegistrationPage(
  { searchParams }: { searchParams: Promise<{ location?: string }> },
) {
  const { location: locationId } = await searchParams;
  const supabase = await createClient();
  // proxy가 검증한 헤더를 읽는다(Auth 왕복 0회). 가드는 방어 심층으로 유지.
  const user = await getRequestUser();
  if (!user) redirect('/login');
  if (!locationId) notFound();

  const { data: location } = await supabase.from('locations').select('*')
    .eq('id', locationId).maybeSingle();
  if (!location) notFound();
  const loc = location as LocationRow;
  const locationLabel = [loc.building, loc.floor, loc.room, loc.name].filter(Boolean).join(' / ');
  // perf-auth-roundtrips: site와 scanRows는 서로 독립이라 병렬로 돈다.
  // 벽 스캔은 범위 밖이다 - 높이 뷰가 256x1 픽셀 띠라 클릭이 성립하지 않는다.
  const [{ data: site }, { data: scanRows }] = await Promise.all([
    supabase.from('sites').select('*').eq('id', loc.site_id).maybeSingle(),
    supabase.from('scans').select('*')
      .eq('location_id', locationId).eq('surface', 'floor').is('deleted_at', null)
      .order('scanned_at', { ascending: false }),
  ]);
  const s = site as SiteRow | null;
  // 브레드크럼(스펙 §4.3): 현장은 헤더에 있으므로 탭 이름(측정위치)부터 시작한다. 측정위치 표기는
  // 구분자 '/'와 헷갈리지 않게 ' · '로 잇고, 그 크럼은 측정위치 탭의 그 줄(#loc-<id>)로 간다.
  const crumbs = [
    { href: `/sites/${loc.site_id}/locations`, label: '측정위치' },
    { href: `/sites/${loc.site_id}/locations#loc-${loc.id}`, label: locationCrumb(loc) },
    { label: '스캔 정합 시작' },
  ];

  // 후보 조건은 세 가지다. 셋 다 정합의 전제이며 하나라도 빠지면 워커가 죽는다:
  //   - height_view_path: 대응점을 찍을 그림과 사이드카가 있어야 한다(설계 결정 F7).
  //     산출물 3종은 전부-있음 아니면 전부-없음이라 이 컬럼 하나로 판별된다.
  //   - unit_scale: 워커 load_source_points가 "단위가 확정되지 않아 정합할 수
  //     없습니다"로 거부한다.
  //   - status='ready': 단위 확정이 끝나 분석 가능한 상태.
  const candidates = ((scanRows ?? []) as ScanRow[]).filter(
    (row) => !!row.height_view_path && row.unit_scale !== null && row.status === 'ready',
  );

  // 아트보드 RegistrationNew: 안내문은 h1 아래 설명(PageHeader description) - 문구는 그대로(측정위치는 ' / ').
  const description = `${locationLabel} 측정위치의 바닥 스캔 두 개를 하나로 합칩니다. 같은 공간을 나눠 찍은 스캔에서 같은 지점을 번갈아 찍어 대응점을 만들고, 그 대응점으로 정합한 뒤 서브셀 중앙값 점군 하나로 병합합니다.`;

  return (
    <>
      {/* 현장 행을 못 읽으면(RLS 등) 현장 헤더를 그릴 수 없다 - 진입 헤더로 대신한다(막다른 화면 금지) */}
      {s ? <SiteHeader site={{ id: s.id, name: s.name }} email={user.email} /> : <EntryHeader email={user.email} />}
      <main className={MAIN_BG}>
        <div className={PAGE_MAIN}>
          {/* 아트보드: 머리·카드·버튼 줄이 760px 한 열 */}
          <div className="flex w-full max-w-[760px] flex-col gap-5">
            <PageHeader crumbs={crumbs} title="스캔 정합 시작" description={description} />
            {candidates.length < 2 ? (
              // 막다른 화면 금지: 후보가 모자라면 업로드로 가는 버튼이 이 화면의 유일한(주) 행동이다.
              <Alert type="warning" title="정합할 수 있는 스캔이 두 개 이상 필요합니다.">
                <p>
                  후보가 되려면 바닥 스캔이면서 사전 검사가 끝나 높이 뷰가 있고 단위가 확정된
                  (분석 준비됨) 상태여야 합니다. 현재 이 측정위치의 후보는 {candidates.length}개입니다.
                </p>
                <div className="mt-3">
                  <LinkButton href={`/sites/${loc.site_id}/upload?location=${loc.id}`} variant="primary">
                    스캔 업로드
                  </LinkButton>
                </div>
              </Alert>
            ) : (
              <RegistrationCreateForm scans={candidates} userId={user.id} />
            )}
          </div>
        </div>
      </main>
    </>
  );
}
