// 표(스펙 §6 DataTable, 아트보드 Reports·ScanDone·Settings):
// - 표 상자(TableBox): surface + line-2 + 12px. 가로로 넘치면 상자 안에서만 스크롤한다(페이지 가로 스크롤 금지).
// - 머리: IBM Plex Mono 11px · 0.08em · dim, 아래 line-2 선. 칸 padding 12px 16px.
// - 행: 14px ink, 칸 padding 14px 16px, 행 사이 line 선(마지막 행은 없음). 숫자 열은 오른쪽 + IBM Plex Mono.
// 글자 크기(14px)는 table 에 두고 칸(td)에는 색·크기를 넣지 않는다 - 소비자가 칸에 덧붙이는
// 글자 색·크기 클래스와 같은 속성끼리 부딪히지 않게 한다(글자 색은 body 의 ink 를 물려받는다).
import type { ReactNode } from 'react';

export const tableClass = {
  table: 'w-full border-collapse text-left text-sm',
  thead: 'text-left',
  // 최종 리뷰 Important 5: 헤더 문구는 줄바꿈하지 않는다('표면 · 버전'이 2줄로 꺾인 사고).
  th: 'whitespace-nowrap border-b border-line-2 px-4 py-3 text-left font-mono text-[11px] font-medium tracking-[0.08em] text-dim',
  thNum: 'whitespace-nowrap border-b border-line-2 px-4 py-3 text-right font-mono text-[11px] font-medium tracking-[0.08em] text-dim',
  td: 'px-4 py-3.5',
  tdNum: 'whitespace-nowrap px-4 py-3.5 text-right font-mono tabular-nums',
  row: 'border-b border-line last:border-b-0',
  link: 'font-semibold text-ink underline decoration-line-3 underline-offset-4 hover:decoration-ink',
} as const;

// 표 위 도구 줄(검색·필터·건수)의 배치. TableBox 의 toolbar 로 넘기면 상자 모양까지 붙는다.
export function TableToolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-[clamp(12px,2vw,18px)] py-2.5">{children}</div>;
}

const MIN_W = { 720: 'min-w-[720px]', 960: 'min-w-[960px]' } as const;

/**
 * 표 상자: children 은 <thead>·<tbody> 다(<table> 은 이 컴포넌트가 그린다).
 * minWidth: 안쪽 표의 최소 폭(아트보드 720px 기본, 열이 많은 Settings·ScanSlope 는 960px).
 * toolbar: 주면 상자 위에 붙은 도구 줄 상자를 그린다(아트보드 Reports 의 검색·필터 줄).
 */
export function TableBox({ children, minWidth = 720, toolbar }: {
  children: ReactNode; minWidth?: keyof typeof MIN_W; toolbar?: ReactNode;
}) {
  const box = (
    <div className={`overflow-x-auto border border-line-2 bg-surface ${toolbar ? 'rounded-b-card border-t-0' : 'rounded-card'}`}>
      <table className={`${tableClass.table} ${MIN_W[minWidth]}`}>{children}</table>
    </div>
  );
  if (!toolbar) return box;
  return (
    <div className="flex flex-col">
      <div className="rounded-t-card border border-line-2 bg-surface">
        <TableToolbar>{toolbar}</TableToolbar>
      </div>
      {box}
    </div>
  );
}
