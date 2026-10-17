'use client';
import { useEffect } from 'react';

// 대시보드 타일(/sites/{id}/locations#loc-{id})로 클라이언트 이동하면 app/sites/[id]/loading.tsx 가 먼저 그려진다.
// Next 의 해시 스크롤(node_modules/next/dist/client/components/layout-router.js 의 ScrollAndMaybeFocusHandler)은
// LoadingBoundary 바깥에 있고 이동 한 번에 한 번만 해시 요소를 찾는다. 그 한 번을 로딩 화면에서 써 버리고
// (hashFragment = null) 본문이 스트리밍으로 도착해도 해당 행으로 스크롤하지 않는다.
// 이 컴포넌트는 본문(트리)과 함께 마운트되어 주소 끝의 #id 요소로 한 번 더 스크롤한다. 해시로 바로 연 경우는
// 브라우저가 이미 스크롤한 자리에 한 번 더 가는 것뿐이다. 화면에는 아무것도 그리지 않는다.
export function ScrollToHash() {
  useEffect(() => {
    const raw = window.location.hash.slice(1);
    if (!raw) return;
    let id = raw;
    try {
      id = decodeURIComponent(raw);
    } catch {
      // 짝이 안 맞는 % 인코딩은 원문 그대로 찾는다
    }
    document.getElementById(id)?.scrollIntoView();
  }, []);
  return null;
}
