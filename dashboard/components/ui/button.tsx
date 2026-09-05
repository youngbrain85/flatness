// Cloudscape 버튼 해부: 32px 알약, 2px 보더, 700. primary(파랑 채움) / normal(파랑 보더).
// 뷰당 primary는 하나 - 나머지 액션은 normal.
import Link from 'next/link';
import type { ComponentProps } from 'react';

export type ButtonVariant = 'primary' | 'normal';

const BASE = 'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border-2 px-5 text-sm font-bold transition-colors';
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'border-cs-link bg-cs-link text-white hover:border-cs-link-hover hover:bg-cs-link-hover',
  normal: 'border-cs-link bg-transparent text-cs-link hover:bg-cs-info-bg',
};
const DISABLED = 'cursor-not-allowed border-cs-disabled bg-transparent text-cs-disabled';

export function buttonClass(variant: ButtonVariant = 'normal', opts: { disabled?: boolean; full?: boolean } = {}): string {
  return [BASE, opts.disabled ? DISABLED : VARIANT[variant], opts.full ? 'w-full' : ''].filter(Boolean).join(' ');
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
