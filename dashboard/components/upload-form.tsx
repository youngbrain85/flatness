'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { enqueueJob } from '@/lib/domain/jobs';
import { LINEAGE_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
import type { CriteriaRow, Lineage, LocationRow, SiteRow, Surface } from '@/lib/domain/types';
import { uploadRawScan } from '@/lib/scans/upload';
import { IMPORT_EXTS, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, SCAN_EXTS, validateFile } from '@/lib/upload/validate';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { FormField, SelectWrap, checkClass, inputClass, selectClass } from '@/components/ui/form';
import { Icon } from '@/components/ui/icons';

interface Props {
  sites: SiteRow[];
  locations: LocationRow[];
  userId: string;
  initialLocationId?: string;
}

// 인라인 현장 생성 셀렉트의 "새 현장명 직접 입력" 값. 실제 site id(uuid)와 절대
// 겹치지 않는다.
const NEW_SITE_VALUE = '';

// Cloudscape 리스킨(T5): 입력·버튼·알림은 components/ui 프리미티브를 쓴다. 아래 둘은
// 프리미티브에 없는 이 화면 전용 모양이라 여기서만 정의한다(export 하지 않는다).
// 링크형 버튼: '+ 새 측정위치'·'취소'. 아트보드의 링크 스타일(cs-link 700, hover 밑줄).
const linkButtonClass =
  'inline-flex items-center gap-1.5 self-start text-sm font-bold text-cs-link hover:text-cs-link-hover hover:underline';
// 파일 입력: 드롭존은 소스에 없으므로 네이티브 input의 ::file-selector-button(Tailwind `file:`)만
// normal 버튼(2px cs-link 보더 알약) 모양으로 입힌다.
const fileInputClass =
  'w-full text-sm text-cs-text file:mr-3 file:h-8 file:cursor-pointer file:rounded-full file:border-2 file:border-cs-link file:bg-transparent file:px-5 file:text-sm file:font-bold file:text-cs-link';

export function UploadForm({ sites, locations, userId, initialLocationId }: Props) {
  const router = useRouter();
  // 현장 목록과 측정위치 목록을 로컬 상태로 들고 있어야 인라인 생성 직후
  // (페이지 새로고침 없이) 방금 만든 항목을 optgroup/셀렉트에 바로 반영할 수 있다.
  const [sitesList, setSitesList] = useState<SiteRow[]>(sites);
  const [locationsList, setLocationsList] = useState<LocationRow[]>(locations);
  const [mode, setMode] = useState<'scan' | 'import'>('scan');
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

  // 단계 D4: 현장 셀렉트를 없애고 측정위치 단일 셀렉트(optgroup)로 합쳤다. 현장은
  // 더 이상 독립 상태가 아니라 선택된 location에서 항상 역산한다 - 예전 버그
  // (?location=만 와도 현장 셀렉트가 비어 목록이 필터로 사라지는 문제)가 이
  // 구조 변경만으로 자연 소멸한다.
  const siteId = locationsList.find((l) => l.id === locationId)?.site_id ?? '';

  const [showNewLocation, setShowNewLocation] = useState(false);
  const [newLocSiteId, setNewLocSiteId] = useState(NEW_SITE_VALUE);
  const [newSiteName, setNewSiteName] = useState('');
  const [newLocFields, setNewLocFields] = useState({ building: '', floor: '', room: '', name: '' });
  const [newLocError, setNewLocError] = useState<string | null>(null);
  const [creatingLoc, setCreatingLoc] = useState(false);

  const effectiveSurface: Surface = mode === 'import' ? 'floor' : surface;

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

  // 인라인 현장·측정위치 생성. insert 컬럼은 new-site-form.tsx·new-location-form.tsx와
  // 동일하게 맞춘다 - 트림 정규화 책임도 그대로(001 주석). 층 순서(floor_order)는
  // 이 미니 폼에는 없어 0으로 둔다(정렬용 보조값이라 나중에 현장 상세에서 조정 가능).
  async function handleCreateLocation() {
    setNewLocError(null);
    const name = newLocFields.name.trim();
    if (!name) { setNewLocError('측정위치명을 입력하세요.'); return; }
    if (newLocSiteId === NEW_SITE_VALUE && !newSiteName.trim()) {
      setNewLocError('새 현장명을 입력하세요.');
      return;
    }
    setCreatingLoc(true);
    const supabase = createClient();
    try {
      let targetSiteId = newLocSiteId;
      // 이번 호출에서 sites insert가 성공했는지 - 아래 locations insert가 실패해도
      // site는 이미 DB에 실존하므로 실패 메시지와 재시도 동작에 쓴다(리뷰 F1).
      let justCreatedSite = false;
      if (targetSiteId === NEW_SITE_VALUE) {
        const siteName = newSiteName.trim();
        const { data: siteRow, error: siteErr } = await supabase.from('sites')
          .insert({ name: siteName, address: null, memo: null })
          .select('id').single();
        if (siteErr || !siteRow) { setNewLocError(siteErr?.message ?? '현장 저장 실패'); return; }
        targetSiteId = siteRow.id;
        justCreatedSite = true;
        setSitesList((prev) => [
          ...prev,
          { id: siteRow.id, name: siteName, address: null, memo: null, created_at: '', updated_at: '' },
        ]);
        // ★ 리뷰 F1: 아래 locations insert가 실패해도 이 두 setState는 그대로 둔다.
        // newLocSiteId를 NEW_SITE_VALUE로 남겨두면 사용자가 "저장"을 다시 눌렀을 때
        // 이 if 블록이 또 실행돼 같은 이름의 sites 행이 재시도마다 쌓인다(고아 site
        // 누적) - site는 이미 만들어졌으니 재시도는 그 site를 재사용해야 한다.
        setNewLocSiteId(targetSiteId);
        setNewSiteName('');
      }
      const { data: locRow, error: locErr } = await supabase.from('locations').insert({
        site_id: targetSiteId,
        building: newLocFields.building.trim(),
        floor: newLocFields.floor.trim(),
        floor_order: 0,
        room: newLocFields.room.trim(),
        name,
      }).select('id').single();
      if (locErr || !locRow) {
        const base = locErr?.code === '23505'
          ? '같은 동/층/공간에 동일한 측정위치가 이미 있습니다.'
          : (locErr?.message ?? '측정위치 저장 실패');
        // 이번 호출에서 site를 막 만들었는데 location 저장이 실패했다면, 재시도가
        // "새 현장 만들기"로 되돌아가지 않고 방금 만든 그 현장을 그대로 쓴다는 것을
        // 사용자에게 알린다(리뷰 F1).
        setNewLocError(justCreatedSite ? `현장은 생성됐습니다. 같은 현장으로 다시 시도하세요. (${base})` : base);
        return;
      }
      const newLocation: LocationRow = {
        id: locRow.id, site_id: targetSiteId,
        building: newLocFields.building.trim(), floor: newLocFields.floor.trim(), floor_order: 0,
        room: newLocFields.room.trim(), name, memo: null, created_at: '', updated_at: '',
      };
      setLocationsList((prev) => [...prev, newLocation]);
      setLocationId(newLocation.id);
      setShowNewLocation(false);
      setNewLocFields({ building: '', floor: '', room: '', name: '' });
      setNewSiteName('');
      setNewLocSiteId(targetSiteId);
    } finally {
      setCreatingLoc(false);
    }
  }

  return (
    // 페이지 섹션 gap(20px)과 같은 간격으로 컨테이너 -> 오류 -> 버튼 줄이 쌓인다.
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {/* 스펙 §7-8: 컨테이너 제목 '업로드 정보'는 아트보드에만 있던 문구지만 Cloudscape
          해부(컨테이너 헤더)의 일부라 시스템 크롬으로 채택한다. 데이터·기능 추가는 없다. */}
      <Container title="업로드 정보">
        <div className="flex flex-col gap-4">
          {/* 업로드 방식(아트보드 본문 첫 줄) */}
          <div className="flex items-center gap-6">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="radio" className={checkClass} checked={mode === 'scan'} onChange={() => setMode('scan')} />
              스캔 분석
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="radio" className={checkClass} checked={mode === 'import'} onChange={() => setMode('import')} />
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

          {/* 2열(gap 40px). 모바일(<md)은 세로 스택(스펙 §5). */}
          <div className="grid grid-cols-1 gap-10 md:grid-cols-2">

            {/* 좌열: 측정위치(+인라인 생성) · 표면 유형 · 데이터 계보 */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <FormField label="측정위치" htmlFor="location">
                  <SelectWrap>
                    <select id="location" required value={locationId} onChange={(e) => setLocationId(e.target.value)}
                      className={selectClass}>
                      <option value="">선택...</option>
                      {sitesList.map((s) => {
                        const locs = locationsList.filter((l) => l.site_id === s.id);
                        if (locs.length === 0) return null;
                        return (
                          <optgroup key={s.id} label={s.name}>
                            {locs.map((l) => (
                              <option key={l.id} value={l.id}>
                                {[l.building, l.floor, l.room, l.name].filter(Boolean).join(' / ')}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                  </SelectWrap>
                </FormField>
                {/* 문구 '+ 새 측정위치'는 접근 가능한 이름이자 테스트 셀렉터 - 아이콘으로 바꾸지 않는다 */}
                <button type="button" onClick={() => setShowNewLocation((v) => !v)} className={linkButtonClass}>
                  + 새 측정위치
                </button>
                {showNewLocation && (
                  <div className="flex flex-col gap-4 rounded-lg border border-cs-divider bg-white p-4"
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
                    <FormField label="현장 선택 또는 새 현장명" htmlFor="new-loc-site">
                      <SelectWrap>
                        <select id="new-loc-site" value={newLocSiteId} onChange={(e) => setNewLocSiteId(e.target.value)}
                          className={selectClass}>
                          <option value={NEW_SITE_VALUE}>+ 새 현장 만들기</option>
                          {sitesList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </SelectWrap>
                    </FormField>
                    {newLocSiteId === NEW_SITE_VALUE && (
                      <FormField label="새 현장명" htmlFor="new-site-name">
                        <input id="new-site-name" value={newSiteName} onChange={(e) => setNewSiteName(e.target.value)}
                          className={inputClass} />
                      </FormField>
                    )}
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
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
                    {newLocError && <p className="text-xs leading-4 text-cs-error">{newLocError}</p>}
                    {/* 뷰당 primary 1개(제출 버튼) - '저장'은 normal, '취소'는 링크형 */}
                    <div className="flex items-center gap-2">
                      <Button onClick={handleCreateLocation} disabled={creatingLoc}>
                        {creatingLoc ? '저장 중...' : '저장'}
                      </Button>
                      <button type="button" onClick={() => setShowNewLocation(false)} className={linkButtonClass}>
                        취소
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {mode === 'scan' && (
                <div className="flex flex-col gap-1">
                  {/* 라디오 묶음 제목: FormField는 단일 컨트롤용 <label htmlFor>라 묶음에는 span 700을 쓴다 */}
                  <span className="text-sm font-bold">표면 유형</span>
                  <div className="flex items-center gap-6">
                    {(['floor', 'wall'] as const).map((s) => (
                      <label key={s} className="inline-flex items-center gap-2 text-sm">
                        <input type="radio" className={checkClass} checked={surface === s} onChange={() => setSurface(s)} />
                        {SURFACE_LABEL[s]}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {mode === 'scan' && (
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-bold">데이터 계보</span>
                  <div className="flex items-center gap-6">
                    {(['raw', 'fused_mesh', 'unknown'] as const).map((l) => (
                      <label key={l} className="inline-flex items-center gap-2 text-sm">
                        <input type="radio" className={checkClass} checked={lineage === l} onChange={() => setLineage(l)} />
                        {LINEAGE_LABEL[l]}
                      </label>
                    ))}
                  </div>
                  {lineage === 'fused_mesh' && (
                    <Alert type="warning">
                      융합 메시는 앱이 스무딩한 데이터라 실제보다 양호하게 나올 수 있습니다. 분석 결과와 보고서에 경고가 표시됩니다.
                    </Alert>
                  )}
                </div>
              )}
            </div>

            {/* 우열: 적용 기준 · 측정일자/장비 · 담당자 · 파일 */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-bold">적용 기준</span>
                <div className="flex flex-col gap-2 rounded-lg border border-cs-divider bg-white p-3">
                  {criteria.length === 0 && <p className="text-sm text-cs-text-secondary">측정위치를 먼저 선택하세요.</p>}
                  {criteria.map((c) => (
                    <label key={c.id} className="flex items-start gap-2">
                      <input type="radio" className={`${checkClass} mt-0.5`} checked={criteriaId === c.id} onChange={() => setCriteriaId(c.id)} />
                      <span className="flex min-w-0 flex-col">
                        <span className="inline-flex flex-wrap items-baseline gap-1.5">
                          {/* 기준 코드는 ID 성격이라 mono(아트보드 13px) */}
                          <span className="font-mono text-[13px]">{c.name}</span>
                          {c.is_default && <em className="text-xs not-italic text-cs-text-secondary">(기본)</em>}
                          {c.site_id && <em className="text-xs not-italic text-cs-text-secondary">(현장 기준)</em>}
                        </span>
                        <span className="text-xs leading-4 text-cs-text-secondary">{c.source_text}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex items-start gap-4">
                {/* 아트보드: 측정일자 180px 고정, 장비 flex 1 */}
                <div className="w-[180px] shrink-0">
                  <FormField label="측정일자" htmlFor="scanned-at">
                    <input id="scanned-at" type="date" required value={scannedAt}
                      onChange={(e) => setScannedAt(e.target.value)}
                      className={`${inputClass} font-mono`} />
                  </FormField>
                </div>
                <div className="min-w-0 flex-1">
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
                <input id="file" type="file" required onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className={fileInputClass} />
                {/* 용량 안내는 아트보드처럼 컨트롤 아래(FormField description은 컨트롤 위라 쓰지 않는다) */}
                <p className="text-xs leading-4 text-cs-text-secondary">
                  파일은 Supabase Storage에 저장됩니다. 파일당 최대 <span className="font-mono">{MAX_UPLOAD_MB}</span>MB입니다.
                </p>
              </FormField>
            </div>

          </div>
        </div>
      </Container>
      {error && <Alert type="error">{error}</Alert>}
      {/* 컨테이너 아래 우측 정렬 - 이 뷰의 유일한 primary */}
      <div className="flex items-center justify-end gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          <Icon name="upload" />
          {busy ? '업로드 중...' : mode === 'import' ? '가져오기 시작' : '업로드 후 사전 검사'}
        </Button>
      </div>
    </form>
  );
}
