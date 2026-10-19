// 정합 후 두 높이 뷰 겹쳐보기 (단계 F Task 5, 스펙 §9.3.2 "남는 위험")
//
// ★ 이 화면이 존재하는 이유를 정확히 적는다. 정합 결과의 RMSE는 point-to-plane
//   잔차라 변위의 **법선 방향 성분만** 센다. 수평면 위에서 접선 방향으로 밀린
//   어긋남에는 원리적으로 무감각하다 - 스펙 §9.3.2 실측표에서 **완전평면을
//   3m 어긋뜨려도 1.006mm**로 게이트를 통과한다. 이 용역의 대상이 ±5mm 평탄
//   바닥이므로 현장이 바로 그 사각이다. 스펙은 "§7.4 화면은 RMSE만 보여주지 말고
//   정합 후 두 점군을 겹쳐 그린 그림을 함께 제시해야 한다"고 못 박았다.
//
//   두 무장식 PNG를 변환행렬로 겹쳐 그리면 그 어긋남이 눈에 보인다. 불투명도
//   슬라이더로 B를 켰다 껐다 하며 비교하는 것이 표준적인 육안 대조 방법이다.
//
// 다크 테마(Task 9, 아트보드 docs/design/dark/RegistrationDetail.dc.html '겹쳐보기'): 캔버스는 검정
// 스테이지 안에 놓이고, 그림 밑에 스테이지 바탕(STAGE_BG)과 40px 격자(STAGE_GRID)를 먼저 깐다.
// 색은 lib/domain/palette.ts 상수만 쓴다(스펙 §6 캔버스 그림). 그리기 배선(어느 그림·변환·alpha)은 그대로다.
'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Stage } from '@/components/ui/stage';
import { plainPngUrl } from '@/lib/domain/height-view';
import type { HeightViewMeta } from '@/lib/domain/height-view';
import { STAGE_BG, STAGE_GRID } from '@/lib/domain/palette';
import { imageCornersM, overlayAffine, overlayView } from '@/lib/domain/registration';

const MAX_W = 560;
const MAX_H = 420;
/** 격자 간격(px). 아트보드 겹쳐보기 SVG(560x420)의 40단위 격자와 같다. */
const GRID_STEP = 40;

/** 캔버스 전체를 스테이지 바탕으로 채우고 GRID_STEP마다 1px 격자선을 긋는다(경로 하나, stroke 한 번). */
function drawStageGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = STAGE_BG;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = STAGE_GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  // +0.5: 1px 선이 두 픽셀에 번지지 않게 픽셀 가운데에 긋는다
  for (let x = GRID_STEP; x < w; x += GRID_STEP) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
  for (let y = GRID_STEP; y < h; y += GRID_STEP) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
  ctx.stroke();
}

