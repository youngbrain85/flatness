// 정합 화면 (단계 F Task 5, 스펙 §7.4)
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { RegistrationWorkbench } from '@/components/registration/registration-workbench';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { REGISTRATION_STATUS_LABEL } from '@/lib/domain/labels';
import type { LocationRow, RegistrationRow, RegistrationStatus, ScanRow, SiteRow } from '@/lib/domain/types';

// 진행 상태 배지는 판정이 아니라 "진행이 어디까지 왔나"를 보여준다 - 완료만 pass,
// 실패만 fail, 나머지(대응점 대기·정합 대기·정합 중)는 아직 결과가 없으니 unknown.
function statusTone(status: RegistrationStatus): BadgeTone {
  if (status === 'done') return 'pass';
  if (status === 'failed') return 'fail';
  return 'unknown';
}

export const dynamic = 'force-dynamic';

export default async function RegistrationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
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

  // D8 브리프 Step 2: scans/[id]·reports/[id]와 같은 3단계 브레드크럼(현장 › 현장명 ›
  // 측정위치)을 이 화면에도 맞춘다. registrations 행 자체에는 위치 정보가 없어
  // 원본 스캔의 location_id를 거쳐 조회한다 - 원본 스캔이 둘 다 지워졌으면(위 "원본
  // 스캔을 찾을 수 없습니다" 분기) 위치를 알 수 없으니 현장 홈 링크만 남긴다.
  const scanForLocation = scanA ?? scanB;
  let crumbs: { href?: string; label: string }[] = [{ href: '/', label: '현장' }];
  if (scanForLocation) {
    const { data: locRow } = await supabase.from('locations').select('*')
      .eq('id', scanForLocation.location_id).maybeSingle();
    if (locRow) {
      const loc = locRow as LocationRow;
      const { data: siteRow } = await supabase.from('sites').select('*')
        .eq('id', loc.site_id).maybeSingle();
      const locationLabel = [loc.building, loc.floor, loc.room, loc.name].filter(Boolean).join(' / ');
      crumbs = [
        { href: '/', label: '현장' },
        { href: `/sites/${loc.site_id}`, label: siteRow ? (siteRow as SiteRow).name : '현장 상세' },
        { label: locationLabel },
      ];
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <PageHeader crumbs={crumbs} title="스캔 정합" actions={
        <Badge tone={statusTone(registration.status)}>{REGISTRATION_STATUS_LABEL[registration.status]}</Badge>
      } />
      {scanA && scanB ? (
        <RegistrationWorkbench registration={registration} scanA={scanA} scanB={scanB} />
      ) : (
        // registrations.source_scan_ids는 배열이라 FK가 없다 - 원본 스캔이 지워지면
        // 죽은 id가 남는 것을 007이 이력 테이블로서 의도적으로 허용했다. 화면이 견딘다.
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium">원본 스캔을 찾을 수 없습니다.</p>
          <p className="mt-1 text-xs text-zinc-700">
            정합에 쓰인 스캔이 삭제된 것 같습니다. 이 정합 이력은 남지만 대응점을 다시
            찍을 수는 없습니다. 새 정합을 시작하세요.
          </p>
          {registration.result_scan_id && (
            <Link href={`/scans/${registration.result_scan_id}`}
              className="mt-2 inline-block text-xs text-zinc-700 hover:text-zinc-900 underline">
              이 정합이 만든 병합 스캔 열기
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
