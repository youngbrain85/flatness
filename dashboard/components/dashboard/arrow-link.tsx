// 대시보드의 글자 링크(아트보드 DashStatus의 "열기" · "측정위치 전체 보기" · "보고서 전체 보기"):
// 밑줄(dim) + 오른쪽 chevron, 터치 대상 44px. 버튼이 아니라 이동이므로 <a>(Link)다.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/icons';

export function ArrowLink({ href, label, className, children }: {
  href: string;
  // 화면 글자만으로 대상이 모호할 때(줄마다 "열기") 읽을 이름
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} aria-label={label}
      className={'inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-ink underline decoration-dim underline-offset-4' + (className ? ` ${className}` : '')}>
      {children}
      <Icon name="chevron-right" size={14} className="text-dim" />
    </Link>
  );
}
