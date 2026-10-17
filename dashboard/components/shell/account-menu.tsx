'use client';
// 계정 메뉴(스펙 §4.3): 이메일을 라벨로 한 단추 → "설정"(/settings)·"로그아웃"(LogoutButton 동작 그대로).
// 열고 닫기·키보드·바깥 누름 규칙은 현장 바꾸기와 같다(use-popup.ts).
import Link from 'next/link';
import { useId } from 'react';
import { LogoutButton } from '@/components/logout-button';
import { Icon } from '@/components/ui/icons';
import { usePopup } from './use-popup';

// 아트보드 단추: 최소 44px, 좌우 12px, line-3 테두리, ink-2 글자, IBM Plex Mono 12px, 꺾쇠 14px
const TRIGGER = 'inline-flex min-h-11 items-center gap-2 rounded-control border border-line-3 px-3 font-mono text-xs text-ink-2 hover:text-ink aria-expanded:bg-surface-2 aria-expanded:text-ink';
// 펼친 모습은 아트보드에 없다(BRIEF-ia-addendum §1) - 현장 바꾸기와 같은 카드·항목 모양
const ITEM = 'flex min-h-11 w-full items-center rounded-control px-3 text-left text-sm text-ink-2 hover:bg-surface-2 hover:text-ink';

export function AccountMenu({ email }: { email: string | null }) {
  const menuId = useId();
  const {
    open, rootRef, triggerRef, panelRef,
    onTriggerClick, onTriggerKeyDown, onTriggerKeyUp, onPanelKeyDown, close,
  } = usePopup();
  return (
    <div ref={rootRef} className="relative">
      <button type="button" ref={triggerRef} aria-haspopup="menu" aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={onTriggerClick} onKeyDown={onTriggerKeyDown} onKeyUp={onTriggerKeyUp} className={TRIGGER}>
        {/* proxy 가 이메일 헤더를 싣지 않은 계정은 "계정"으로 부른다 */}
        {email ?? '계정'}
        <Icon name="chevron-down" size={14} />
      </button>
      {open && (
        <div id={menuId} ref={panelRef} role="menu" aria-label="계정 메뉴" onKeyDown={onPanelKeyDown}
          className="absolute right-0 top-full z-30 mt-1 flex min-w-[200px] flex-col gap-1 rounded-card border border-line-2 bg-surface p-2">
          <Link href="/settings" role="menuitem" tabIndex={-1} data-popup-item onClick={close} className={ITEM}>
            설정
          </Link>
          <LogoutButton role="menuitem" tabIndex={-1} data-popup-item className={ITEM} />
        </div>
      )}
    </div>
  );
}
