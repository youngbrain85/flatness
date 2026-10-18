// 폼 해부(스펙 §6 FormField, 아트보드 입력 필드): 라벨 14px 600 위, 입력칸 44px · ground 바탕 ·
// line-3 테두리 · 반지름 6px · 15px, 도움말은 입력칸 아래 13px muted.
// 라디오·체크박스는 네이티브 + accent ink(어두운 브라우저 부품은 globals.css 의 color-scheme: dark).
// 포커스 외곽선은 globals.css 의 :focus-visible 규칙이 그린다(여기서 outline-none 으로 끄지 않는다).
import type { ReactNode } from 'react';
import { Icon } from './icons';

export const inputClass = 'min-h-11 w-full rounded-control border border-line-3 bg-ground px-3 text-[15px] text-ink placeholder:text-muted disabled:cursor-not-allowed disabled:text-dim';
export const selectClass = `${inputClass} appearance-none pr-10`;
export const textareaClass = 'min-h-28 w-full rounded-control border border-line-3 bg-ground px-3 py-2.5 text-[15px] leading-normal text-ink placeholder:text-muted';
// 선택 표시 크기는 아트보드를 따른다: 라디오 16px(Upload·ScanDone 구배 기준) = checkClass,
// 체크박스 18px(RegistrationDetail·ReportNew·Settings)와 단위 확인 라디오 18px(ScanUnitConfirm) = checkLgClass.
export const checkClass = 'h-4 w-4 shrink-0 accent-ink';
export const checkLgClass = 'h-[18px] w-[18px] shrink-0 accent-ink';

export function FormField({ label, htmlFor, description, error, children }: {
  label: ReactNode; htmlFor?: string; description?: ReactNode; error?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">{label}</label>
      {children}
      {description && <p className="text-[13px] text-muted">{description}</p>}
      {error && <p className="text-[13px] text-err">{error}</p>}
    </div>
  );
}

// 네이티브 select의 화살표를 숨기고(selectClass의 appearance-none) chevron 아이콘을 얹는다.
export function SelectWrap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={'relative' + (className ? ` ${className}` : '')}>
      {children}
      <Icon name="chevron-down" className="pointer-events-none absolute right-3.5 top-1/2 -mt-2 text-ink-2" />
    </div>
  );
}
