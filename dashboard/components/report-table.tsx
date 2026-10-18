'use client';
// 보고서 목록 표 + 도구 줄(클라이언트 섬): 서버가 이미 조회한 rows를 제목 검색(includes)과 상태 필터(AND)로
// 거른다. 서버 조회·URL은 건드리지 않는다. ?location= 필터는 서버가 이미 걸었으므로 여기서는 무엇으로
// 걸렸는지만 보여 주고 '전체 보기'로 풀 수 있게 한다. 페이지네이션 없이 건수만 둔다.
// 아트보드 docs/design/dark/Reports.dc.html: 도구 줄은 위만 둥근 surface 띠, 표 상자는 그 아래 붙은 아래만
// 둥근 상자이고 가로로 넘치면 상자 안에서만 스크롤한다(스펙 §7: 페이지 가로 스크롤 금지). 두 상자 모양은
// Task 1의 TableBox(toolbar)가 그린다 - 여기서는 도구 줄 내용과 <thead>·<tbody>만 넘긴다.
import Link from 'next/link';
import { useState } from 'react';
import { TableBox, tableClass } from '@/components/ui/data-table';
import { inputClass, selectClass, SelectWrap } from '@/components/ui/form';
import { Icon } from '@/components/ui/icons';
import { StatusIndicator, type StatusType } from '@/components/ui/status-indicator';
import type { ReportGenStatus } from '@/lib/domain/types';

export interface ReportTableRow {
  id: string;
  title: string;
  /** 측정위치 표기(' / '로 이은 것, 아트보드 Reports 측정위치 열) */
  locationLabel: string;
  /**
   * 서버가 reportIndicator(lib/domain/reports.ts, Task 4)로 고른 StatusIndicator 종류. 아트보드대로
   * 'PDF 생성 중'만 속 빈 고리(in-progress)이고 작성 중·PDF 생성 대기 중은 pending이다 - 그 판단을
   * 서버에서 끝내 여기서는 그대로 그리기만 한다.
   */
  statusType: StatusType;
  statusLabel: string;
  /** reports.gen_status 원본 - 상태 필터가 '작성 중'과 'PDF 생성 중·대기'를 라벨 문구가 아니라 이 값으로 가른다 */
  genStatus: ReportGenStatus;
  /** 'YYYY-MM-DD' - 서버가 created_at.slice(0, 10)으로 만든다 */
  createdAt: string;
}

// 상태 필터 선택지 - 값은 reportIndicator가 낼 수 있는 상태 중 어느 것인지, 라벨은 화면 문구.
// 판단은 서버가 reportIndicator로 끝냈으므로 여기서는 statusType과 gen_status로 되짚는다:
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
  /** ?location= 필터가 걸려 있으면 그 측정위치 표기와 필터를 푸는 주소(현장 보고서 목록), 아니면 null */
  locationFilter?: { label: string; clearHref: string } | null;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ReportFilter>('all');
  // 제목 includes(앞뒤 공백 제거, 대소문자 무시). 검색과 상태 필터는 AND.
  const q = query.trim().toLowerCase();
  const visible = rows.filter((r) => (q === '' || r.title.toLowerCase().includes(q)) && matchesFilter(r, filter));

  // 도구 줄 내용(TableBox가 위만 둥근 띠와 flex-wrap 배치를 그린다)
  const toolbar = (
    <>
      {/* 검색: `flex: 1 1 240px; max-width: 360px`, 왼쪽 13px에 돋보기(44px 칸의 세로 가운데 = top 14px) */}
      <div className="relative min-w-0 max-w-[360px] flex-[1_1_240px]">
        <Icon name="search" className="pointer-events-none absolute left-[13px] top-[14px] text-muted" />
        <input type="text" aria-label="보고서 검색" placeholder="보고서 검색" value={query}
          onChange={(e) => setQuery(e.target.value)} className={`${inputClass} pl-[38px]`} />
      </div>
      {/* 네이티브 select는 닫힌 상태에 '상태: ' 접두어를 못 그린다 - 옵션 라벨 '전체' + aria-label로 뜻을 준다 */}
      <SelectWrap className="min-w-0 flex-[0_1_220px]">
        <select aria-label="상태 필터" value={filter} className={selectClass}
          onChange={(e) => setFilter(e.target.value as ReportFilter)}>
          {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </SelectWrap>
      {locationFilter && (
        <span className="inline-flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">{`측정위치: ${locationFilter.label}`}</span>
          <Link href={locationFilter.clearHref}
            className="inline-flex min-h-11 items-center text-ink underline decoration-line-3 underline-offset-4">전체 보기</Link>
        </span>
      )}
      {/* 검색·필터 결과 건수(지금 보이는 행 수) - 화면 읽기 프로그램에 바뀔 때마다 알린다 */}
      <span aria-live="polite" className="ml-auto font-mono text-xs text-muted">{`총 ${visible.length}건`}</span>
    </>
  );

  return (
    <section aria-label="보고서 목록">
      <TableBox minWidth={720} toolbar={toolbar}>
        <thead className={tableClass.thead}>
          <tr>
            <th scope="col" className={tableClass.th}>제목</th>
            <th scope="col" className={tableClass.th}>측정위치</th>
            <th scope="col" className={tableClass.th}>상태</th>
            <th scope="col" className={tableClass.th}>생성일</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={4} className={tableClass.td}>
                <p className="py-3.5 text-center text-muted">조건에 맞는 보고서가 없습니다</p>
              </td>
            </tr>
          ) : visible.map((r) => (
            <tr key={r.id} className={tableClass.row}>
              <td className={tableClass.td}>
                <Link href={`/reports/${r.id}`} className={tableClass.link}>{r.title}</Link>
              </td>
              <td className={tableClass.td}>{r.locationLabel}</td>
              <td className={tableClass.td}>
                <span className="whitespace-nowrap">
                  <StatusIndicator type={r.statusType}>{r.statusLabel}</StatusIndicator>
                </span>
              </td>
              {/* 생성일: mono 13px ink-2, 왼쪽 정렬(수치 열의 tdNum은 오른쪽 정렬이라 쓰지 않는다) */}
              <td className={tableClass.td}>
                <span className="whitespace-nowrap font-mono text-[13px] tabular-nums text-ink-2">{r.createdAt}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </TableBox>
    </section>
  );
}