export function RegistrationOverlay({
  pathA, pathB, metaA, metaB, unitScaleA, unitScaleB, transform, onLoadFailed,
}: {
  /** 두 그림 중 하나라도 못 불러왔을 때 한 번 부른다 - 작업대가 확인 체크박스를 잠근다(리뷰 C1). */
  onLoadFailed?: () => void;
  pathA: string;
  pathB: string;
  metaA: HeightViewMeta | null;
  metaB: HeightViewMeta | null;
  /** 사이드카 좌표는 파일 단위, 변환은 미터다. 두 스캔의 배율이 다를 수 있다. */
  unitScaleA: number;
  unitScaleB: number;
  /** registrations.transform (4x4, 미터). B를 A에 맞춘다. */
  transform: number[][] | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sliderId = useId();
  const [opacity, setOpacity] = useState(0.55);
  const [failed, setFailed] = useState(false);

  // ★ 리뷰 C1: 그릴 수 없는 이유가 있으면 **빈 캔버스를 내놓지 않는다.** 사이드카가
  //   404면 metaA/metaB가 null이라 아래 useEffect가 조기 return하고, 캔버스는 크기조차
  //   설정되지 않은 채(기본 300x150) 빈 상자로 남는다. 사용자는 "겹쳐보기" 제목 아래
  //   빈 상자를 보고 아무 오류 안내 없이 "포개지는 것을 확인했습니다"를 체크할 수 있다 -
  //   방어가 조용히 0이 된다.
  //   transform이 null인 채 done인 경우는 더 나쁘다: B가 자기 좌표로 그려져 **정합된
  //   것처럼 보인다.**
  const unavailable = !metaA || !metaB
    ? '두 스캔의 높이 뷰 좌표 정보(사이드카)를 불러오지 못해 겹쳐보기를 그릴 수 없습니다.'
    : !transform
      ? '정합 변환이 저장되지 않아 겹쳐보기를 그릴 수 없습니다.'
      : null;

  const view = useMemo(() => {
    if (!metaA || !metaB || !transform) return null;
    return overlayView([
      imageCornersM(metaA, unitScaleA, null),
      imageCornersM(metaB, unitScaleB, transform),
    ], MAX_W, MAX_H);
  }, [metaA, metaB, unitScaleA, unitScaleB, transform]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view || !metaA || !metaB) return;
    canvas.width = view.width;
    canvas.height = view.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom 등 캔버스 미지원 환경 방어(slope-heatmap-view.tsx와 같은 이유)
    let cancelled = false;
    const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error(src));
      im.src = src;
    });
    Promise.all([load(plainPngUrl(pathA)), load(plainPngUrl(pathB))])
      .then(([ia, ib]) => {
        if (cancelled) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // 스테이지 바탕 + 격자를 그림보다 먼저 깐다 - 나중에 그리면 격자가 두 그림을 덮어 대조를 흐린다
        drawStageGrid(ctx, canvas.width, canvas.height);
        // 격자 1칸 = 1픽셀이라 보간을 끈다 - 켜 두면 셀 경계가 뭉개져 어긋남이 흐려진다.
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 1;
        ctx.setTransform(...overlayAffine(metaA, unitScaleA, null, view));
        ctx.drawImage(ia, 0, 0);
        ctx.globalAlpha = opacity;
        ctx.setTransform(...overlayAffine(metaB, unitScaleB, transform, view));
        ctx.drawImage(ib, 0, 0);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        onLoadFailed?.();
      });
    return () => { cancelled = true; };
    // onLoadFailed 는 일부러 뺀다 - 부모가 매 렌더 새 함수를 넘기면 그림을 다시 불러오게 된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, metaA, metaB, pathA, pathB, unitScaleA, unitScaleB, transform, opacity]);

  if (unavailable) {
    return (
      <Alert type="error" title={unavailable}>
        겹쳐보기는 RMSE가 원리적으로 못 보는 수평 방향 어긋남을 확인하는 유일한 수단입니다.
        그림 없이 수치만으로 이 정합을 승인하지 마세요. 스캔 산출물을 복구한 뒤 이 화면을
        새로고침하거나, 대응점을 다시 찍어 정합을 다시 실행하세요.
      </Alert>
    );
  }

  const percent = Math.round(opacity * 100);
  return (
    // 아트보드: 왼쪽 `flex: 1 1 560px; max-width: 640px` 검정 스테이지 / 오른쪽 `flex: 1 1 300px` 설명.
    // flex-wrap이라 좁은 폭(휴대폰)에서는 위아래로 쌓인다(스펙 §7).
    <div className="flex flex-wrap items-start gap-6">
      <div className="flex min-w-0 max-w-[640px] flex-[1_1_560px] flex-col gap-3">
        {failed && (
          <Alert type="error">
            겹쳐보기 그림을 불러오지 못했습니다. 두 스캔의 높이 뷰 산출물을 확인하세요.
            그림 없이 RMSE만으로 승인하지 마세요.
          </Alert>
        )}
        <Stage className="p-4">
          <canvas ref={canvasRef} role="img" aria-label="두 스캔 겹쳐보기"
            className="mx-auto block h-auto max-w-full" />
        </Stage>
      </div>
      <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
          <label htmlFor={sliderId}
            className="whitespace-nowrap font-mono text-[11px] tracking-[0.08em] text-dim">
            맞춘 스캔(B) 진하기
          </label>
          <div className="flex items-center gap-3">
            <input id={sliderId} type="range" min={0} max={100} step={1} value={percent}
              onChange={(e) => setOpacity(Number(e.target.value) / 100)}
              className="m-0 min-h-11 w-[180px] accent-ink" />
            <span className="min-w-11 font-mono text-[13px] tabular-nums">{percent}%</span>
          </div>
        </div>
        <p className="text-[13px] leading-relaxed text-muted">
          슬라이더를 좌우로 움직이며 두 그림의 벽·기둥·모서리 같은 특징이 같은 자리에
          오는지 보세요. 겹쳐지지 않고 나란히 밀려 있으면 수평으로 어긋난 정합입니다.
        </p>
        {/* ★ 리뷰 I4·I5: 이 그림을 최종 심급으로 읽으면 안 된다. 겹친 영역 무늬의 상관을
            실측하면 미터급은 확실히 드러나지만(정합 +0.896 대 3m +0.129) 30cm급은 정합과
            거의 구별되지 않고(+0.840), 특징이 없는 완전 평면에서는 신호 자체가 0이다
            (+0.014 대 +0.043). 한계를 밝히지 않으면 "겹쳐 봤으니 괜찮다"가 근거 없는
            안심이 된다.
            ★ 위쪽 "수평 검증 가능성" 안내와 **같은 현상의 두 얼굴**이다 - 감도가 낮게
            나오는 평탄한 바닥이 정확히 이 그림도 안 통하는 바닥이다. 두 안내가 같은
            이야기를 하도록 문구를 맞춰 둔다.
            안내(info) 상자다. 경고(warning)가 아니다 - 늑대소년 방지. */}
        <Alert type="info">
          겹쳐보기의 한계: 미터급 어긋남은 확실히 드러나지만 수십 cm급은 정합된 것과
          구별하기 어렵습니다(실측 30cm 오정합의 무늬 상관 0.840 대 정합 0.896).
          평탄해서 벽·기둥·요철 같은 특징이 없는 바닥일수록 그렇습니다 - 수평 감도가 낮게
          나오는 바닥이 정확히 이 경우입니다. 이 방향의 보장은 결국 대응점을 넓게 분산해
          찍었는가에 달려 있습니다.
        </Alert>
      </div>
    </div>
  );
}
