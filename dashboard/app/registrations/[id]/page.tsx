// 정합 화면 (단계 F Task 5, 스펙 §7.4)
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { RegistrationWorkbench } from '@/components/registration/registration-workbench';
import { REGISTRATION_STATUS_LABEL } from '@/lib/domain/labels';
import type { RegistrationRow, ScanRow } from '@/lib/domain/types';

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

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-bold">스캔 정합</h1>
        <span className="rounded bg-slate-200 px-2 py-0.5 text-xs">
          {REGISTRATION_STATUS_LABEL[registration.status]}
        </span>
      </div>
      {scanA && scanB ? (
        <RegistrationWorkbench registration={registration} scanA={scanA} scanB={scanB} />
      ) : (
        // registrations.source_scan_ids는 배열이라 FK가 없다 - 원본 스캔이 지워지면
        // 죽은 id가 남는 것을 007이 이력 테이블로서 의도적으로 허용했다. 화면이 견딘다.
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium">원본 스캔을 찾을 수 없습니다.</p>
          <p className="mt-1 text-xs text-slate-700">
            정합에 쓰인 스캔이 삭제된 것 같습니다. 이 정합 이력은 남지만 대응점을 다시
            찍을 수는 없습니다. 새 정합을 시작하세요.
          </p>
          {registration.result_scan_id && (
            <Link href={`/scans/${registration.result_scan_id}`}
              className="mt-2 inline-block text-xs text-blue-700 underline">
              이 정합이 만든 병합 스캔 열기
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
