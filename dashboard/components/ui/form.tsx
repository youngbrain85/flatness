// 폼 해부: 라벨 14px 700 위, 설명 12px 보조색, 필드 32px · 2px 보더 · radius 8px.
// 라디오·체크박스는 네이티브 + accent 색(스펙 §7-6).
import type { ReactNode } from 'react';
import { Icon } from './icons';

export const inputClass = 'h-8 w-full rounded-lg border-2 border-cs-input-border bg-white px-2 text-sm text-cs-text placeholder:text-cs-text-secondary focus:border-cs-link focus:outline-none disabled:border-cs-disabled disabled:text-cs-disabled';
export const selectClass = `${inputClass} appearance-none pr-8`;
export const textareaClass = 'min-h-24 w-full rounded-lg border-2 border-cs-input-border bg-white px-2 py-1.5 text-sm text-cs-text placeholder:text-cs-text-secondary focus:border-cs-link focus:outline-none';
export const checkClass = 'h-4 w-4 shrink-0 accent-cs-link';

export function FormField({ label, htmlFor, description, error, children }: {
  label: ReactNode; htmlFor?: string; description?: ReactNode; error?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-bold">{label}</label>
      {description && <p className="text-xs leading-4 text-cs-text-secondary">{description}</p>}
      {children}
      {error && <p className="text-xs leading-4 text-cs-error">{error}</p>}
    </div>
  );
}

// 네이티브 select의 화살표를 숨기고(selectClass의 appearance-none) chevron 아이콘을 얹는다.
export function SelectWrap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative${className ? ` ${className}` : ''}`}>
      {children}
      <Icon name="chevron-down" size={14} className="pointer-events-none absolute right-2 top-[9px] text-cs-text-secondary" />
    </div>
  );
}
