// 클래스 프리셋. 수치 열은 thNum/tdNum(우측 정렬 + 모노).
export const tableClass = {
  table: 'w-full border-collapse text-sm',
  thead: 'border-b border-zinc-200 text-left text-xs text-zinc-500',
  th: 'px-3 py-2 font-normal',
  thNum: 'px-3 py-2 text-right font-normal',
  td: 'px-3 py-2',
  tdNum: 'px-3 py-2 text-right font-mono tabular-nums',
  row: 'border-b border-zinc-100 hover:bg-zinc-50',
} as const;
