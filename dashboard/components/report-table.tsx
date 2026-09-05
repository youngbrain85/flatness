'use client';
// 보고서 목록 테이블 + 도구 줄(클라이언트 섬 - 스펙 §7-3): 서버가 이미 조회한 rows를 제목 includes 검색과
// 상태 필터로 걸러 보여준다(둘은 AND). 서버 조회·URL은 건드리지 않는다. ?location= 필터는 서버가 이미
// 걸었으므로 여기서는 "무엇으로 걸렸는지"만 보여주고 '전체 보기'로 풀 수 있게 한다. 아트보드의
// 페이지네이션(‹ 1 ›)은 현재 데이터 규모에서 YAGNI - 우측에 건수 텍스트만 둔다. 도구 줄 구조는 T3
// site-table.tsx와 같다. 아트보드: docs/design/cloudscape/Reports.dc.html
import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/ui/icons';
import { inputClass, selectClass, SelectWrap } from '@/components/ui/form';
import { tableClass, TableToolbar } from '@/components/ui/data-table';
import { StatusIndicator, type StatusType } from '@/components/ui/status-indicator';
import type { ReportGenStatus } from '@/lib/domain/types';

export interface ReportTableRow {
  id: string;
  title: string;
  locationLabel: string;
  /**
   * 서버(app/reports/page.tsx)가 고른 StatusIndicator 종류. reportStatusBadge는 작성 중·PDF 생성 중·
   * PDF 생성 대기 중을 모두 unknown 톤으로 묶지만, 아트보드(Reports.dc.html)는 'PDF 생성 중'만
   * clock(in-progress)으로 구분한다 - 그 판단을 서버에서 끝내 여기서는 그대로 그리기만 한다.
   */
  statusType: StatusType;
  statusLabel: string;
  /** reports.gen_status 원본 - 상태 필터가 '작성 중'과 'PDF 생성 중·대기'를 라벨 문구가 아니라 이 값으로 가른다 */
  genStatus: ReportGenStatus;
  /** 'YYYY-MM-DD' - 서버(app/reports/page.tsx)가 created_at.slice(0, 10)으로 만든다 */
  createdAt: string;
}

// 상태 필터 선택지 - 값은 reportStatusBadge가 낼 수 있는 상태 중 어느 것인지, 라벨은 화면 문구.
// 판단은 서버가 reportStatusBadge로 끝냈으므로 여기서는 statusType과 gen_status로 되짚는다:
// success = 발행됨, error = 생성 실패, in-progress = PDF 생성 중, pending은 gen_status가 done이면
// 작성 중(초안), 아니면 PDF 생성 대기 중이다.
export type ReportFilter = 'all' | 'draft' | 'finalized' | 'failed' | 'generating';
const FILTERS: { value: ReportFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'draft', label: '작성 중' },
  { value: 'finalized', label: '발행됨' },
  { value: 'failed', label: '생성 실패' },
  { value: 'generating', label: 'PDF 생성 중·대기' },
];

function matchesFilter(row: ReportTableRow, f: ReportFilter): boolean {
  switch (f) {
    case 'finalized': return row.statusType === 'success';
    case 'failed': return row.statusType === 'error';
    // 초안 계열(pending/in-progress)만 여기서 갈린다 - PDF 생성이 끝난(done) 것이 '작성 중'이고
    // 나머지(queued/processing)가 'PDF 생성 중·대기'다. 라벨 문구는 보지 않는다.
    case 'draft': return row.statusType === 'pending' && row.genStatus === 'done';
    case 'generating':
      return (row.statusType === 'pending' || row.statusType === 'in-progress') && row.genStatus !== 'done';
    default: return true;
  }
}

export function ReportTable({ rows, locationFilter = null }: {
  rows: ReportTableRow[];
  /** ?location= 필터가 걸려 있으면 그 측정위치 라벨, 아니면 null */
  locationFilter?: string | null;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ReportFilter>('all');
  // 제목 includes(앞뒤 공백 제거, 대소문자 무시). 검색과 상태 필터는 AND.
  const q = query.trim().toLowerCase();
  const visible = rows.filter((r) => (q === '' || r.title.toLowerCase().includes(q)) && matchesFilter(r, filter));

  return (
    <>
      <TableToolbar>
        {/* 360px, 2px cs-input-border, 좌측 search 아이콘. inputClass의 px-2는 pl-8이 덮는다(T3과 같은 마크업) */}
        <div className="relative w-[360px] max-w-full">
          <Icon name="search" className="pointer-events-none absolute left-2 top-2 text-cs-text-secondary" />
          <input type="text" aria-label="보고서 검색" placeholder="보고서 검색" value={query}
            onChange={(e) => setQuery(e.target.value)} className={`${inputClass} pl-8`} />
        </div>
        {/* 네이티브 select는 닫힌 상태에 '상태: ' 접두어를 못 그린다 - 옵션 라벨 '전체' + aria-label로 뜻을 준다 */}
        <SelectWrap className="w-44">
          <select aria-label="상태 필터" value={filter} className={selectClass}
            onChange={(e) => setFilter(e.target.value as ReportFilter)}>
            {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </SelectWrap>
        {locationFilter !== null && (
          <span className="inline-flex items-center gap-2 text-sm">
            <span className="text-cs-text-secondary">{`측정위치: ${locationFilter}`}</span>
            <Link href="/reports" className="text-cs-link hover:text-cs-link-hover hover:underline">전체 보기</Link>
          </span>
        )}
        {/* 검색·필터 결과 건수 - 컨테이너 헤더의 (n)은 전체 건수, 여기는 지금 보이는 행 수 */}
        <span className="ml-auto text-sm text-cs-text-secondary tabular-nums">{`총 ${visible.length}건`}</span>
      </TableToolbar>
      <div className="overflow-x-auto">
        <table className={tableClass.table}>
          <thead className={tableClass.thead}>
            <tr>
              <th className={tableClass.th}>제목</th>
              <th className={tableClass.th}>측정위치</th>
              <th className={tableClass.th}>상태</th>
              <th className={tableClass.th}>생성일</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={4} className={`${tableClass.td} text-center text-cs-text-secondary`}>조건에 맞는 보고서가 없습니다</td>
              </tr>
            ) : visible.map((r) => (
              <tr key={r.id} className={tableClass.row}>
                <td className={tableClass.td}>
                  <Link href={`/reports/${r.id}`} className={tableClass.link}>{r.title}</Link>
                </td>
                <td className={tableClass.td}>{r.locationLabel}</td>
                <td className={tableClass.td}>
                  <StatusIndicator type={r.statusType}>{r.statusLabel}</StatusIndicator>
                </td>
                {/* 아트보드: 생성일은 mono 13px, 좌측 정렬(수치 열의 tdNum은 우측 정렬이라 쓰지 않는다) */}
                <td className={`${tableClass.td} font-mono text-[13px] text-cs-nav-text tabular-nums`}>{r.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
