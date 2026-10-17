'use client';
// 현장 바꾸기(스펙 §4.3): 지금 현장 이름 단추 → 검색칸 + 현장 이름 목록 + "모든 현장 보기"(/).
// 목록은 처음 펼칠 때 브라우저 Supabase 로 sites 를 name 순으로 읽는다. 최근 활동 순은 sites 에 시각
// 컬럼이 없어 집계가 필요하므로 하지 않는다(스펙 §4.3). 한 번 읽으면 이 헤더가 사는 동안 다시 쓰고,
// 실패했을 때만 다음 펼침에서 다시 읽는다. 키보드·바깥 누름·포커스 이동 규칙은 use-popup.ts.
// 펼친 패널은 role="dialog"(이름 "현장 바꾸기")이고 단추는 aria-haspopup="dialog"다. 패널 안에 검색칸·listbox·
// 바깥 링크가 함께 있어 listbox 는 팝업 컨테이너가 아니다 - ARIA 1.2 는 aria-haspopup 값이 팝업 컨테이너의 role
// 과 맞아야 한다(MUST)고 정한다. 항목 목록만 role="listbox"로 둔다.
import Link from 'next/link';
import { useId, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { inputClass } from '@/components/ui/form';
import { Icon } from '@/components/ui/icons';
import { usePopup } from './use-popup';

type SiteOption = { id: string; name: string };
type SitesLoad =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'done'; sites: SiteOption[] };

// 아트보드 단추: 최소 44px, 좌우 10px, 투명 테두리, Noto Sans KR 15px 700, 꺾쇠 14px
const TRIGGER = 'inline-flex min-h-11 max-w-full items-center gap-2 rounded-control border border-transparent px-2.5 text-left font-heading text-[15px] font-bold text-ink hover:border-line-3 aria-expanded:border-line-3 aria-expanded:bg-surface-2';
// 펼친 모습은 아트보드에 없다(BRIEF-ia-addendum §1) - 카드(surface·line-2·12px) 안 44px 항목, 누름은 surface-2
const ITEM = 'flex min-h-11 w-full items-center justify-between gap-3 rounded-control px-3 text-left text-sm text-ink-2 hover:bg-surface-2 hover:text-ink';

export function SiteSwitcher({ current }: { current: { id: string; name: string } }) {
  const [load, setLoad] = useState<SitesLoad>({ state: 'idle' });
  const [query, setQuery] = useState('');
  const panelId = useId();
  const {
    open, rootRef, triggerRef, panelRef,
    onTriggerClick, onTriggerKeyDown, onTriggerKeyUp, onPanelKeyDown, onRootBlur, close,
  } = usePopup({
    onOpen: () => {
      setQuery(''); // 펼칠 때마다 검색어를 비운다
      if (load.state === 'idle' || load.state === 'error') void loadSites();
    },
  });

  async function loadSites() {
    setLoad({ state: 'loading' });
    const { data, error } = await createClient().from('sites').select('id, name').order('name');
    setLoad(error
      ? { state: 'error', message: error.message }
      : { state: 'done', sites: (data ?? []) as SiteOption[] });
  }

  const q = query.trim().toLowerCase();
  const shown = load.state === 'done' ? load.sites.filter((s) => s.name.toLowerCase().includes(q)) : [];

  return (
    // 패널 위치: 휴대폰 폭(640px 미만)에서는 이 상자가 기준점이 아니어서(static) 패널이 헤더(relative)
    // 기준으로 좌우 16px 안에 펼쳐진다. 단추가 오른쪽에 있어도 화면 밖으로 나가지 않는다(가로 스크롤 금지).
    // 640px 이상에서는 이 상자가 기준점이 되어 단추 바로 아래 360px 로 펼쳐진다.
    <div ref={rootRef} onBlur={onRootBlur} className="sm:relative">
      <button type="button" ref={triggerRef} aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={onTriggerClick} onKeyDown={onTriggerKeyDown} onKeyUp={onTriggerKeyUp} className={TRIGGER}>
        {current.name}
        <Icon name="chevron-down" size={14} />
      </button>
      {open && (
        <div id={panelId} ref={panelRef} role="dialog" aria-label="현장 바꾸기" onKeyDown={onPanelKeyDown}
          className="absolute left-4 right-4 top-full z-30 mt-1 flex flex-col gap-1 rounded-card border border-line-2 bg-surface p-2 sm:left-0 sm:right-auto sm:w-[360px]">
          <label className="relative mb-1 block">
            <span className="sr-only">현장 이름으로 찾기</span>
            <Icon name="search" size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input type="search" data-popup-initial value={query} autoComplete="off"
              onChange={(e) => setQuery(e.target.value)} placeholder="현장 이름으로 찾기"
              className={`${inputClass} pl-9`} />
          </label>
          {load.state === 'loading' && <p className="px-3 py-2 text-sm text-muted">불러오는 중…</p>}
          {load.state === 'error' && (
            <p role="alert" className="px-3 py-2 text-sm text-err">
              현장 목록을 불러오지 못했습니다. 닫았다가 다시 펼치면 다시 읽습니다. ({load.message})
            </p>
          )}
          {load.state === 'done' && shown.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted">찾는 현장이 없습니다.</p>
          )}
          {shown.length > 0 && (
            <div role="listbox" aria-label="현장 목록"
              className="flex max-h-[min(60vh,360px)] flex-col gap-0.5 overflow-y-auto">
              {shown.map((s) => {
                const isCurrent = s.id === current.id;
                return (
                  <Link key={s.id} href={`/sites/${s.id}`} role="option" aria-selected={isCurrent}
                    tabIndex={-1} data-popup-item onClick={close} className={ITEM}>
                    <span className="min-w-0 truncate">{s.name}</span>
                    {isCurrent && <span className="shrink-0 font-mono text-[11px] text-dim">지금 현장</span>}
                  </Link>
                );
              })}
            </div>
          )}
          <div aria-hidden="true" className="my-1 h-px bg-line" />
          <Link href="/" tabIndex={-1} data-popup-item onClick={close} className={ITEM}>
            모든 현장 보기
          </Link>
        </div>
      )}
    </div>
  );
}
