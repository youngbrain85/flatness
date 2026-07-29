'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { enqueueJob } from '@/lib/domain/jobs';
import { LINEAGE_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
import type { CriteriaRow, Lineage, LocationRow, SiteRow, Surface } from '@/lib/domain/types';
import { validateScanFile } from '@/lib/upload/validate';

interface Props {
  sites: SiteRow[];
  locations: LocationRow[];
  userId: string;
  initialSiteId?: string;
  initialLocationId?: string;
}

export function UploadForm({ sites, locations, userId, initialSiteId, initialLocationId }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<'scan' | 'import'>('scan');
  const [siteId, setSiteId] = useState(initialSiteId ?? '');
  const [locationId, setLocationId] = useState(initialLocationId ?? '');
  const [surface, setSurface] = useState<Surface>('floor');
  const [criteria, setCriteria] = useState<CriteriaRow[]>([]);
  const [criteriaId, setCriteriaId] = useState('');
  const [scannedAt, setScannedAt] = useState(new Date().toISOString().slice(0, 10));
  const [device, setDevice] = useState('');
  const [operatorManual, setOperatorManual] = useState('');
  const [lineage, setLineage] = useState<Lineage>('unknown');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveSurface: Surface = mode === 'import' ? 'floor' : surface;
  const siteLocations = locations.filter((l) => l.site_id === siteId);

  // 적용 기준 후보: fn_resolve_criteria는 대체(override) 시맨틱 - 현장 기준이 있으면
  // 전역 기준은 목록에 아예 나오지 않는다. 반환 목록을 그대로 후보로 쓴다.
  useEffect(() => {
    if (!siteId) { setCriteria([]); setCriteriaId(''); return; }
    let cancelled = false;
    (async () => {
      const { data, error: err } = await createClient().rpc('fn_resolve_criteria', {
        p_site_id: siteId, p_surface: effectiveSurface,
      });
      if (cancelled) return;
      if (err || !data) { setCriteria([]); setCriteriaId(''); return; }
      const rows = data as CriteriaRow[];
      setCriteria(rows);
      setCriteriaId(rows.find((c) => c.is_default)?.id ?? rows[0]?.id ?? '');
    })();
    return () => { cancelled = true; };
  }, [siteId, effectiveSurface]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) { setError('파일을 선택하세요.'); return; }
    if (!locationId) { setError('측정위치를 선택하세요.'); return; }
    if (!criteriaId) { setError('적용 기준을 선택하세요.'); return; }
    const v = validateScanFile(file.name);
    if (!v) { setError('지원 포맷: ply, las, laz, xyz, txt, csv, pts'); return; }
    if (mode === 'import' && v.ext !== 'csv') { setError('기존 결과 가져오기는 CSV 파일만 지원합니다.'); return; }
    setBusy(true);
    const supabase = createClient();
    try {
      // 1) scans insert
      const { data: scan, error: insErr } = await supabase.from('scans').insert({
        location_id: locationId,
        surface: effectiveSurface,
        scanned_at: scannedAt,
        device: device.trim() || null,
        operator_id: userId,
        operator_name_manual: operatorManual.trim() || null,
        selected_criteria_id: criteriaId,
        original_filename: file.name,
        file_format: v.ext,
        lineage: mode === 'import' ? 'unknown' : lineage,
        status: 'uploaded',
        ...(mode === 'import' ? { unit_scale: 1.0 } : {}),
      }).select('id').single();
      if (insErr || !scan) throw new Error(insErr?.message ?? '스캔 등록 실패');

      // 2) 파일 저장 (로컬 data/raw-scans 규약 - 서버 route가 경로 생성)
      const fd = new FormData();
      fd.set('file', file);
      fd.set('site_id', siteId);
      fd.set('scan_id', scan.id);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? '파일 업로드 실패');

      // 3) raw_file_path 반영 (버킷-상대 규약 문자열)
      const { error: updErr } = await supabase.from('scans')
        .update({ raw_file_path: body.rel_path, ...(mode === 'import' ? { status: 'ready' } : {}) })
        .eq('id', scan.id);
      if (updErr) throw new Error(updErr.message);

      // 4) 잡 등록
      if (mode === 'import') {
        const { data: analysis, error: aErr } = await supabase.from('analyses').insert({
          scan_id: scan.id, surface: 'floor', criteria_id: criteriaId,
          status: 'queued', created_by: userId,
        }).select('id').single();
        if (aErr || !analysis) throw new Error(aErr?.message ?? '분석 등록 실패');
        const r = await enqueueJob(supabase, 'import', { analysis_id: analysis.id });
        if (!r.ok) { setError(r.message); }
      } else {
        const r = await enqueueJob(supabase, 'precheck', { scan_id: scan.id });
        if (!r.ok) { setError(r.message); }
      }
      router.push(`/scans/${scan.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '업로드에 실패했습니다');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-4">
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input type="radio" checked={mode === 'scan'} onChange={() => setMode('scan')} />
          스캔 분석
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={mode === 'import'} onChange={() => setMode('import')} />
          기존 결과 가져오기(Colab CSV)
        </label>
      </div>
      {mode === 'import' && (
        <p className="rounded bg-slate-100 p-2 text-xs text-slate-600">
          기존 Colab 노트북 결과 CSV(X, Y, Signed_Distance_mm 컬럼 필수)를 등록합니다.
          바닥 결과만 지원하며, 결과 화면에 &quot;외부 결과&quot; 배지가 표시됩니다.
        </p>
      )}
      <div>
        <label htmlFor="site" className="block text-sm font-medium">현장</label>
        <select id="site" required value={siteId}
          onChange={(e) => { setSiteId(e.target.value); setLocationId(''); }}
          className="mt-1 w-full rounded border px-3 py-2">
          <option value="">선택...</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="location" className="block text-sm font-medium">측정위치</label>
        <select id="location" required value={locationId} onChange={(e) => setLocationId(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2">
          <option value="">선택...</option>
          {siteLocations.map((l) => (
            <option key={l.id} value={l.id}>
              {[l.building, l.floor, l.room, l.name].filter(Boolean).join(' / ')}
            </option>
          ))}
        </select>
      </div>
      {mode === 'scan' && (
        <div className="flex gap-4 text-sm">
          <span className="font-medium">표면 유형:</span>
          {(['floor', 'wall'] as const).map((s) => (
            <label key={s} className="flex items-center gap-1">
              <input type="radio" checked={surface === s} onChange={() => setSurface(s)} />
              {SURFACE_LABEL[s]}
            </label>
          ))}
        </div>
      )}
      <div>
        <span className="block text-sm font-medium">적용 기준</span>
        <div className="mt-1 space-y-1 rounded border bg-white p-2 text-sm">
          {criteria.length === 0 && <p className="text-slate-500">현장을 먼저 선택하세요.</p>}
          {criteria.map((c) => (
            <label key={c.id} className="flex items-start gap-2">
              <input type="radio" checked={criteriaId === c.id} onChange={() => setCriteriaId(c.id)} />
              <span>
                {c.name}{c.is_default && <em className="ml-1 text-xs text-blue-700">(기본)</em>}
                {c.site_id && <em className="ml-1 text-xs text-emerald-700">(현장 기준)</em>}
                <span className="block text-xs text-slate-500">{c.source_text}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex gap-4">
        <div>
          <label htmlFor="scanned-at" className="block text-sm font-medium">측정일자</label>
          <input id="scanned-at" type="date" required value={scannedAt}
            onChange={(e) => setScannedAt(e.target.value)} className="mt-1 rounded border px-3 py-2" />
        </div>
        <div className="flex-1">
          <label htmlFor="device" className="block text-sm font-medium">장비</label>
          <input id="device" value={device} onChange={(e) => setDevice(e.target.value)}
            placeholder="예: iPhone 15 Pro + 3d Scanner App" className="mt-1 w-full rounded border px-3 py-2" />
        </div>
      </div>
      <div>
        <label htmlFor="operator" className="block text-sm font-medium">담당자 이름(직접 입력, 비우면 로그인 사용자)</label>
        <input id="operator" value={operatorManual} onChange={(e) => setOperatorManual(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      {mode === 'scan' && (
        <div className="text-sm">
          <span className="font-medium">데이터 계보:</span>
          <div className="mt-1 flex gap-4">
            {(['raw', 'fused_mesh', 'unknown'] as const).map((l) => (
              <label key={l} className="flex items-center gap-1">
                <input type="radio" checked={lineage === l} onChange={() => setLineage(l)} />
                {LINEAGE_LABEL[l]}
              </label>
            ))}
          </div>
          {lineage === 'fused_mesh' && (
            <p className="mt-1 text-xs text-amber-700">
              융합 메시는 앱이 스무딩한 데이터라 실제보다 양호하게 나올 수 있습니다. 결과에 경고가 표시됩니다.
            </p>
          )}
        </div>
      )}
      <div>
        <label htmlFor="file" className="block text-sm font-medium">
          {mode === 'import' ? '결과 CSV 파일' : '스캔 파일 (ply/las/laz/xyz/txt/csv/pts)'}
        </label>
        <input id="file" type="file" required onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 w-full text-sm" />
        <p className="mt-1 text-xs text-slate-500">
          파일은 로컬 서버의 data/raw-scans/ 아래에 저장됩니다(Supabase를 거치지 않음).
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy}
        className="rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50">
        {busy ? '업로드 중...' : mode === 'import' ? '가져오기 시작' : '업로드 후 사전 검사'}
      </button>
    </form>
  );
}
