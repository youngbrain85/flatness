// 헤더의 펼침 목록 두 개(현장 바꾸기·계정 메뉴)가 함께 쓰는 열고 닫기·키보드 규칙(스펙 §4.3·§8).
// 클라이언트 컴포넌트(site-switcher.tsx·account-menu.tsx)에서만 쓴다.
//  - 단추: Enter·Space 는 열고 닫기를 바꾼다. 열면 data-popup-initial 칸(없으면 첫 항목)에 포커스.
//          ArrowDown 은 열고 첫 항목, ArrowUp 은 열고 끝 항목으로 간다. 마우스 클릭도 열고 닫기를 바꾼다.
//  - 목록: ArrowDown·ArrowUp 은 data-popup-item 항목 사이를 돈다(끝 다음은 처음). Esc 는 닫고
//          단추로 포커스를 돌려준다. 한글 조합 중(isComposing)의 키는 조합에 맡긴다.
//  - 바깥 누름(mousedown)은 닫는다. 포커스는 사용자가 누른 곳에 맡긴다.
// Tab 으로 빠져나갈 때 닫는 규칙은 넣지 않았다. blur 로 닫으면 단추 클릭에 포커스를 주지 않는 브라우저
// (macOS Safari)에서 "닫혔다가 곧바로 다시 열리는" 결함이 생긴다. 닫기는 바깥 누름·Esc·항목 선택이 맡는다.
//
// 반환값은 납작한 객체다. 쓰는 쪽은 곧바로 구조 분해해 ref·핸들러를 하나씩 넘긴다. ref 를 담은 묶음
// 객체(예: popup.trigger)를 렌더 중에 펼치면 React Compiler 린트(react-hooks/refs)가 "렌더 중 ref 접근"으로
// 막는다(실측: eslint-plugin-react-hooks 7.1.1).
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

type OpenFocus = 'initial' | 'first' | 'last';

function popupItems(panel: HTMLElement | null): HTMLElement[] {
  return Array.from(panel?.querySelectorAll<HTMLElement>('[data-popup-item]') ?? []);
}

export function usePopup({ onOpen }: { onOpen?: () => void } = {}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openFocus = useRef<OpenFocus>('initial');

  // 패널은 열린 뒤에야 DOM 에 생긴다 - 포커스는 그려진 다음(effect)에 옮긴다.
  // 항목이 아직 없으면(목록을 읽는 중) data-popup-initial 칸으로 간다.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const list = popupItems(panel);
    const initial = panel?.querySelector<HTMLElement>('[data-popup-initial]') ?? null;
    const wanted = openFocus.current === 'first' ? list[0]
      : openFocus.current === 'last' ? list[list.length - 1]
      : initial ?? list[0];
    (wanted ?? initial)?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  function show(focus: OpenFocus) {
    openFocus.current = focus;
    setOpen(true);
    onOpen?.();
  }

  function hide(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function move(step: 1 | -1) {
    const list = popupItems(panelRef.current);
    if (list.length === 0) return;
    const at = list.indexOf(document.activeElement as HTMLElement);
    // 검색칸처럼 항목 밖에서 누르면 아래는 첫 항목, 위는 끝 항목으로 간다
    const next = at === -1 ? (step === 1 ? 0 : list.length - 1) : (at + step + list.length) % list.length;
    list[next].focus();
  }

  function onTriggerClick() {
    if (open) hide(false);
    else show('initial');
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      // 키보드 누름은 여기서 처리하고, 브라우저가 이어서 만드는 click 은 막는다(두 번 바뀌지 않게)
      e.preventDefault();
      onTriggerClick();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      if (open) move(step);
      else show(step === 1 ? 'first' : 'last');
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      hide(true);
    }
  }

  // Firefox 는 keydown 의 Space 를 막아도 keyup 에서 click 을 만든다 - keyup 도 막는다
  function onTriggerKeyUp(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === ' ') e.preventDefault();
  }

  function onPanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      hide(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
    }
  }

  return {
    open, rootRef, triggerRef, panelRef,
    onTriggerClick, onTriggerKeyDown, onTriggerKeyUp, onPanelKeyDown,
    close: () => hide(false),
  };
}
