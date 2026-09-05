// ReportTable(T8, 클라이언트 섬 - 스펙 §7-3): 서버가 이미 조회한 rows를 제목 includes 검색과
// 상태 필터(AND)로 거르고, ?location= 필터는 서버가 이미 건 것을 "무엇으로 걸렸는지"만 보여준다
// (서버 조회·URL 변경 없음). 상태 열은 StatusIndicator의 data-status로 읽는다(스타일이 아니라
// 의미 속성). 도구 줄 구조·테스트 형식은 T3 site-table.test.tsx를 본떴다.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ReportTable, type ReportTableRow } from '../report-table';

const rows: ReportTableRow[] = [
  { id: 'r1', title: '거실 평활도 보고서', locationLabel: '101동 / 3층 / 거실', statusType: 'pending', statusLabel: '작성 중', genStatus: 'done', createdAt: '2026-09-03' },
  { id: 'r2', title: '안방 구배 보고서', locationLabel: '101동 / 3층 / 안방', statusType: 'success', statusLabel: '발행됨', genStatus: 'done', createdAt: '2026-09-01' },
  { id: 'r3', title: '거실 구배 보고서', locationLabel: '102동 / 5층 / 거실', statusType: 'error', statusLabel: '생성 실패', genStatus: 'failed', createdAt: '2026-08-30' },
];

// 상태 필터용 픽스처 - reportStatusBadge가 낼 수 있는 상태 5종(작성 중·발행됨·생성 실패·PDF 생성 중·
// PDF 생성 대기 중)이 한 번씩 나온다. 아트보드(Reports.dc.html)는 'PDF 생성 중'만 clock(in-progress)으로
// 구분하고 'PDF 생성 대기 중'은 '작성 중'과 같은 minus-circle(pending)이다 - 둘은 gen_status로 갈린다.
const statusRows: ReportTableRow[] = [
  ...rows,
  { id: 'r4', title: '복도 평활도 보고서', locationLabel: '102동 / 5층 / 복도', statusType: 'in-progress', statusLabel: 'PDF 생성 중', genStatus: 'processing', createdAt: '2026-08-28' },
  { id: 'r5', title: '주방 구배 보고서', locationLabel: '103동 / 1층 / 주방', statusType: 'pending', statusLabel: 'PDF 생성 대기 중', genStatus: 'queued', createdAt: '2026-08-27' },
];

// 상태 열은 테이블 안에서 찾는다 - 상태 필터의 <option> 문구('작성 중' 등)가 같은 텍스트라
// screen.getByText로는 둘이 잡힌다.
function statusCell(label: string) {
  return within(screen.getByRole('table')).getByText(label);
}
// 지금 보이는 행의 제목(첫 열 링크) 목록 - 도구 줄의 '전체 보기' 링크는 테이블 밖이라 섞이지 않는다
function reportTitles(): string[] {
  return within(screen.getByRole('table')).queryAllByRole('link').map((l) => l.textContent ?? '');
}
function search(text: string) {
  fireEvent.change(screen.getByRole('textbox', { name: '보고서 검색' }), { target: { value: text } });
}
// 옵션 라벨(화면 문구)로 고른다 - 값 문자열이 아니라 사용자가 보는 텍스트가 계약이다
function pickFilter(label: string) {
  const value = (screen.getByRole('option', { name: label }) as HTMLOptionElement).value;
  fireEvent.change(screen.getByRole('combobox', { name: '상태 필터' }), { target: { value } });
}

describe('ReportTable 열 (아트보드 Reports: 제목·측정위치·상태·생성일)', () => {
  it('제목 링크(cs-link)·측정위치·생성일(mono)을 그리고 건수를 보여준다', () => {
    render(<ReportTable rows={rows} />);
    const link = screen.getByRole('link', { name: '거실 평활도 보고서' });
    expect(link).toHaveAttribute('href', '/reports/r1');
    expect(link.className).toContain('text-cs-link');
    expect(screen.getByText('101동 / 3층 / 거실')).toBeInTheDocument();
    expect(screen.getByText('2026-09-03').className).toContain('font-mono');
    expect(screen.getByText('총 3건')).toBeInTheDocument();
  });

  it.each([
    { label: '작성 중', status: 'pending' },
    { label: '발행됨', status: 'success' },
    { label: '생성 실패', status: 'error' },
    // 아트보드 Reports.dc.html: 'PDF 생성 중'만 clock, '대기 중'은 '작성 중'과 같은 minus-circle
    { label: 'PDF 생성 중', status: 'in-progress' },
    { label: 'PDF 생성 대기 중', status: 'pending' },
  ])('상태 "$label"은 StatusIndicator $status 로 그린다(서버가 고른 statusType 그대로)', ({ label, status }) => {
    render(<ReportTable rows={statusRows} />);
    expect(statusCell(label)).toHaveAttribute('data-status', status);
  });
});

