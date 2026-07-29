// 스펙 §7.4 단위 확인 화면.
// P2 확정: precheck는 단위 후보를 저장할 컬럼이 없어 후보·근거 표시는 백로그 -
// 사용자가 파일의 좌표 단위를 직접 선택해 확정한다.
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { enqueueJob } from '@/lib/domain/jobs';
import type { ScanRow } from '@/lib/domain/types';
import { UNIT_OPTIONS } from '@/lib/upload/validate';

export function UnitConfirmForm({ scan, userId }: { scan: ScanRow; userId: string }) {
  const router = useRouter();
  const [unitScale, setUnitScale] = useState<number>(1.0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!scan.selected_criteria_id) {
      setError('적용 기준이 지정되지 않은 스캔입니다. 업로드를 다시 진행하세요.');
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // 1) 단위 확정 + ready 승격 (P2 확정: 확정은 UI 책임 - 워커 재경유 없이 직접 갱신)
    const { error: updErr } = await supabase.from('scans')
      .update({ unit_scale: unitScale, status: 'ready' }).eq('id', scan.id);
    if (updErr) { setError(updErr.message); setBusy(false); return; }
    // 2) 분석 행 생성 -> 분석 잡 등록 (스펙 §3.2.③: 단위 확정 시 분석 잡 자동 등록)
    const { data: analysis, error: aErr } = await supabase.from('analyses').insert({
      scan_id: scan.id, surface: scan.surface, criteria_id: scan.selected_criteria_id,
      status: 'queued', created_by: userId,
    }).select('id').single();
    if (aErr || !analysis) { setError(aErr?.message ?? '분석 등록 실패'); setBusy(false); return; }
    const r = await enqueueJob(supabase, 'analyze', { analysis_id: analysis.id });
    if (!r.ok) {
      // 409(중복 엔큐) 등 실패 안내를 사용자가 읽을 수 있게 화면에 남는다
      setError(r.message);
      setBusy(false);
      return;
    }
    router.push(`/scans/${scan.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-4">
      <p className="rounded bg-slate-100 p-3 text-sm">
        <span className="font-medium">{scan.original_filename ?? '(파일명 없음)'}</span>
        <span className="block text-xs text-slate-500">
          파일 좌표의 길이 단위를 확정해야 분석을 시작할 수 있습니다. 단위가 틀리면
          결과 전체가 왜곡되므로 스캔 앱의 내보내기 설정을 확인하세요.
        </span>
      </p>
      <div className="space-y-1">
        {UNIT_OPTIONS.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <input type="radio" checked={unitScale === o.value} onChange={() => setUnitScale(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy}
        className="rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50">
        단위 확정 후 분석 시작
      </button>
    </form>
  );
}
