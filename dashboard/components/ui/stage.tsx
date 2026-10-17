// 검정 스테이지(스펙 §6): 3D·히트맵·구배·편차맵·높이 그림·PDF 미리보기가 놓이는 검정 상자.
// 바탕 stage + line-2 테두리 + 12px + overflow hidden. 도면 격자는 깔지 않는다(스펙 §3).
// 최소 높이 320px(스펙 §7 휴대폰 규칙). 히트맵·편차맵 아트보드(ScanDone·ScanDeviation)는 440px 이다.
// toolbar 를 주면 아래에 surface 도구 줄을 붙이고 스테이지는 위 모서리만 둥글린다
// (아트보드 Stage 의 시점·과장 도구 줄, ScanDone 의 설명 줄, ScanSlope 의 범례 줄).
import type { ReactNode } from 'react';

const ASPECT = { '2/1': 'aspect-[2/1]', '4/3': 'aspect-[4/3]', auto: '' } as const;
const MIN_H = { 320: 'min-h-80', 440: 'min-h-[440px]' } as const;

export function Stage({ children, className, aspect = 'auto', minHeight = 320, toolbar }: {
  children: ReactNode; className?: string; aspect?: keyof typeof ASPECT;
  minHeight?: keyof typeof MIN_H; toolbar?: ReactNode;
}) {
  const box = [
    'relative w-full overflow-hidden border border-line-2 bg-stage',
    toolbar ? 'rounded-t-card' : 'rounded-card',
    ASPECT[aspect], MIN_H[minHeight], className ?? '',
  ].filter(Boolean).join(' ');
  const stage = <div data-stage="" className={box}>{children}</div>;
  if (!toolbar) return stage;
  return (
    <div className="flex flex-col">
      {stage}
      <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 rounded-b-card border border-t-0 border-line-2 bg-surface px-[clamp(12px,2vw,18px)] py-2.5">
        {toolbar}
      </div>
    </div>
  );
}
