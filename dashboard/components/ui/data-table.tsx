// 테이블 클래스 프리셋(Cloudscape 해부): 헤더 40px 700 상하 구분선, 행 44px, 셀 padding 0 20px,
// 수치 열은 thNum/tdNum(우측 정렬 + mono). 첫 열 링크는 tableClass.link.
import type { ReactNode } from 'react';

export const tableClass = {
  table: 'w-full border-collapse text-sm',
  thead: 'border-y border-cs-divider text-left',
  th: 'h-10 px-5 font-bold',
  thNum: 'h-10 px-5 text-right font-bold',
  td: 'h-11 px-5',
  tdNum: 'h-11 px-5 text-right font-mono tabular-nums',
  row: 'border-b border-cs-divider last:border-b-0',
  link: 'font-bold text-cs-link hover:text-cs-link-hover hover:underline',
} as const;

// 컨테이너 헤더와 테이블 사이의 도구 줄(검색·필터·건수). padded={false} 컨테이너 안에서 쓴다.
export function TableToolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3 px-5 py-3">{children}</div>;
}
