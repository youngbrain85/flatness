// 정합 화면 (단계 F Task 5, 스펙 §7.4). 아트보드: docs/design/dark/RegistrationDetail.dc.html
// 현장 밖 경로라 현장 헤더를 이 페이지가 직접 그린다 - 현장은 원본 스캔 → 측정위치 → 현장으로 찾는다.
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getRequestUser } from '@/lib/auth/request-user';
import { createClient } from '@/lib/supabase/server';
import { RegistrationWorkbench } from '@/components/registration/registration-workbench';
import { EntryHeader } from '@/components/shell/entry-header';
import { SiteHeader } from '@/components/shell/site-header';
import { Alert } from '@/components/ui/alert';
import { LinkButton } from '@/components/ui/button';
import { MAIN_BG, PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { StatusIndicator, TONE_STATUS } from '@/components/ui/status-indicator';
import { REGISTRATION_STATUS_LABEL } from '@/lib/domain/labels';
import { locationCrumb } from '@/lib/domain/location-label';
import type { LocationRow, RegistrationRow, RegistrationStatus, ScanRow, SiteRow } from '@/lib/domain/types';

// 진행 상태 배지는 판정이 아니라 "진행이 어디까지 왔나"를 보여준다 - 완료만 pass,
// 실패만 fail, 나머지(대응점 대기·정합 대기·정합 중)는 아직 결과가 없으니 unknown.
// export: F2 픽스 - 단위 테스트가 페이지 서버 함수를 거치지 않고 이 매핑만 직접 검증한다.
// 반환 타입을 세 톤으로 좁힌 것은 TONE_STATUS(pass/warn/fail/unknown/busy) 색인을 위해서다 -
// 매핑 자체는 그대로다.
export function statusTone(status: RegistrationStatus): 'pass' | 'fail' | 'unknown' {
  if (status === 'done') return 'pass';
  if (status === 'failed') return 'fail';
  return 'unknown';
}

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '스캔 정합' };

export default async function RegistrationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  // proxy가 검증한 헤더를 읽는다(Auth 왕복 0회). 가드는 방어 심층으로 유지.
  const user = await getRequestUser();
  if (!user) redirect('/login');

  // ★ 진행 상태는 registrations에서만 읽는다(설계 결정 F10). jobs 테이블은 RLS
  //   정책이 0개라 대시보드가 아예 읽지 못한다.
  const { data: row } = await supabase.from('registrations').select('*')
    .eq('id', id).maybeSingle();
  if (!row) notFound();
  const registration = row as RegistrationRow;

  const { data: scanRows } = await supabase.from('scans').select('*')
    .in('id', registration.source_scan_ids);
  // ★ .in()은 배열 순서를 보장하지 않는다. source_scan_ids 순서로 다시 세우지 않으면
  //   A와 B가 뒤바뀌어, 워커가 대응점 a를 source_scan_ids[0]으로 해석하는 계약이
  //   깨진다 - 대응점이 서로 반대 스캔에 붙어 정합이 통째로 틀린다(조용한 실패).
  const byId = new Map(((scanRows ?? []) as ScanRow[]).map((s) => [s.id, s]));
  const scanA = byId.get(registration.source_scan_ids[0]);
  const scanB = byId.get(registration.source_scan_ids[1]);

  // 현장 헤더와 브레드크럼을 위해 원본 스캔의 location_id로 측정위치·현장을 찾는다(registrations 행 자체에는
  // 위치 정보가 없다). 원본 스캔이 둘 다 지워졌으면(아래 "원본 스캔을 찾을 수 없습니다" 분기) 위치·현장을
  // 알 수 없으니 진입 헤더 + '현장 목록' 크럼으로 돌아갈 길만 남긴다.
  const scanForLocation = scanA ?? scanB;
  let loc: LocationRow | null = null;
  let site: SiteRow | null = null;
  if (scanForLocation) {
    const { data: locRow } = await supabase.from('locations').select('*')
      .eq('id', scanForLocation.location_id).maybeSingle();
    if (locRow) {
      loc = locRow as LocationRow;
      const { data: siteRow } = await supabase.from('sites').select('*')
        .eq('id', loc.site_id).maybeSingle();
      site = (siteRow as SiteRow | null) ?? null;
    }
  }
  // 브레드크럼(스펙 §4.3): 탭 이름(측정위치)부터, 측정위치 표기는 ' · '.
  const crumbs = loc
    ? [
        { href: `/sites/${loc.site_id}/locations`, label: '측정위치' },
        { href: `/sites/${loc.site_id}/locations#loc-${loc.id}`, label: locationCrumb(loc) },
        { label: '스캔 정합' },
      ]
    : [{ href: '/', label: '현장 목록' }, { label: '스캔 정합' }];

  return (
    <>
      {site ? <SiteHeader site={{ id: site.id, name: site.name }} email={user.email} /> : <EntryHeader email={user.email} />}
      <main className={MAIN_BG}>
        <div className={PAGE_MAIN}>
          {/* 아트보드 RegistrationDetail: h1 '스캔 정합'과 진행 상태(8px 점 + 14px 글자)가 한 줄(gap 8px 16px).
              PageHeader의 description은 h1 아래 별도 줄이라 쓸 수 없다 - title 자리에 글자 + StatusIndicator를
              함께 넣는다. 상태 글자는 h1의 제목 글꼴·굵기·줄높이를 물려받지 않게 되짚는다. */}
          <PageHeader crumbs={crumbs} title={
            <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
              스캔 정합
              <StatusIndicator type={TONE_STATUS[statusTone(registration.status)]}
                className="font-sans text-sm font-normal leading-normal">
                {REGISTRATION_STATUS_LABEL[registration.status]}
              </StatusIndicator>
            </span>
          } />
          {scanA && scanB ? (
            <RegistrationWorkbench registration={registration} scanA={scanA} scanB={scanB} />
          ) : (
            // registrations.source_scan_ids는 배열이라 FK가 없다 - 원본 스캔이 지워지면
            // 죽은 id가 남는 것을 007이 이력 테이블로서 의도적으로 허용했다. 화면이 견딘다.
            <Alert type="warning" title="원본 스캔을 찾을 수 없습니다.">
              <p>
                정합에 쓰인 스캔이 삭제된 것 같습니다. 이 정합 이력은 남지만 대응점을 다시
                찍을 수는 없습니다. 새 정합을 시작하세요.
              </p>
              {registration.result_scan_id && (
                <div className="mt-3">
                  <LinkButton href={`/scans/${registration.result_scan_id}`}>이 정합이 만든 병합 스캔 열기</LinkButton>
                </div>
              )}
            </Alert>
          )}
        </div>
      </main>
    </>
  );
}
