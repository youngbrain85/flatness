// 다크 C안 버튼(스펙 §6, 아트보드 Stage): 높이 44px · 반지름 6px · 1px 테두리 · 15px.
// primary = ink 채움 + ground 글자(한 화면에 하나), normal = 투명 + line-3 테두리, danger = 투명 + err 테두리·글자.
// 비활성은 변형 색을 버리고 line-3 테두리 + dim 글자(아트보드 ScanProcessing 의 잠긴 '평활도 분석').
import Link from 'next/link';
import type { ComponentProps } from 'react';

export type ButtonVariant = 'primary' | 'normal' | 'danger';

const BASE = 'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-control border px-[18px] text-[15px] transition-colors';
const WEIGHT: Record<ButtonVariant, string> = {
  primary: 'font-semibold',
  normal: 'font-medium',
  danger: 'font-semibold',
};
const COLOR: Record<ButtonVariant, string> = {
  primary: 'border-ink bg-ink text-ground hover:border-ink-2 hover:bg-ink-2',
  normal: 'border-line-3 bg-transparent text-ink hover:bg-surface-2',
  danger: 'border-err bg-transparent text-err hover:bg-surface-2',
};
const DISABLED = 'cursor-not-allowed border-line-3 bg-transparent text-dim';

export function buttonClass(variant: ButtonVariant = 'normal', opts: { disabled?: boolean; full?: boolean } = {}): string {
  return [BASE, WEIGHT[variant], opts.disabled ? DISABLED : COLOR[variant], opts.full ? 'w-full' : '']
    .filter(Boolean).join(' ');
}

export function Button({ variant = 'normal', className, disabled, type = 'button', ...rest }:
  ComponentProps<'button'> & { variant?: ButtonVariant }) {
  return (
    <button type={type} disabled={disabled} {...rest}
      className={`${buttonClass(variant, { disabled: !!disabled })}${className ? ` ${className}` : ''}`} />
  );
}

export function LinkButton({ variant = 'normal', className, ...rest }:
  ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link {...rest} className={`${buttonClass(variant)}${className ? ` ${className}` : ''}`} />;
}
