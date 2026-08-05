// 정합 작업대 (단계 F Task 5, 스펙 §6.2·§7.4)
//
// 두 스캔의 무장식 높이 뷰를 나란히 놓고 번갈아 클릭해 대응점 쌍을 만든다.
// 3쌍 이상이면 정합을 실행하고, 결과를 겹쳐보기와 함께 보여준다.
//
// ★ 진행 상태는 반드시 registrations에서 읽는다(설계 결정 F10). jobs 테이블은
//   RLS 정책이 0개라 대시보드가 못 읽는다 - 사유(error_text)도 여기에만 있다.
//
// ★ 판정 이중화 아님: 성공 임계(RMSE 2mm)도 중첩 하한(10%)도 이 파일에 없다.
//   그 판단은 엔진이 하고 화면은 결과와 error_text를 그대로 옮긴다.
'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { fetchHeightViewMeta, worldToPixel } from '@/lib/domain/height-view';
import type { HeightViewMeta } from '@/lib/domain/height-view';
import { enqueueJob } from '@/lib/domain/jobs';
import { REGISTRATION_STATUS_LABEL } from '@/lib/domain/labels';
import {
  HORIZONTAL_SENSITIVITY_MIN, MIN_CORRESPONDENCES, horizontalCheck, toCorrespondences,
  trueOverlapPct,
} from '@/lib/domain/registration';
import type { PointPair } from '@/lib/domain/registration';
import { useRowStatus } from '@/lib/hooks/use-row-status';
import type { RegistrationRow, RegistrationStatus, ScanRow } from '@/lib/domain/types';
import { PointPicker } from './point-picker';
import type { PickMarker, PickedPixel } from './point-picker';
import { RegistrationOverlay } from './overlay-view';

function scanLabel(s: ScanRow): string {
  return `${s.original_filename ?? '(파일명 없음)'} · ${s.scanned_at}`;
}

/** 저장된 대응점(월드 좌표)을 다시 픽셀 마커로 되돌린다. */
function markersFor(
  meta: HeightViewMeta | null, pairs: PointPair[], side: 'a' | 'b', pending: PickedPixel | null,
): PickMarker[] {
  if (!meta) return [];
  const out: PickMarker[] = pairs.map((p, i) => ({
    ...worldToPixel(meta, p[side].x, p[side].y), label: String(i + 1),
  }));
  if (pending) out.push({ px: pending.px, py: pending.py, label: String(pairs.length + 1), pending: true });
  return out;
}

