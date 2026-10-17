// 헤더의 펼침 목록 두 개(현장 바꾸기·계정 메뉴)가 함께 쓰는 열고 닫기·키보드 규칙(스펙 §4.3·§8).
// 클라이언트 컴포넌트(site-switcher.tsx·account-menu.tsx)에서만 쓴다.
//  - 단추: Enter·Space 는 열고 닫기를 바꾼다. 열면 data-popup-initial 칸(없으면 첫 항목)에 포커스.
//          ArrowDown 은 열고 첫 항목, ArrowUp 은 열고 끝 항목으로 간다. 마우스 클릭도 열고 닫기를 바꾼다.
//  - 목록: ArrowDown·ArrowUp 은 data-popup-item 항목 사이를 돈다(끝 다음은 처음). Esc 는 닫고
//          단추로 포커스를 돌려준다. 한글 조합 중(isComposing)의 키는 조합에 맡긴다.
//  - 바깥 누름은 닫는다. 마우스·터치·펜을 한꺼번에 덮는 pointerdown 을 쓴다(iOS Safari 는 클릭할 수 없는
//    요소를 탭하면 mousedown 같은 마우스 호환 이벤트를 보내지 않을 수 있다). 포커스는 사용자가 누른 곳에 맡긴다.
//  - 포커스가 팝업(단추 + 패널) 바깥의 다른 요소로 옮겨 가면 닫는다(Tab·Shift+Tab 포함, APG 메뉴 버튼 패턴).
//    닫지 않으면 z-30 패널이 본문을 덮은 채 남고 Esc 도 더 듣지 않으며 키보드로 두 목록이 동시에 열린다.
//    focusout 의 relatedTarget(포커스를 새로 받는 요소)이 있고 팝업 안이 아닐 때만 닫는다. relatedTarget 이
//    null 이면 닫지 않는다: 단추를 눌러도 포커스를 주지 않는 브라우저(macOS Safari)에서는 열린 검색칸이 단추
//    클릭에 blur 될 때 null 이라, 그때 닫으면 "닫혔다가 곧바로 다시 열리는" 결함이 생긴다(패널의 빈 곳을 눌러
//    포커스가 body 로 가는 경우와 창 전환도 null 이다. 바깥 누름은 pointerdown 이 맡는다).
//    Tab 키 자체는 막지 않는다(포커스를 가두지 않는다). keydown 에서 먼저 닫으면 포커스를 가진 패널이 DOM 에서
//    사라져 브라우저의 Tab 이동이 엉뚱한 곳에서 시작할 수 있어, 브라우저가 포커스를 옮긴 뒤 focusout 으로 닫는다.
//
// 반환값은 납작한 객체다. 쓰는 쪽은 곧바로 구조 분해해 ref·핸들러를 하나씩 넘긴다. ref 를 담은 묶음
// 객체(예: popup.trigger)를 렌더 중에 펼치면 React Compiler 린트(react-hooks/refs)가 "렌더 중 ref 접근"으로
// 막는다(실측: eslint-plugin-react-hooks 7.1.1).
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';

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
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
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

  // 팝업 루트(단추 + 패널)에 다는 onBlur. React 는 focusout 으로 받으므로 안쪽 어느 요소의 blur 든 여기로 온다.
  function onRootBlur(e: FocusEvent<HTMLDivElement>) {
    const next = e.relatedTarget;
    if (next && !e.currentTarget.contains(next)) hide(false);
  }

  return {
    open, rootRef, triggerRef, panelRef,
    onTriggerClick, onTriggerKeyDown, onTriggerKeyUp, onPanelKeyDown, onRootBlur,
    close: () => hide(false),
  };
}
