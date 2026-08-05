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
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { plainPngUrl } from '@/lib/domain/height-view';
import type { HeightViewMeta } from '@/lib/domain/height-view';
import { imageCornersM, overlayAffine, overlayView } from '@/lib/domain/registration';

const MAX_W = 560;
const MAX_H = 420;

export function RegistrationOverlay({
  pathA, pathB, metaA, metaB, unitScaleA, unitScaleB, transform,
}: {
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
  const [opacity, setOpacity] = useState(0.55);
  const [failed, setFailed] = useState(false);

  const view = useMemo(() => {
    if (!metaA || !metaB) return null;
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
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [view, metaA, metaB, pathA, pathB, unitScaleA, unitScaleB, transform, opacity]);

  return (
    <div className="space-y-2">
      {failed && (
        <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-slate-700">
          겹쳐보기 그림을 불러오지 못했습니다. 두 스캔의 높이 뷰 산출물을 확인하세요.
          그림 없이 RMSE만으로 승인하지 마세요.
        </p>
      )}
      <canvas ref={canvasRef} className="max-w-full rounded border bg-white" />
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <span className="whitespace-nowrap">맞춘 스캔(B) 진하기</span>
        <input type="range" min={0} max={100} value={Math.round(opacity * 100)}
          onChange={(e) => setOpacity(Number(e.target.value) / 100)}
          className="w-40" />
        <span className="tabular-nums">{Math.round(opacity * 100)}%</span>
      </label>
      <p className="text-xs text-slate-500">
        슬라이더를 좌우로 움직이며 두 그림의 벽·기둥·모서리 같은 특징이 같은 자리에
        오는지 보세요. 겹쳐지지 않고 나란히 밀려 있으면 수평으로 어긋난 정합입니다.
      </p>
    </div>
  );
}