describe('ReportTable 검색 (클라이언트 필터)', () => {
  it('제목 includes로 행을 거르고 건수도 따라간다', () => {
    render(<ReportTable rows={rows} />);
    fireEvent.change(screen.getByLabelText('보고서 검색'), { target: { value: '구배' } });
    expect(screen.queryByRole('link', { name: '거실 평활도 보고서' })).toBeNull();
    expect(screen.getByRole('link', { name: '안방 구배 보고서' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '거실 구배 보고서' })).toBeInTheDocument();
    expect(screen.getByText('총 2건')).toBeInTheDocument();
  });

  it('검색어를 지우면 전체 행이 돌아온다', () => {
    render(<ReportTable rows={rows} />);
    const input = screen.getByLabelText('보고서 검색');
    fireEvent.change(input, { target: { value: '안방' } });
    expect(screen.getAllByRole('row')).toHaveLength(2); // 헤더 1 + 본문 1
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('아무 행도 남지 않으면 안내 행을 그린다', () => {
    render(<ReportTable rows={rows} />);
    fireEvent.change(screen.getByLabelText('보고서 검색'), { target: { value: '없는 제목' } });
    expect(screen.getByText('조건에 맞는 보고서가 없습니다')).toBeInTheDocument();
    expect(screen.getByText('총 0건')).toBeInTheDocument();
  });
});

describe('ReportTable 상태 필터 (클라이언트 필터 - 스펙 §7-3, 검색과 AND)', () => {
  it('상태 필터 5종(전체·작성 중·발행됨·생성 실패·PDF 생성 중·대기)을 SelectWrap(chevron)으로 그리고, 처음은 전체다', () => {
    const { container } = render(<ReportTable rows={statusRows} />);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '전체', '작성 중', '발행됨', '생성 실패', 'PDF 생성 중·대기',
    ]);
    const select = screen.getByRole('combobox', { name: '상태 필터' });
    expect(select.className).toContain('border-cs-input-border');
    expect(container.querySelector('[data-icon="chevron-down"]')).toBeInTheDocument();
    expect(reportTitles()).toHaveLength(5);
    expect(screen.getByText('총 5건')).toBeInTheDocument();
  });

  it.each([
    { label: '작성 중', expected: ['거실 평활도 보고서'] },
    { label: '발행됨', expected: ['안방 구배 보고서'] },
    { label: '생성 실패', expected: ['거실 구배 보고서'] },
    { label: 'PDF 생성 중·대기', expected: ['복도 평활도 보고서', '주방 구배 보고서'] },
  ])('상태 필터 "$label"', ({ label, expected }) => {
    render(<ReportTable rows={statusRows} />);
    pickFilter(label);
    expect(reportTitles()).toEqual(expected);
    expect(screen.getByText(`총 ${expected.length}건`)).toBeInTheDocument();
  });

  it('검색과 필터는 AND로 겹치고, "전체"로 되돌리면 검색만 남는다', () => {
    render(<ReportTable rows={statusRows} />);
    search('구배');
    pickFilter('생성 실패');
    expect(reportTitles()).toEqual(['거실 구배 보고서']);
    expect(screen.getByText('총 1건')).toBeInTheDocument();
    pickFilter('전체');
    expect(reportTitles()).toEqual(['안방 구배 보고서', '거실 구배 보고서', '주방 구배 보고서']);
    expect(screen.getByText('총 3건')).toBeInTheDocument();
  });

  it('필터는 라벨 문구가 아니라 gen_status로 가른다(라벨이 바뀌어도 새지 않는다)', () => {
    // 라벨만 바꾼 두 행 - '작성 중'/'PDF 생성 대기 중'이라는 문구가 없어도 각 필터가 제 행을 고른다
    render(<ReportTable rows={[
      { id: 'x1', title: '초안 하나', locationLabel: '-', statusType: 'pending', statusLabel: '초안', genStatus: 'done', createdAt: '2026-09-04' },
      { id: 'x2', title: '대기 하나', locationLabel: '-', statusType: 'pending', statusLabel: '대기', genStatus: 'queued', createdAt: '2026-09-04' },
    ]} />);
    pickFilter('작성 중');
    expect(reportTitles()).toEqual(['초안 하나']);
    pickFilter('PDF 생성 중·대기');
    expect(reportTitles()).toEqual(['대기 하나']);
  });

  it('필터만으로 행이 남지 않아도 같은 안내 행을 그린다', () => {
    render(<ReportTable rows={[rows[1]]} />); // 발행됨 하나뿐
    pickFilter('생성 실패');
    expect(screen.getByText('조건에 맞는 보고서가 없습니다')).toBeInTheDocument();
    expect(reportTitles()).toEqual([]);
    expect(screen.getByText('총 0건')).toBeInTheDocument();
  });
});

describe('ReportTable 측정위치 필터 표시 (?location= 은 서버가 이미 걸었다)', () => {
  it('location 필터가 있으면 라벨과 전체 보기 링크(/reports)를 보여준다', () => {
    render(<ReportTable rows={[rows[0]]} locationFilter="101동 / 3층 / 거실" />);
    expect(screen.getByText('측정위치: 101동 / 3층 / 거실')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '전체 보기' })).toHaveAttribute('href', '/reports');
  });

  it('location 필터가 없으면 전체 보기 링크도 라벨도 없다', () => {
    render(<ReportTable rows={rows} />);
    expect(screen.queryByRole('link', { name: '전체 보기' })).toBeNull();
    expect(screen.queryByText(/^측정위치:/)).toBeNull();
  });
});
