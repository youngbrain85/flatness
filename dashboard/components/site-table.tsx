'use client';
// 홈 현장 테이블 + 도구 줄(클라이언트 섬 - 스펙 §7-3): 서버가 이미 조회한 rows를 검색 입력과 판정
// 필터로 걸러 보여준다. 서버 조회·URL은 건드리지 않는다. 아트보드의 페이지네이션(‹ 1 ›)은 현재
// 데이터 규모에서 YAGNI - 우측에 건수 텍스트('총 n곳')만 둔다. 마크업·수치: docs/design/cloudscape/Main.dc.html
import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/ui/icons';
import { inputClass, selectClass, SelectWrap } from '@/components/ui/form';
import { tableClass, TableToolbar } from '@/components/ui/data-table';
import { VerdictBar, type VerdictCounts } from '@/components/ui/verdict-bar';
import { StatusIndicator, type StatusType } from '@/components/ui/status-indicator';

// 서버(app/page.tsx)가 SiteSummary를 접어 넘기는 행. 클라이언트 경계를 넘으므로 직렬화 가능한
// 평면 객체만 둔다(Next 가이드 server-and-client-components "serializable").
export type SiteTableRow = {
  id: string;
  name: string;
  locationCount: number;
  scanCount: number;
  lastScannedAt: string | null;
  // 4단계 판정을 3버킷(적합/주의/재시공)으로 접은 값 - 접는 규칙은 app/page.tsx의 toBarCounts
  counts: VerdictCounts;
  // 판정 불가(done인데 overall_verdict null) 건수
  na: number;
  // 처리 중(queued·processing) 분석 건수
  inProgress: number;
};

// 판정 필터 선택지 - 값은 행의 어느 수치를 보는지, 라벨은 화면 문구.
export type VerdictFilter = 'all' | 'fail' | 'warn' | 'na' | 'busy';
const FILTERS: { value: VerdictFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'fail', label: '재시공 있음' },
  { value: 'warn', label: '주의 있음' },
  { value: 'na', label: '판정 불가 있음' },
  { value: 'busy', label: '처리 중' },
];

function matchesFilter(row: SiteTableRow, f: VerdictFilter): boolean {
  switch (f) {
    case 'fail': return row.counts.fail > 0;
    case 'warn': return row.counts.warn > 0;
    case 'na': return row.na > 0;
    case 'busy': return row.inProgress > 0;
    default: return true;
  }
}

// 상태 열: 처리 중 > 판정 불가 > 완료 > 분석 없음 순으로 하나만 보인다. 처리 중이 있으면 그 사실이
// 먼저다(판정 불가 건수는 개요 범례와 '판정 불가 있음' 필터로 여전히 닿는다).
// "판정 불가"는 스펙 §3의 cs-na 색이므로 pending(minus-circle)이다(아트보드의 warning 삼각형은 채택하지 않는다).
export function siteStatus(row: Pick<SiteTableRow, 'counts' | 'na' | 'inProgress'>): { type: StatusType; label: string } {
  if (row.inProgress > 0) return { type: 'in-progress', label: `처리 중 ${row.inProgress}건` };
  if (row.na > 0) return { type: 'pending', label: `판정 불가 ${row.na}건` };
  if (row.counts.pass + row.counts.warn + row.counts.fail > 0) return { type: 'success', label: '완료' };
  return { type: 'pending', label: '분석 없음' };
}

export function SiteTable({ rows }: { rows: SiteTableRow[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<VerdictFilter>('all');
  // 현장명 includes(앞뒤 공백 제거, 대소문자 무시 - 'a1'로 'A1블록'을 찾는다). 검색과 필터는 AND.
  const q = query.trim().toLowerCase();
  const visible = rows.filter((r) => (q === '' || r.name.toLowerCase().includes(q)) && matchesFilter(r, filter));

  return (
    <>
      <TableToolbar>
        {/* 아트보드: 360px, 2px cs-input-border, 좌측 search 아이콘. inputClass의 px-2는 pl-8이 덮는다
            (Tailwind는 단축 속성 px를 개별 속성 pl보다 앞에 내보내므로 뒤의 pl-8이 이긴다). */}
        <div className="relative w-[360px] max-w-full">
          <Icon name="search" className="pointer-events-none absolute left-2 top-2 text-cs-text-secondary" />
          <input type="text" aria-label="현장 검색" placeholder="현장 검색" value={query}
            onChange={(e) => setQuery(e.target.value)} className={`${inputClass} pl-8`} />
        </div>
        <SelectWrap className="w-44">
          <select aria-label="판정 필터" value={filter} className={selectClass}
            onChange={(e) => setFilter(e.target.value as VerdictFilter)}>
            {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </SelectWrap>
        {/* 필터 결과 건수 - 컨테이너 헤더의 (n)은 전체 현장 수, 여기는 지금 보이는 행 수 */}
        <span className="ml-auto text-sm text-cs-text-secondary tabular-nums">{`총 ${visible.length}곳`}</span>
      </TableToolbar>
      {/* 375px에서 6열이 본문을 넘치므로 테이블만 가로 스크롤(스펙 §9-4: 페이지는 세로 스택 유지) */}
      <div className="overflow-x-auto">
        <table className={tableClass.table}>
          <thead className={tableClass.thead}>
            <tr>
              <th className={tableClass.th}>현장명</th>
              <th className={tableClass.thNum}>측정위치</th>
              <th className={tableClass.thNum}>스캔</th>
              <th className={tableClass.th}>최근 측정일</th>
              <th className={tableClass.th}>판정 분포 <span className="font-normal text-cs-text-secondary">적합 · 주의 · 재시공</span></th>
              <th className={tableClass.th}>상태</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className={`${tableClass.td} text-center text-cs-text-secondary`}>조건에 맞는 현장이 없습니다</td>
              </tr>
            ) : visible.map((r) => {
              const status = siteStatus(r);
              const total = r.counts.pass + r.counts.warn + r.counts.fail;
              return (
                <tr key={r.id} className={tableClass.row}>
                  <td className={tableClass.td}>
                    <Link href={`/sites/${r.id}`} className={tableClass.link}>{r.name}</Link>
                  </td>
                  <td className={tableClass.tdNum}>{r.locationCount}</td>
                  <td className={tableClass.tdNum}>{r.scanCount}</td>
                  {/* 아트보드: 모노 13px, #414d5c(= cs-nav-text) - Reports 아트보드의 생성일 열과 같은 스타일 */}
                  <td className={`${tableClass.td} font-mono text-[13px] text-cs-nav-text tabular-nums`}>{r.lastScannedAt ?? '-'}</td>
                  <td className={tableClass.td}>
                    <div className="flex items-center gap-3">
                      <div className="w-[120px] shrink-0"><VerdictBar counts={r.counts} /></div>
                      {/* 합계 0이면 VerdictBar가 '판정 없음'을 쓰므로 '0 · 0 · 0'을 겹쳐 쓰지 않는다 */}
                      {total > 0 && (
                        <span className="text-xs text-cs-text-secondary tabular-nums">
                          {`${r.counts.pass} · ${r.counts.warn} · ${r.counts.fail}`}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={tableClass.td}>
                    <StatusIndicator type={status.type}>{status.label}</StatusIndicator>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
