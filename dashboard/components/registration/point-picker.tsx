// 무장식 높이 뷰 위 대응점 클릭 (단계 F Task 5, 설계 결정 F6/F7, 스펙 §7.4)
//
// ★ 클릭 대상은 **무장식 PNG**다(height_view_plain.png). 화면 다른 곳에서 보는
//   장식 PNG는 matplotlib 제목·여백·컬러바가 붙어 있어 픽셀 -> 월드 역산이
//   불가능하다(engine/flatness/outputs/height_view.py render_height_view_plain
//   독스트링). 무장식 PNG는 격자 1칸 = 이미지 1픽셀이라 환산이 항상 결정적이다.
//
// ★ canvas가 아니라 <img> + 절대배치 마커를 쓴다. 이 컴포넌트가 할 일은 "그림을
//   보여주고 클릭한 픽셀을 알아내는 것"뿐이라 픽셀을 직접 그릴 이유가 없고,
//   canvas였다면 jsdom이 getContext를 지원하지 않아(다른 뷰들이 겪는 사정)
//   클릭 -> 좌표 환산을 테스트에서 관찰하기 어려워진다. 겹쳐보기(overlay-view.tsx)는
//   두 이미지를 변환행렬로 합성해야 하므로 그쪽만 canvas를 쓴다.
//
// 판정 이중화 아님: 여기에는 임계값이 하나도 없다. 좌표 환산은 전량
// lib/domain/height-view.ts(단일 정본)에 있고 이 파일은 그것을 호출만 한다.
//
// 다크 리스킨(Task 9, 아트보드 docs/design/dark/RegistrationDetail.dc.html 대응점 화면): 그림은 검정 스테이지
// (padding 16) 안, 제목 뒤에 mono 파일명·시각(detail), 마커는 ink 채움 22px 원 + 2px 검정 테두리.
'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Stage } from '@/components/ui/stage';
import { imageSize, pixelToWorld, plainPngUrl } from '@/lib/domain/height-view';
import type { HeightViewMeta, PickedPoint } from '@/lib/domain/height-view';

export interface PickMarker {
  px: number;
  py: number;
  label: string;
  /** 짝이 아직 안 맞은(반대쪽을 기다리는) 점. 시각적으로 구분한다. */
  pending?: boolean;
}

export type PickedPixel = PickedPoint & { px: number; py: number };

export function PointPicker({
  title, detail, heightViewPath, meta, metaError, markers, onPick, disabled,
}: {
  title: string;
  /** 제목 뒤에 mono로 붙는 파일명·시각. 대체 텍스트에도 들어간다. 없으면 제목만 쓴다. */
  detail?: string;
  heightViewPath: string;
  meta: HeightViewMeta | null;
  metaError?: string | null;
  markers: PickMarker[];
  onPick: (p: PickedPixel) => void;
  disabled?: boolean;
}) {
  const headingId = useId();
  const imgRef = useRef<HTMLImageElement>(null);
  const [viewFailed, setViewFailed] = useState(false);
  const [cellError, setCellError] = useState<string | null>(null);

  // ★ onError 하나로는 부족하다(단계 E Task 3 실화면 재현): 서버 렌더된 HTML에
  // <img>가 이미 들어 있어 브라우저가 그 요청을 하이드레이션(React가 onError를
  // 붙이는 시점)보다 먼저 끝낸다. 그 사이 지나간 error 이벤트는 영영 사라져
  // 깨진 이미지 아이콘만 남는다. 마운트 직후 최종 상태를 직접 확인한다.
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth === 0) setViewFailed(true);
  }, []);

  const clickable = !disabled && !!meta && !viewFailed;

  function onClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!clickable || !meta) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return; // 레이아웃 전(0 크기)에는 환산이 성립하지 않는다
    const { width: nx, height: ny } = imageSize(meta);
    const clamp = (v: number, max: number) => Math.min(max - 1, Math.max(0, v));
    const px = clamp(Math.floor(((e.clientX - rect.left) / rect.width) * nx), nx);
    const py = clamp(Math.floor(((e.clientY - rect.top) / rect.height) * ny), ny);
    const p = pixelToWorld(meta, px, py);
    if (p.z === null) {
      // 설계 결정 F6: 0으로 대체하거나 이웃에서 끌어오면 대응점이 조용히 틀린다.
      setCellError('그 지점은 높이 값이 없어(점이 성겨 서브셀이 비었습니다) 대응점으로 쓸 수 없습니다. '
        + '색이 칠해진 곳을 고르세요.');
      return;
    }
    setCellError(null);
    onPick({ ...p, px, py });
  }

  const size = meta ? imageSize(meta) : null;
  const fullTitle = detail ? `${title} · ${detail}` : title;

  return (
    // 아트보드: 두 그림이 `flex: 1 1 420px; min-width: 0`으로 나란히, 좁은 폭에서는 쌓인다
    <section aria-labelledby={headingId} className="flex min-w-0 flex-[1_1_420px] flex-col gap-2.5">
      <h3 id={headingId} className="text-[15px] font-semibold [overflow-wrap:anywhere]">
        {title}
        {detail && (
          <>
            {' · '}
            <span className="font-mono text-[13px] font-medium text-ink-2">{detail}</span>
          </>
        )}
      </h3>
      {viewFailed ? (
        <Alert type="warning">
          높이 뷰를 불러오지 못했습니다. 이 스캔의 산출물이 지워졌거나 아직 사전 검사가
          끝나지 않았을 수 있습니다. 스캔 상세에서 상태를 확인하세요.
        </Alert>
      ) : (
        <Stage className="p-4">
          <div className="relative">
            {/* 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요
                (components/unit-confirm-form.tsx와 같은 판단) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={imgRef} src={plainPngUrl(heightViewPath)}
              alt={`${fullTitle} 높이 뷰(무장식) - 클릭해 대응점을 찍습니다`}
              onError={() => setViewFailed(true)}
              onClick={onClick}
              // image-rendering: pixelated - 격자 1칸이 1픽셀이라 확대하면 뭉개진다.
              // 셀 경계가 보여야 사용자가 "어느 칸을 찍는지" 알 수 있다.
              style={{ imageRendering: 'pixelated' }}
              className={`block h-auto w-full ${clickable ? 'cursor-crosshair' : 'cursor-not-allowed opacity-90'}`} />
            {/* 마커: 확정 쌍은 ink 채움, 반대쪽을 기다리는 점은 warn 채움(data-pending). img 바로 다음 span이어야
                한다 - 작업대 테스트가 img.parentElement의 첫 span을 마커로 읽는다. 순번 글자로 뜻을 전하므로
                장식(aria-hidden)이다. */}
            {size && markers.map((m) => (
              <span key={`${m.label}-${m.px}-${m.py}`} aria-hidden="true"
                data-pending={m.pending ? 'true' : undefined}
                style={{
                  left: `${((m.px + 0.5) / size.width) * 100}%`,
                  top: `${((m.py + 0.5) / size.height) * 100}%`,
                }}
                className={`pointer-events-none absolute inline-flex h-[22px] min-w-[22px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-stage px-1.5 font-mono text-[11px] font-medium leading-none text-ground ${m.pending ? 'bg-warn' : 'bg-ink'}`}>
                {m.label}
              </span>
            ))}
          </div>
        </Stage>
      )}
      {metaError && <Alert type="warning">{metaError}</Alert>}
      {cellError && <Alert type="error">{cellError}</Alert>}
    </section>
  );
}
