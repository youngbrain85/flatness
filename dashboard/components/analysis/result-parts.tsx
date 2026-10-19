// 분석 결과 구획(평활도·구배)이 함께 쓰는 C안 조각(아트보드 docs/design/dark/ScanDone·ScanDeviation·Stage·ScanSlope).
// 카드·눈썹 라벨·보조 문단과 결과 머리의 메타 문구다. 결과 화면 두 곳만 쓰는 배치 문법이라 components/ui 로
// 올리지 않는다. 스테이지와 그 아래에 붙는 줄은 components/ui/stage.tsx 의 Stage(toolbar)가 그린다.

/** 카드 상자: surface 바탕 + line-2 테두리 + 12px. 안쪽 배치(flex 방향·gap)는 쓰는 쪽이 덧붙인다. */
export const CARD = 'min-w-0 rounded-card border border-line-2 bg-surface px-[22px] py-5';
/** 나란한 카드 줄. 카드에 CARD_HALF 를 붙이면 넓은 화면은 둘씩, 좁은 화면은 아래로 쌓인다(flex 1 1 420px). */
export const CARD_ROW = 'flex flex-wrap gap-3';
export const CARD_HALF = 'flex-[1_1_420px]';
/** 눈썹 라벨: IBM Plex Mono 11px dim(스펙 §8: dim 은 11px 눈썹 라벨에만 쓴다). */
export const EYEBROW = 'font-mono text-[11px] tracking-[0.08em] text-dim';
/** 눌린 버튼(아트보드 Stage 의 도구 버튼, 3D 시점·판정 셀 분절 버튼): ink 채움 + ground 글자. Button 의 보조(normal)
 * 변형이 가진 투명 바탕·글자색 클래스와 특이도가 같은 클래스를 덧붙이면 순서에 따라 가려진다. aria-pressed variant 는
 * 속성 선택자가 붙어 특이도가 높고 Tailwind 가 뒤에 내보낸다. 공용 Button 은 고치지 않는다. */
export const PRESSED = 'aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:font-semibold aria-pressed:text-ground';
/** 카드 안 보조 문단: 13px muted. */
export const NOTE = 'text-[13px] leading-relaxed text-muted';

/** 결과 머리의 메타: 일시 · 엔진 버전. 일시는 지금 이력 목록과 같은 표기(created_at 앞 16자, T 를 공백으로). */
export function resultMeta(createdAt: string, engineVersion: string | null): string {
  return `${createdAt.slice(0, 16).replace('T', ' ')} · 엔진 ${engineVersion ?? '-'}`;
}
