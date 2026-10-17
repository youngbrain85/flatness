// 본문 컨테이너 클래스의 유일한 정의처. page.tsx와 loading.tsx가 같은 문자열을 써야
// 로딩→화면 전환에서 레이아웃 점프가 없다. 값은 아트보드 본문 틀 그대로다:
// 최대폭 1360px 가운데 정렬, 위 clamp(18px, 2.6vw, 28px) · 옆 clamp(16px, 3vw, 40px) · 아래 56px, 줄 간격 20px.
export const PAGE_MAIN = 'mx-auto flex w-full max-w-[1360px] flex-col gap-5 px-[clamp(16px,3vw,40px)] pb-14 pt-[clamp(18px,2.6vw,28px)]';

// 본문(main) 바탕: ground + 도면 격자(globals.css 의 drafting-grid 유틸리티, 스펙 §3).
// 셸이 <main className={MAIN_BG}> 로 쓴다. 검정 스테이지(Stage) 안에는 격자를 깔지 않는다.
export const MAIN_BG = 'bg-ground drafting-grid';