export function RegistrationWorkbench({ registration, scanA, scanB }: {
  registration: RegistrationRow;
  scanA: ScanRow;
  scanB: ScanRow;
}) {
  const router = useRouter();
  const [metaA, setMetaA] = useState<HeightViewMeta | null>(null);
  const [metaB, setMetaB] = useState<HeightViewMeta | null>(null);
  const [metaErrA, setMetaErrA] = useState<string | null>(null);
  const [metaErrB, setMetaErrB] = useState<string | null>(null);
  // 실패한 정합을 다시 시도할 때 직전 대응점을 되살린다(처음부터 다시 찍게 하지 않는다).
  const [pairs, setPairs] = useState<PointPair[]>(
    () => registration.correspondences.map((c) => ({ a: { ...c.a }, b: { ...c.b } })),
  );
  const [pendingA, setPendingA] = useState<PickedPixel | null>(null);
  const [pendingB, setPendingB] = useState<PickedPixel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedVisually, setConfirmedVisually] = useState(false);
  const [askRepick, setAskRepick] = useState(false);

  const pathA = scanA.height_view_path;
  const pathB = scanB.height_view_path;
  const ready = !!pathA && !!pathB;

  // 진행 상태는 registrations에서 읽는다(설계 결정 F10). 서버가 준 값이 초기값이고,
  // 상태가 바뀌면 서버 데이터(결과 수치·result_scan_id)를 다시 받아 온다.
  const liveStatus = useRowStatus<RegistrationStatus>(
    'registrations', registration.id, registration.status);
  useEffect(() => {
    if (liveStatus !== registration.status) router.refresh();
  }, [liveStatus, registration.status, router]);

  useEffect(() => {
    if (!pathA) return;
    let cancelled = false;
    fetchHeightViewMeta(pathA)
      .then((m) => { if (!cancelled) setMetaA(m); })
      .catch((e: Error) => { if (!cancelled) setMetaErrA(e.message); });
    return () => { cancelled = true; };
  }, [pathA]);

  useEffect(() => {
    if (!pathB) return;
    let cancelled = false;
    fetchHeightViewMeta(pathB)
      .then((m) => { if (!cancelled) setMetaB(m); })
      .catch((e: Error) => { if (!cancelled) setMetaErrB(e.message); });
    return () => { cancelled = true; };
  }, [pathB]);

  const markersA = useMemo(() => markersFor(metaA, pairs, 'a', pendingA), [metaA, pairs, pendingA]);
  const markersB = useMemo(() => markersFor(metaB, pairs, 'b', pendingB), [metaB, pairs, pendingB]);

  if (!ready) {
    return (
      <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">
        <p className="font-medium">정합을 시작할 수 없습니다.</p>
        <p className="mt-1 text-xs text-slate-700">
          두 스캔 모두 높이 뷰가 있어야 대응점을 찍을 수 있습니다. 높이 뷰가 없는 스캔은
          {' '}{!pathA ? scanLabel(scanA) : scanLabel(scanB)}입니다. 사전 검사를 돌지 않았거나
          산출물 생성이 실패한 스캔이므로, 스캔 상세에서 상태를 확인하고 필요하면 다시
          업로드하세요.
        </p>
      </div>
    );
  }

  function onPickA(p: PickedPixel) {
    if (pendingB) {
      setPairs([...pairs, { a: p, b: pendingB }]);
      setPendingB(null);
    } else {
      setPendingA(p);
    }
  }

  function onPickB(p: PickedPixel) {
    if (pendingA) {
      setPairs([...pairs, { a: pendingA, b: p }]);
      setPendingA(null);
    } else {
      setPendingB(p);
    }
  }

  function removePair(i: number) {
    setPairs(pairs.filter((_, k) => k !== i));
  }

  async function runRegistration() {
    setBusy(true);
    setError(null);
    let rows;
    try {
      rows = toCorrespondences(pairs);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      return;
    }
    const supabase = createClient();
    const { error: upErr } = await supabase.from('registrations')
      .update({ correspondences: rows, status: 'queued', error_text: null })
      .eq('id', registration.id);
    if (upErr) {
      setError(`대응점을 저장하지 못했습니다: ${upErr.message}`);
      setBusy(false);
      return;
    }
    const r = await enqueueJob(supabase, 'register', { registration_id: registration.id });
    if (!r.ok) {
      // 엔큐가 실패했으면 상태를 되돌린다(unit-confirm-form.tsx와 같은 관례). 그대로 두면
      // 잡이 없는데 화면만 '정합 대기 중'에 영구히 남아 재시도할 방법이 사라진다.
      await supabase.from('registrations')
        .update({ status: 'awaiting_points' }).eq('id', registration.id);
      setError(r.message);
      setBusy(false);
      return;
    }
    router.refresh();
    setBusy(false);
  }

  /** 결과를 버리고 대응점부터 다시 찍는다. 병합 스캔이 이미 만들어졌다면 지운다 -
   *  그대로 두면 아무도 쓰지 않을 스캔이 목록에 남는다. */
  async function repick() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    if (registration.result_scan_id) {
      const { error: delErr } = await supabase.from('scans')
        .update({ deleted_at: new Date().toISOString() }).eq('id', registration.result_scan_id);
      if (delErr) {
        setError(`이전 병합 스캔을 정리하지 못했습니다: ${delErr.message}`);
        setBusy(false);
        return;
      }
    }
    const { error: upErr } = await supabase.from('registrations').update({
      status: 'awaiting_points', result_scan_id: null, transform: null,
      rmse_mm: null, iterations: null, overlap_ratio: null, error_text: null,
    }).eq('id', registration.id);
    if (upErr) setError(`상태를 되돌리지 못했습니다: ${upErr.message}`);
    setAskRepick(false);
    setConfirmedVisually(false);
    router.refresh();
    setBusy(false);
  }

  // ---- 진행 중 ----------------------------------------------------------
  if (liveStatus === 'queued' || liveStatus === 'processing') {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-600">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-600" />
        {REGISTRATION_STATUS_LABEL[liveStatus]}... 워커가 두 점군을 읽어 정합하는 중입니다.
        점 수에 따라 수십 초에서 수 분 걸릴 수 있고, 이 화면은 자동 갱신됩니다.
      </p>
    );
  }

  // ---- 실패 ------------------------------------------------------------
  if (liveStatus === 'failed') {
    return (
      <div className="space-y-3">
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm">
          <p className="font-medium text-red-700">정합에 실패했습니다.</p>
          <p className="mt-1 text-slate-700">
            {registration.error_text ?? '사유가 기록되지 않았습니다. 잠시 후 다시 시도하세요.'}
          </p>
        </div>
        <button type="button" onClick={repick} disabled={busy}
          className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50">
          대응점 다시 찍기
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  // ---- 완료 ------------------------------------------------------------
  if (liveStatus === 'done') {
    const overlap = trueOverlapPct(registration.overlap_ratio);
    const horizontal = horizontalCheck(registration.horizontal_sensitivity);
    const sensitivityText = registration.horizontal_sensitivity?.toFixed(3) ?? '-';
    // 겹쳐보기를 그릴 수 없는 사유(리뷰 C1). RegistrationOverlay도 같은 사유를 자기
    // 자리에 띄우지만, 체크박스를 잠그는 판단은 여기서 해야 한다 - 그 컴포넌트는
    // 체크박스를 모른다.
    const overlayBlocked = (!metaA || !metaB)
      ? `높이 뷰 좌표 정보(사이드카)를 불러오지 못했습니다: ${metaErrA ?? metaErrB ?? '원인 불명'}`
      : !registration.transform
        ? '정합 변환이 저장되지 않아 두 스캔을 겹쳐 그릴 수 없습니다.'
        : null;
    return (
      <div className="space-y-4">
        <section className="space-y-2">
          <h2 className="font-semibold">정합 결과</h2>
          <dl className="grid max-w-md grid-cols-2 gap-x-4 gap-y-1 rounded border bg-white p-4 text-sm">
            <dt className="text-slate-500">정합 잔차 RMSE</dt>
            <dd>{registration.rmse_mm === null ? '-' : `${registration.rmse_mm.toFixed(2)} mm`}</dd>
            <dt className="text-slate-500">ICP 반복</dt>
            <dd>{registration.iterations ?? '-'}</dd>
            {/* ★ overlap_ratio 원값을 그대로 쓰지 않는다(스펙 §9.3.4). trimmed ICP가
                항상 하위 80%만 쓰므로 100% 겹쳐도 원값은 0.8이 최대다 - 그대로
                보여주면 "80%밖에 안 겹쳤네"로 오해한다. */}
            <dt className="text-slate-500">겹친 영역(추정)</dt>
            <dd>{overlap === null ? '-' : `${overlap.toFixed(0)}%`}</dd>
          </dl>
          {/* ★ RMSE 하나만 크게 띄우지 않는다(스펙 §9.3.2 남는 위험). 리뷰 I4·I5:
              두 지표가 **서로 다른 축**을 본다는 사실을 먼저 말한다 - 그러지 않으면
              겹쳐보기가 RMSE의 상위 심급처럼 읽힌다. */}
          <p className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-slate-700">
            이 수치는 수직 방향 일치만 보증합니다. 평탄한 바닥에서는 두 스캔이 수평으로 수
            미터 어긋나 있어도 이 값이 1mm 근처로 나옵니다(설계 검증에서 실측한 사실입니다).
            RMSE는 수직, 아래 겹쳐보기는 수평 - 두 확인은 서로 다른 축을 보며 어느 한쪽이
            다른 쪽을 대신하지 못합니다. 이 숫자만 보고 승인하지 마세요.
          </p>
          {/* ★ 엔진 감도 프로브(HORIZONTAL_SENSITIVITY_MIN). 세 게이트(수렴·중첩·RMSE)가
              전부 침묵하는 사각에서 유일하게 신호를 내는 값이다 - 실측: 완전 평면 대응점
              통째 3m 오클릭에서 면내 3.000m / RMSE 1.008mm / converged=True / 사유 없음인데
              감도 0.994.

              ★★ 이것을 "이상 경고"로 쓰면 안 된다(재리뷰 정정). 바닥이 평탄할수록 값이
              낮아지고(±12mm 1.710 / ±6mm 1.218 / ±3.5mm 1.084 / ±2.5mm 1.038, 교차점
              약 ±4.5mm), 스펙이 정의한 이 용역의 대상이 ±5mm 평탄 바닥이라 **스펙을
              만족하는 좋은 바닥일수록 'weak'가 나온다.** 거의 항상 뜨는 안내를 빨간
              경고로 만들면 늑대소년이 되어 사용자가 곧 무시한다. 그래서 "오류·이상·실패"
              라는 말을 쓰지 않고 정보로 제시하며, 전달할 것은 **왜**와 **그래서 뭘
              해야 하나** 둘뿐이다. 값이 없으면(구 데이터·012 미적용 DB) 아무것도 안 띄운다. */}
          {horizontal === 'weak' && (
            <div className="rounded border border-slate-300 bg-slate-50 p-3 text-xs text-slate-700">
              <p className="font-medium">
                수평 검증 가능성: 낮음 (수평 감도 {sensitivityText}, 기준 {HORIZONTAL_SENSITIVITY_MIN})
              </p>
              <p className="mt-1">
                바닥이 평탄할수록 이 값은 낮게 나옵니다. 평탄한 면은 자기 위로 밀어도 모양이
                같아서, 두 스캔의 수평 위치를 데이터만으로 판별할 정보가 원래 없기 때문입니다.
                이 용역의 대상인 ±5mm 평탄 바닥에서는 낮게 나오는 것이 정상이고 흔합니다.
              </p>
              <p className="mt-1">
                같은 이유로 아래 겹쳐보기도 이 바닥에서는 신호가 약합니다. 즉 수치로도
                그림으로도 수평 방향을 확실히 보장할 수는 없습니다. 대응점을 서로 멀리
                떨어뜨려 넓게 분산해 찍은 것이 이 방향의 유일한 보장이므로, 찍은 자리가 두
                스캔에서 정말 같은 지점이었는지 되짚어 보세요. 확신이 없으면 대응점을 다시
                찍되 더 넓게 흩어 고르세요.
              </p>
            </div>
          )}
          {horizontal === 'ok' && (
            <p className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
              수평 검증 가능성: 있음 (수평 감도 {sensitivityText}, 기준 {HORIZONTAL_SENSITIVITY_MIN}).
              이 장면에는 수평 위치를 구속하는 특징(벽·기둥·요철)이 있어, 수평으로 어긋나면
              위 RMSE도 함께 올라갑니다. 그래도 아래 겹쳐보기로 한 번 더 확인하세요.
            </p>
          )}
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold">겹쳐보기 (정합 결과 육안 확인)</h2>
          <RegistrationOverlay pathA={pathA} pathB={pathB} metaA={metaA} metaB={metaB}
            unitScaleA={scanA.unit_scale ?? 1} unitScaleB={scanB.unit_scale ?? 1}
            transform={registration.transform} />
        </section>
        <section className="space-y-2">
          {/* ★ 리뷰 C1: 겹쳐보기를 못 그렸으면 "확인했습니다"를 체크할 수 없어야 한다.
              그러지 않으면 사용자가 빈 상자를 보고 체크해 방어가 조용히 0이 된다. */}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirmedVisually && !overlayBlocked} className="mt-1"
              disabled={!!overlayBlocked}
              onChange={(e) => setConfirmedVisually(e.target.checked)} />
            <span className={overlayBlocked ? 'text-slate-400' : undefined}>
              겹쳐보기에서 두 스캔이 실제로 포개지는 것을 확인했습니다.
            </span>
          </label>
          {overlayBlocked && (
            <p className="text-xs text-red-700">
              {overlayBlocked} 겹쳐보기를 볼 수 없는 상태에서는 이 확인을 체크할 수 없습니다.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {confirmedVisually && !overlayBlocked && registration.result_scan_id ? (
              <Link href={`/scans/${registration.result_scan_id}`}
                className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white">
                병합 스캔 열기
              </Link>
            ) : (
              <button type="button" disabled
                className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white opacity-50">
                병합 스캔 열기
              </button>
            )}
            {askRepick ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-red-700">
                  이 정합으로 만들어진 병합 스캔이 삭제됩니다. 계속할까요?
                </span>
                <button type="button" onClick={repick} disabled={busy}
                  className="rounded bg-red-700 px-3 py-1.5 text-sm text-white disabled:opacity-50">
                  삭제하고 다시 찍기
                </button>
                <button type="button" onClick={() => setAskRepick(false)}
                  className="rounded border px-3 py-1.5 text-sm">
                  취소
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setAskRepick(true)}
                className="rounded border px-3 py-1.5 text-sm">
                대응점 다시 찍기
              </button>
            )}
          </div>
          {/* ★ 리뷰 I1: 이 체크는 승인 게이트가 아니라 권고다. 정직하게 밝힌다 -
              "체크해야만 쓸 수 있다"고 읽히면, 다른 경로로 들어온 사용자가 검증을
              건너뛰었다는 사실 자체가 감춰진다. */}
          <p className="text-xs text-slate-500">
            병합 스캔은 정합이 성공한 시점에 이미 만들어져 있습니다(데이터 계보 &quot;정합 병합&quot;).
            위 확인은 이 화면의 안내 장치일 뿐 시스템 차원의 승인 절차가 아닙니다.
            체크하지 않아도 병합 스캔은 측정위치 목록과 스캔 상세에 이미 나타나 있고
            거기서 바로 분석할 수 있습니다. 그러니 이 정합을 쓰지 않기로 했다면
            아래 &quot;대응점 다시 찍기&quot;로 병합 스캔을 정리하세요.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </section>
      </div>
    );
  }

  // ---- 대응점 지정 ------------------------------------------------------
  const metaLoading = (!metaA && !metaErrA) || (!metaB && !metaErrB);
  const canRun = pairs.length >= MIN_CORRESPONDENCES && !busy && !!metaA && !!metaB;

  return (
    <div className="space-y-4">
      <p className="rounded bg-slate-100 p-3 text-sm">
        두 그림에서 <span className="font-medium">같은 지점</span>을 번갈아 클릭해 쌍을 만드세요.
        최소 {MIN_CORRESPONDENCES}쌍이 필요하고 4쌍 이상을 권장합니다. 쌍은 서로 1m 넘게
        떨어뜨리고 한 직선 위에 놓이지 않게 넓게 흩어 고르세요. 한곳에 몰리거나 일직선이면
        정합이 거부됩니다. 색이 없는(비어 있는) 칸은 높이 값이 없어 쓸 수 없습니다.
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <PointPicker title={`A 스캔 (기준) · ${scanLabel(scanA)}`} heightViewPath={pathA}
          meta={metaA} metaError={metaErrA} markers={markersA} onPick={onPickA} disabled={busy} />
        <PointPicker title={`B 스캔 (맞출 대상) · ${scanLabel(scanB)}`} heightViewPath={pathB}
          meta={metaB} metaError={metaErrB} markers={markersB} onPick={onPickB} disabled={busy} />
      </div>
      <section className="space-y-2">
        <h2 className="font-semibold">대응점 {pairs.length}쌍</h2>
        {pairs.length === 0 ? (
          <p className="text-sm text-slate-500">아직 찍은 쌍이 없습니다.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {pairs.map((p, i) => (
              <li key={i}
                className="flex items-center gap-2 rounded border bg-white px-2 py-1">
                <span className="font-medium">{i + 1}</span>
                <span className="tabular-nums text-slate-600">
                  A({p.a.x.toFixed(2)}, {p.a.y.toFixed(2)}, {p.a.z?.toFixed(2)})
                  {' / '}
                  B({p.b.x.toFixed(2)}, {p.b.y.toFixed(2)}, {p.b.z?.toFixed(2)})
                </span>
                <button type="button" onClick={() => removePair(i)}
                  className="ml-auto text-red-700 hover:underline">지우기</button>
              </li>
            ))}
          </ul>
        )}
        {(pendingA || pendingB) && (
          <p className="text-xs text-amber-700">
            {pendingA ? 'A' : 'B'} 쪽 점을 찍었습니다. 반대쪽 그림에서 같은 지점을 클릭하면
            한 쌍이 완성됩니다.
          </p>
        )}
        <p className="text-xs text-slate-500">
          좌표는 각 스캔 파일의 단위 그대로입니다(미터로 환산하지 않습니다).
        </p>
      </section>
      {metaLoading ? (
        <p className="text-sm text-slate-600">높이 뷰 좌표 정보를 불러오는 중입니다...</p>
      ) : (
        <button type="button" onClick={runRegistration} disabled={!canRun}
          className="rounded bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-50">
          정합 실행
        </button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
