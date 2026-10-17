'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { enqueueJob } from '@/lib/domain/jobs';
import { LINEAGE_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
import type { CriteriaRow, Lineage, LocationRow, Surface } from '@/lib/domain/types';
import { uploadRawScan } from '@/lib/scans/upload';
import { IMPORT_EXTS, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, SCAN_EXTS, validateFile } from '@/lib/upload/validate';
import { Alert } from '@/components/ui/alert';
import { Button, buttonClass } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { FormField, SelectWrap, checkClass, inputClass, selectClass } from '@/components/ui/form';
import { Icon } from '@/components/ui/icons';

interface Props {
  /** 경로(/sites/[id]/upload)가 정한 현장. 화면 안에서 바꾸지 않는다(스펙 §5 행 05). */
  siteId: string;
  /** 이 현장의 측정위치(페이지가 측정위치 탭 트리와 같은 순서로 정렬해 넘긴다). */
  locations: LocationRow[];
  userId: string;
  /** ?location= 프리필. 페이지가 이 현장의 측정위치인지 확인한 뒤에만 넘긴다. */
  initialLocationId?: string;
}

// 선택지 칩(아트보드 Upload 업로드 방식·표면 유형·데이터 계보): 고른 칩은 ink 테두리 + surface-2 바탕 + 600,
// 나머지는 line-3 테두리 + ink-2 글자. 칩은 진짜 라디오를 감싼 label이다.
function chipClass(on: boolean): string {
  return `inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-control border px-4 text-sm ${
    on ? 'border-ink bg-surface-2 font-semibold text-ink' : 'border-line-3 font-medium text-ink-2'}`;
}

// 적용 기준 목록 줄: 고른 줄은 surface-2 바탕 + 왼쪽 2px ink 막대, 줄 사이는 line 구분선.
function criteriaRowClass(on: boolean): string {
  return `flex cursor-pointer items-start gap-3 border-b border-l-2 border-b-line py-3 pl-3 pr-3.5 last:border-b-0 ${
    on ? 'border-l-ink bg-surface-2' : 'border-l-transparent'}`;
}

// 라디오 묶음 제목(fieldset/legend): FormField는 단일 컨트롤용 <label htmlFor>라 묶음에는 legend를 쓴다.
const FIELDSET = 'm-0 min-w-0 border-0 p-0';
const LEGEND = 'm-0 p-0 pb-2 text-sm font-semibold text-ink';

export function UploadForm({ siteId, locations, userId, initialLocationId }: Props) {
  const router = useRouter();
  // 측정위치 목록을 로컬 상태로 들고 있어야 인라인 생성 직후(페이지 새로고침 없이) 방금 만든
  // 위치를 셀렉트에 바로 넣고 고를 수 있다.
  const [locationsList, setLocationsList] = useState<LocationRow[]>(locations);
  const [mode, setMode] = useState<'scan' | 'import'>('scan');
  const [locationId, setLocationId] = useState(initialLocationId ?? '');
  const [surface, setSurface] = useState<Surface>('floor');
  const [criteria, setCriteria] = useState<CriteriaRow[]>([]);
  const [criteriaId, setCriteriaId] = useState('');
  // 적용 기준 목록이 비었을 때 그 까닭(불러오는 중·조회 실패·후보 없음). 빈 목록을 말없이 두지 않는다.
  const [criteriaNote, setCriteriaNote] = useState('적용 기준을 불러오는 중...');
  const [scannedAt, setScannedAt] = useState(new Date().toISOString().slice(0, 10));
  const [device, setDevice] = useState('');
  const [operatorManual, setOperatorManual] = useState('');
  const [lineage, setLineage] = useState<Lineage>('unknown');
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showNewLocation, setShowNewLocation] = useState(false);
  const [newLocFields, setNewLocFields] = useState({ building: '', floor: '', room: '', name: '' });
  const [newLocError, setNewLocError] = useState<string | null>(null);
  const [creatingLoc, setCreatingLoc] = useState(false);
  const newLocPanelId = useId();

  const effectiveSurface: Surface = mode === 'import' ? 'floor' : surface;

  // 적용 기준 후보: fn_resolve_criteria는 대체(override) 시맨틱 - 현장 기준이 있으면
  // 전역 기준은 목록에 아예 나오지 않는다. 반환 목록을 그대로 후보로 쓴다.
  // 다크 C안: 현장이 경로로 정해져 있으므로 측정위치를 고르기 전부터 바로 불러온다(기준은 현장·표면에만 달렸다).
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
      if (err || !data) {
        setCriteria([]);
        setCriteriaId('');
        setCriteriaNote(err ? `적용 기준을 불러오지 못했습니다: ${err.message}` : '적용 기준을 불러오지 못했습니다.');
        return;
      }
      const rows = data as CriteriaRow[];
      setCriteria(rows);
      setCriteriaId(rows.find((c) => c.is_default)?.id ?? rows[0]?.id ?? '');
      setCriteriaNote(rows.length === 0 ? '이 현장에 쓸 수 있는 적용 기준이 없습니다.' : '');
    })();
    return () => { cancelled = true; };
  }, [siteId, effectiveSurface]);

  function clearFile() {
    setFile(null);
    // 입력값도 비워야 같은 파일을 다시 골랐을 때 change가 나고, required 검증도 다시 걸린다.
    if (fileRef.current) fileRef.current.value = '';
  }

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
        // ★ 재리뷰: 이 update의 오류를 검사하지 않은 채 "등록되지 않았습니다"라고
        // 단언하면 안 된다. insert를 죽인 연결 장애는 이 삭제도 죽인다 - 그러면
        // 스캔이 status='ready'(임포트 모드는 3)에서 이미 승격했다) + analyses 0행으로
        // 남는데, 화면은 정리됐다고 말한다. 그 상태가 바로 스캔 상세의 "분석 시작"
        // 진입점이 임포트인지 아닌지 판별해야 하는 대상이다(app/scans/[id]/page.tsx).
        // 실패를 삼키지 않고 사실대로 알린다.
        const { error: delErr } = await supabase.from('scans')
          .update({ deleted_at: new Date().toISOString() }).eq('id', scanId);
        setError(delErr
          ? `${message} 업로드한 스캔을 정리하지도 못했습니다(${delErr.message}). 이 스캔이 분석 없이 목록에 남아 있을 수 있으니 관리자에게 알리세요.`
          : `${message} 업로드한 스캔은 등록되지 않았습니다. 다시 시도하세요.`);
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

  // 그 자리에서 새 측정위치 만들기(같은 현장). insert 컬럼은 new-location-form.tsx와
  // 동일하게 맞춘다 - 트림 정규화 책임도 그대로(001 주석). 층 순서(floor_order)는
  // 이 미니 폼에는 없어 0으로 둔다(정렬용 보조값이라 나중에 측정위치 탭에서 조정 가능).
  // 현장은 경로가 정하므로 옛 인라인 새 현장 만들기(와 그 고아 현장 방지 처리)는 없다(스펙 §5 행 05).
  async function handleCreateLocation() {
    setNewLocError(null);
    const name = newLocFields.name.trim();
    if (!name) { setNewLocError('측정위치명을 입력하세요.'); return; }
    setCreatingLoc(true);
    const supabase = createClient();
    try {
      const { data: locRow, error: locErr } = await supabase.from('locations').insert({
        site_id: siteId,
        building: newLocFields.building.trim(),
        floor: newLocFields.floor.trim(),
        floor_order: 0,
        room: newLocFields.room.trim(),
        name,
      }).select('id').single();
      if (locErr || !locRow) {
        setNewLocError(locErr?.code === '23505'
          ? '같은 동/층/공간에 동일한 측정위치가 이미 있습니다.'
          : (locErr?.message ?? '측정위치 저장 실패'));
        return;
      }
      const newLocation: LocationRow = {
        id: locRow.id, site_id: siteId,
        building: newLocFields.building.trim(), floor: newLocFields.floor.trim(), floor_order: 0,
        room: newLocFields.room.trim(), name, memo: null, created_at: '', updated_at: '',
      };
      setLocationsList((prev) => [...prev, newLocation]);
      setLocationId(newLocation.id);
      setShowNewLocation(false);
      setNewLocFields({ building: '', floor: '', room: '', name: '' });
    } finally {
      setCreatingLoc(false);
    }
  }

  // 아트보드(Upload): 카드 '업로드 정보'(업로드 방식 칩 → 두 열) → 오류 → 오른쪽 아래 주 버튼 하나.
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <Container title="업로드 정보">
        <div className="flex flex-col gap-4">
          <div role="radiogroup" aria-label="업로드 방식" className="flex flex-wrap gap-2">
            <label className={chipClass(mode === 'scan')}>
              <input type="radio" name="upload-mode" className={checkClass}
                checked={mode === 'scan'} onChange={() => setMode('scan')} />
              스캔 분석
            </label>
            <label className={chipClass(mode === 'import')}>
              <input type="radio" name="upload-mode" className={checkClass}
                checked={mode === 'import'} onChange={() => setMode('import')} />
              기존 결과 가져오기(CSV/JSON)
            </label>
          </div>
          {mode === 'import' && (
            <Alert type="info">
              기존 Colab 노트북 결과 CSV(X, Y, Signed_Distance_mm 컬럼 필수) 또는 범용
              연계 JSON(format: &quot;flatness-import-v1&quot;, points[].x/y/deviation_mm)을
              등록합니다. 바닥 결과만 지원하며, 결과 화면에 &quot;외부 결과&quot; 배지가
              표시됩니다.
            </Alert>
          )}

          {/* 두 열(flex 1 1 420px, 간격 28px 40px). 좁으면 세로로 쌓인다(스펙 §7). */}
          <div className="flex flex-wrap gap-x-10 gap-y-7">

            {/* 왼쪽 열: 측정위치(+그 자리에서 새 측정위치) · 표면 유형 · 데이터 계보 */}
            <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-[22px]">
              <div className="flex flex-col gap-2">
                <FormField label="측정위치" htmlFor="location">
                  <SelectWrap>
                    <select id="location" required value={locationId} onChange={(e) => setLocationId(e.target.value)}
                      className={selectClass}>
                      <option value="">선택...</option>
                      {locationsList.map((l) => (
                        <option key={l.id} value={l.id}>
                          {[l.building, l.floor, l.room, l.name].filter(Boolean).join(' / ')}
                        </option>
                      ))}
                    </select>
                  </SelectWrap>
                </FormField>
                <button type="button" aria-expanded={showNewLocation} aria-controls={newLocPanelId}
                  onClick={() => setShowNewLocation((v) => !v)}
                  className="inline-flex min-h-11 items-center gap-1.5 self-start px-1 text-sm font-semibold text-ink">
                  <Icon name="plus" />
                  새 측정위치
                </button>
                {showNewLocation && (
                  <div id={newLocPanelId} className="flex flex-col gap-4 rounded-control border border-line-2 bg-ground p-4"
                    onKeyDown={(e) => {
                      // 리뷰 F2: 이 패널은 상위 스캔 업로드 <form> 안에 중첩돼 있다. 파일·
                      // 위치·기준을 이미 골라둔 상태에서 미니폼 입력 중 Enter를 누르면 기본
                      // 동작이 상위 폼을 암묵 제출해 엉뚱한 기존 측정위치로 스캔이 올라간다.
                      // Enter를 여기서 가로채 "저장" 버튼과 같은 동작(측정위치 생성)으로
                      // 재해석한다(입력이 모두 단일 라인 input/select라 textarea 예외는 불필요).
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (!creatingLoc) handleCreateLocation();
                      }
                    }}>
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-3">
                      {([
                        ['building', '동'], ['floor', '층'], ['room', '공간'], ['name', '이름'],
                      ] as const).map(([key, label]) => (
                        <FormField key={key} label={label} htmlFor={`new-loc-${key}`}>
                          <input id={`new-loc-${key}`} value={newLocFields[key]}
                            onChange={(e) => setNewLocFields({ ...newLocFields, [key]: e.target.value })}
                            className={inputClass} />
                        </FormField>
                      ))}
                    </div>
                    {newLocError && <p role="alert" className="text-[13px] text-err">{newLocError}</p>}
                    {/* 이 화면의 주 버튼은 제출 하나 - '저장'은 보조, '취소'는 글자 버튼 */}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button onClick={handleCreateLocation} disabled={creatingLoc}>
                        {creatingLoc ? '저장 중...' : '저장'}
                      </Button>
                      <button type="button" onClick={() => setShowNewLocation(false)}
                        className="min-h-11 rounded-control px-3 text-[15px] font-medium text-ink-2">
                        취소
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {mode === 'scan' && (
                <fieldset className={FIELDSET}>
                  <legend className={LEGEND}>표면 유형</legend>
                  <div className="flex flex-wrap gap-2">
                    {(['floor', 'wall'] as const).map((sv) => (
                      <label key={sv} className={chipClass(surface === sv)}>
                        <input type="radio" name="upload-surface" className={checkClass}
                          checked={surface === sv} onChange={() => setSurface(sv)} />
                        {SURFACE_LABEL[sv]}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              {mode === 'scan' && (
                <div className="flex flex-col gap-2.5">
                  <fieldset className={FIELDSET}>
                    <legend className={LEGEND}>데이터 계보</legend>
                    <div className="flex flex-wrap gap-2">
                      {(['raw', 'fused_mesh', 'unknown'] as const).map((lv) => (
                        <label key={lv} className={chipClass(lineage === lv)}>
                          <input type="radio" name="upload-lineage" className={checkClass}
                            checked={lineage === lv} onChange={() => setLineage(lv)} />
                          {LINEAGE_LABEL[lv]}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {lineage === 'fused_mesh' && (
                    <Alert type="warning">
                      융합 메시는 앱이 스무딩한 데이터라 실제보다 양호하게 나올 수 있습니다. 분석 결과와 보고서에 경고가 표시됩니다.
                    </Alert>
                  )}
                </div>
              )}
            </div>

            {/* 오른쪽 열: 적용 기준 · 측정일자/장비 · 담당자 · 파일 */}
            <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-[22px]">
              <fieldset className={FIELDSET}>
                <legend className={LEGEND}>적용 기준</legend>
                <div className="flex flex-col overflow-hidden rounded-control border border-line-3">
                  {criteria.length === 0 && <p className="px-3.5 py-3 text-sm text-muted">{criteriaNote}</p>}
                  {criteria.map((c) => {
                    const on = criteriaId === c.id;
                    return (
                      <label key={c.id} className={criteriaRowClass(on)}>
                        <input type="radio" name="upload-criteria" className={`${checkClass} mt-0.5`}
                          checked={on} onChange={() => setCriteriaId(c.id)} />
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex flex-wrap items-baseline gap-x-2">
                            {/* 기준 코드는 ID 성격이라 mono(아트보드 13px) */}
                            <span className="font-mono text-[13px] text-ink">{c.name}</span>
                            {c.is_default && <span className="text-xs text-muted">(기본)</span>}
                            {c.site_id && <span className="text-xs text-muted">(현장 기준)</span>}
                          </span>
                          <span className="text-xs text-muted">{c.source_text}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <div className="flex flex-wrap gap-4">
                {/* 아트보드: 측정일자 flex 1 0 180px, 장비가 남은 폭을 가져간다 */}
                <div className="min-w-0 flex-[1_0_180px]">
                  <FormField label="측정일자" htmlFor="scanned-at">
                    <input id="scanned-at" type="date" required value={scannedAt}
                      onChange={(e) => setScannedAt(e.target.value)}
                      className={`${inputClass} font-mono [color-scheme:dark]`} />
                  </FormField>
                </div>
                <div className="min-w-0 flex-[999_1_240px]">
                  <FormField label="장비" htmlFor="device">
                    <input id="device" value={device} onChange={(e) => setDevice(e.target.value)}
                      placeholder="예: iPhone 15 Pro + 3d Scanner App" className={inputClass} />
                  </FormField>
                </div>
              </div>
              <FormField label="담당자 이름(직접 입력, 비우면 로그인 사용자)" htmlFor="operator">
                <input id="operator" value={operatorManual} onChange={(e) => setOperatorManual(e.target.value)}
                  className={inputClass} />
              </FormField>
              <FormField
                label={mode === 'import' ? '결과 파일 (csv/json)' : '스캔 파일 (ply/las/laz/xyz/txt/csv/pts)'}
                htmlFor="file">
                {/* 아트보드: 점선 파일 상자. 진짜 파일 입력이 상자 전체를 투명하게 덮어 누르기와 끌어다 놓기를
                    브라우저 기본 동작으로 받는다(따로 드래그 코드가 없다). 상자 안 '파일 선택'은 모양뿐이다. */}
                <div className="relative flex min-h-28 flex-wrap items-center justify-center gap-x-3.5 gap-y-2.5 rounded-control border border-dashed border-line-3 bg-ground p-5 text-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink">
                  <span aria-hidden className={buttonClass('normal')}>
                    <Icon name="upload" size={18} />
                    파일 선택
                  </span>
                  <span aria-hidden className="text-sm text-muted">또는 파일을 여기에 끌어다 놓기</span>
                  <input ref={fileRef} id="file" type="file" required
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                </div>
                {file && (
                  <div className="flex min-h-11 items-center justify-between gap-2 rounded-control border border-line-2 bg-ground pl-3">
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <Icon name="file" className="text-muted" />
                      <span className="min-w-0 font-mono text-[13px] text-ink [overflow-wrap:anywhere]">{file.name}</span>
                    </span>
                    <button type="button" aria-label="선택한 파일 빼기" onClick={clearFile}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink-2">
                      <Icon name="x" />
                    </button>
                  </div>
                )}
                <p className="text-[13px] text-muted">
                  파일은 Supabase Storage에 저장됩니다. 파일당 최대 <span className="font-mono">{MAX_UPLOAD_MB}</span>MB입니다.
                </p>
              </FormField>
            </div>

          </div>
        </div>
      </Container>
      {error && <Alert type="error">{error}</Alert>}
      {/* 카드 아래 오른쪽 - 이 화면 본문의 유일한 주 버튼 */}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="submit" variant="primary" disabled={busy}>
          <Icon name="upload" size={18} />
          {busy ? '업로드 중...' : mode === 'import' ? '가져오기 시작' : '업로드 후 사전 검사'}
        </Button>
      </div>
    </form>
  );
}
