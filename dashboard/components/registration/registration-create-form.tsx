// 정합 시작 폼 (단계 F Task 5, 스펙 §6.2 2단계)
//
// registrations 행을 status='awaiting_points'로 만들고 정합 화면으로 보낸다.
// 잡은 아직 걸지 않는다 - 대응점이 있어야 정합을 실행할 수 있다.
'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { ScanRow } from '@/lib/domain/types';

function optionLabel(s: ScanRow): string {
  return `${s.original_filename ?? '(파일명 없음)'} · ${s.scanned_at}`;
}

export function RegistrationCreateForm({ scans, userId }: { scans: ScanRow[]; userId: string }) {
  const router = useRouter();
  const [aId, setAId] = useState(scans[0]?.id ?? '');
  const [bId, setBId] = useState(scans[1]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!aId || !bId || aId === bId) {
      setError('서로 다른 스캔 두 개를 고르세요. 같은 스캔끼리는 정합할 수 없습니다.');
      return;
    }
    setBusy(true);
    const supabase = createClient();
    // ★ source_scan_ids의 순서가 계약이다 - a가 [0](기준), b가 [1](맞출 대상)이다
    //   (worker/flatworker/registration.py correspondence_arrays).
    const { data, error: insErr } = await supabase.from('registrations').insert({
      source_scan_ids: [aId, bId],
      correspondences: [],
      status: 'awaiting_points',
      created_by: userId,
    }).select('id').single();
    if (insErr || !data) {
      setError(`정합을 시작하지 못했습니다: ${insErr?.message ?? '알 수 없는 오류'}`);
      setBusy(false);
      return;
    }
    // push만 한다 - 뒤에 refresh를 붙이면 진행 중이던 이동이 취소된다
    // (unit-confirm-form.tsx가 문서화한 회귀).
    router.push(`/registrations/${data.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-4">
      <div>
        <label htmlFor="scan-a" className="block text-sm font-medium">
          기준 스캔 (A) - 이 스캔의 좌표계를 유지합니다
        </label>
        <select id="scan-a" value={aId} onChange={(e) => setAId(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2">
          {scans.map((s) => <option key={s.id} value={s.id}>{optionLabel(s)}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="scan-b" className="block text-sm font-medium">
          맞출 스캔 (B) - A에 맞춰 회전·이동합니다
        </label>
        <select id="scan-b" value={bId} onChange={(e) => setBId(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2">
          {scans.map((s) => <option key={s.id} value={s.id}>{optionLabel(s)}</option>)}
        </select>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy}
        className="rounded bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-50">
        대응점 찍기 시작
      </button>
    </form>
  );
}
