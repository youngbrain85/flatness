'use client';
// 진입 페이지의 클라이언트 섬(아트보드 docs/design/dark/EntrySearch.dc.html): 큰 검색칸이 현장 이름으로 목록을
// 거르고(서버 조회 없음), "새 현장"이 같은 화면에 입력 카드를 펼친다. 검색 결과가 0건이면 안내와 함께
// 검색어를 현장명에 넣은 채 카드를 연다. 초점: 카드가 열리면 현장명 칸, 취소하면 "새 현장" 버튼으로 돌아간다.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { GradeDot } from '@/components/ui/grade';
import { Icon } from '@/components/ui/icons';
import type { Grade } from '@/lib/domain/types';
import { NewSiteCard } from './new-site-card';
import { SiteList, type EntrySiteRow } from './site-list';

export type EntryTotals = { sites: number; locations: number; scans: number; inProgress: number };

// 현장명 포함 검색(앞뒤 공백 제거, 대소문자 무시 - 'a1'로 'A1블록'을 찾는다). 지난 홈 테이블과 같은 규칙.
export function filterSites(rows: EntrySiteRow[], query: string): EntrySiteRow[] {
  const q = query.trim().toLowerCase();
  return q === '' ? rows : rows.filter((r) => r.name.toLowerCase().includes(q));
}

// 목록 머리의 판정 분포 범례. 점 색은 분포 바(VerdictBar)의 세 묶음 색과 같다(아트보드 EntrySearch:
// 적합 · 경계 · 보수·재시공 = grade-pass · grade-borderline · grade-rework). 이름은 스펙 §9.
const BUCKETS: { label: string; grade: Grade }[] = [
  { label: '적합', grade: 'pass' },
  { label: '경계', grade: 'borderline' },
  { label: '보수·재시공', grade: 'rework' },
];

export function SiteFinder({ rows, totals }: { rows: EntrySiteRow[]; totals: EntryTotals }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState('');
  // 초점 요청 횟수. 카드가 열린 뒤(렌더 뒤) 현장명 칸으로 초점을 옮기려고 effect를 깨운다.
  const [focusTick, setFocusTick] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const visible = filterSites(rows, query);
  const trimmed = query.trim();

  useEffect(() => {
    if (open && focusTick > 0) nameRef.current?.focus();
  }, [open, focusTick]);

  function openCard(name: string) {
    setPrefill(name);
    setOpen(true);
    setFocusTick((t) => t + 1);
  }
  // 위쪽 "새 현장"은 카드를 열고 닫는다(열 때 현장명은 빈 칸)
  function toggle() {
    if (open) setOpen(false);
    else openCard('');
  }
  // 0건 안내의 "새 현장": 닫혀 있으면 검색어를 넣어 열고, 이미 열려 있으면 입력한 값을 두고 초점만 옮긴다
  function openFromEmpty() {
    if (open) nameRef.current?.focus();
    else openCard(trimmed);
  }
  function close() {
    setOpen(false);
    toggleRef.current?.focus();
  }

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5">
      <section aria-labelledby="entryTitle"
        className="flex flex-col items-center gap-[18px] pb-[clamp(4px,1vw,12px)] pt-[clamp(8px,3.4vw,44px)] text-center">
        <div className="flex flex-col items-center gap-2.5">
          <h1 id="entryTitle" className="font-heading text-[clamp(34px,4vw,48px)] font-bold leading-[1.15]">현장</h1>
          <p className="font-mono text-[13px] tabular-nums text-muted">
            {`${totals.sites}곳 · 측정위치 ${totals.locations} · 스캔 ${totals.scans} · 처리 중 ${totals.inProgress}건`}
          </p>
        </div>
        <div className="flex w-full flex-wrap justify-center gap-3">
          <div role="search" className="relative min-w-0 flex-[1_1_320px]">
            <label htmlFor="entryQuery" className="sr-only">현장 이름으로 찾기</label>
            <Icon name="search" size={18} className="pointer-events-none absolute left-4 top-[17px] text-muted" />
            <input id="entryQuery" type="text" placeholder="현장 이름으로 찾기" value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-h-[52px] w-full rounded-control border border-line-3 bg-ground pl-[46px] pr-4 text-left text-[17px] text-ink placeholder:text-muted" />
          </div>
          {/* 포커스 외곽선은 전역 :focus-visible(globals.css)이 그린다 */}
          <button ref={toggleRef} type="button" aria-expanded={open} aria-controls="newSiteCard" onClick={toggle}
            className={`inline-flex min-h-[52px] items-center justify-center gap-2 rounded-control border px-5 text-[15px] font-medium text-ink ${open ? 'border-ink bg-surface-2' : 'border-line-3 bg-transparent'}`}>
            <Icon name="plus" />
            <span>새 현장</span>
          </button>
        </div>
      </section>

      {open && <NewSiteCard initialName={prefill} nameRef={nameRef} onCancel={close} />}

      <section aria-labelledby="siteListTitle" className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="siteListTitle" className="font-mono text-[11px] font-medium tracking-[0.08em] text-dim">현장 목록</h2>
            <span aria-live="polite" className="font-mono text-xs text-muted">{`${visible.length}곳 · 최근 측정일 순`}</span>
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-ink-2">
            <span className="text-[11px] tracking-[0.08em] text-dim">판정 분포</span>
            {BUCKETS.map((b) => (
              <span key={b.grade} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <GradeDot grade={b.grade} />
                {b.label}
              </span>
            ))}
          </p>
        </div>
        {visible.length > 0 ? (
          <SiteList rows={visible} />
        ) : (
          <div className="flex flex-col items-center gap-4 rounded-card border border-line-2 bg-surface px-[22px] py-11 text-center">
            <span aria-hidden="true" className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-line-3 text-muted">
              <Icon name="search" size={18} />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="font-heading text-[17px] font-bold">
                {rows.length === 0 ? '아직 등록된 현장이 없습니다' : '찾는 현장이 없습니다'}
              </p>
              {trimmed !== '' && (
                <p className="font-mono text-[13px] text-muted [overflow-wrap:anywhere]">{`검색어 · ${trimmed}`}</p>
              )}
            </div>
            {/* 주 버튼은 한 화면에 하나: 카드가 열려 있으면 카드의 "현장 등록"이 주 버튼이라 여기는 보조로 둔다 */}
            <Button variant={open ? 'normal' : 'primary'} onClick={openFromEmpty}>
              <Icon name="plus" />
              새 현장
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
