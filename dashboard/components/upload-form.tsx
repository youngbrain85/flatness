'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { enqueueJob } from '@/lib/domain/jobs';
import { LINEAGE_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
import type { CriteriaRow, Lineage, LocationRow, SiteRow, Surface } from '@/lib/domain/types';
import { uploadRawScan } from '@/lib/scans/upload';
import { IMPORT_EXTS, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, SCAN_EXTS, validateFile } from '@/lib/upload/validate';

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
    let cancelled = false;
    (async () => {
      // 이펙트 본문 최상단 동기 setState는 린트 경고 대상이라 IIFE 내부로 통일한다
      if (!siteId) { setCriteria([]); setCriteriaId(''); return; }
      // p_kind 인자를 생략한다 - 기본값 'flatness'가 이 업로드 화면이 의도하는 값과
      // 정확히 일치한다(업로드 폼은 항상 평활도 첫 분석만 만든다. 구배는 스캔 상세의
      // 별도 버튼에서 시작한다 - reanalyze-button.tsx).
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
    const allowedExts = mode === 'import' ? IMPORT_EXTS : SCAN_EXTS;
    const v = validateFile(file.name, allowedExts);
    if (!v) {
      setError(mode === 'import' ? '지원 포맷: csv, json' : '지원 포맷: ply, las, laz, xyz, txt, csv, pts');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      // 리뷰 Important #3: Storage 왕복 전에 미리 걸러 대용량 파일 전송 대기를 없앤다(Storage도 동일 상한을 재검증)
      setError(`파일이 너무 큽니다(최대 ${MAX_UPLOAD_MB}MB). 스캔 범위를 나눠 다시 시도하세요.`);
      return;
    }
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

      // 2) 파일 저장 (브라우저 -> Supabase Storage 직접 업로드, raw-scans 버킷 규약)
      const relPath = await uploadRawScan(supabase, file, siteId, scan.id, v.ext);

      // 3) raw_file_path 반영 (버킷-상대 규약 문자열)
      const { error: updErr } = await supabase.from('scans')
        .update({ raw_file_path: relPath, ...(mode === 'import' ? { status: 'ready' } : {}) })
        .eq('id', scan.id);
      if (updErr) throw new Error(updErr.message);

      // 잡 등록에 실패하면 이번 제출로 만든 것을 되돌린다. 그대로 두면 잡이 없는데
      // status가 'uploaded'(사전 검사 대기) 또는 'ready'(분석 준비됨)인 스캔이 남아,
      // 화면상 정상처럼 보이면서 영원히 진행되지 않는다. 재시도 버튼은 분석 행이 있어야
      // 뜨므로(scans/[id]의 latest 분기) 사용자가 UI로 복구할 방법도 없다. 흔적을 지우고
      // 재업로드를 안내하는 편이 정직하다. 이미 올라간 Storage 객체는 남는다(티켓 58).
      const scanId = scan.id;
      async function discardScan(message: string) {
        await supabase.from('scans')
          .update({ deleted_at: new Date().toISOString() }).eq('id', scanId);
        setError(`${message} 업로드한 스캔은 등록되지 않았습니다. 다시 시도하세요.`);
        setBusy(false);
      }

      // 4) 잡 등록 (리뷰 Important #1: 실패 시 화면에 오류를 남기고 이동하지 않는다 -
      // unit-confirm-form.tsx와 동일 패턴. 이전에는 setError 직후 무조건 router.push가
      // 실행돼 컴포넌트가 언마운트되며 오류 메시지가 사용자 눈에 보이기 전에 사라졌다)
      if (mode === 'import') {
        // kind를 명시적으로 지정한다(단계 C). DB 기본값에 기대지 않는다 - 임포트 결과는
        // 점 단위 편차 목록이지 점군이 아니라 애초에 구배 분석 대상이 될 수 없다.
        const { data: analysis, error: aErr } = await supabase.from('analyses').insert({
          scan_id: scanId, surface: 'floor', criteria_id: criteriaId,
          kind: 'flatness', status: 'queued', created_by: userId,
        }).select('id').single();
        if (aErr || !analysis) { await discardScan(aErr?.message ?? '분석 등록 실패'); return; }
        const r = await enqueueJob(supabase, 'import', { analysis_id: analysis.id });
        if (!r.ok) {
          await supabase.from('analyses')
            .update({ deleted_at: new Date().toISOString() }).eq('id', analysis.id);
          await discardScan(r.message);
          return;
        }
      } else {
        const r = await enqueueJob(supabase, 'precheck', { scan_id: scanId });
        if (!r.ok) { await discardScan(r.message); return; }
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
          기존 결과 가져오기(CSV/JSON)
        </label>
      </div>
      {mode === 'import' && (
        <p className="rounded bg-slate-100 p-2 text-xs text-slate-600">
          기존 Colab 노트북 결과 CSV(X, Y, Signed_Distance_mm 컬럼 필수) 또는 범용
          연계 JSON(format: &quot;flatness-import-v1&quot;, points[].x/y/deviation_mm)을
          등록합니다. 바닥 결과만 지원하며, 결과 화면에 &quot;외부 결과&quot; 배지가
          표시됩니다.
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
              융합 메시는 앱이 스무딩한 데이터라 실제보다 양호하게 나올 수 있습니다. 분석 결과와 보고서에 경고가 표시됩니다.
            </p>
          )}
        </div>
      )}
      <div>
        <label htmlFor="file" className="block text-sm font-medium">
          {mode === 'import' ? '결과 파일 (csv/json)' : '스캔 파일 (ply/las/laz/xyz/txt/csv/pts)'}
        </label>
        <input id="file" type="file" required onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 w-full text-sm" />
        <p className="mt-1 text-xs text-slate-500">
          파일은 Supabase Storage에 저장됩니다. 파일당 최대 {MAX_UPLOAD_MB}MB입니다.
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
