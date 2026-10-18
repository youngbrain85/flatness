// Supabase 오류 알림: 경고 Alert(스펙 §6: 경고 = warn 테두리)로 그리되 문구는 그대로다(Free 일시정지 안내).
// 상세 메시지는 mono 12px muted.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SupabaseErrorNotice } from '../supabase-error';

describe('SupabaseErrorNotice', () => {
  it('경고 Alert 안에 제목·안내 문장·상세(mono 12px muted)를 그린다', () => {
    const { container } = render(<SupabaseErrorNotice message="fetch failed" />);
    const alert = container.querySelector('[data-alert="warning"]') as HTMLElement;
    expect(alert).not.toBeNull();
    expect(alert).toHaveTextContent('Supabase 연결에 실패했습니다');
    expect(screen.getByText(/Free 프로젝트는 7일 미사용 시 일시정지됩니다/)).toBeInTheDocument();
    expect(screen.getByText(/Restore\(재개\)한 뒤 새로고침하세요/)).toBeInTheDocument();
    expect(screen.getByText(/\.env\.local의 URL·anon key를 확인하세요/)).toBeInTheDocument();

    // '상세: ' + {message} 두 텍스트 노드를 getByText가 이어 붙여 비교한다
    const detail = screen.getByText('상세: fetch failed');
    expect(alert.contains(detail)).toBe(true);
    for (const c of ['font-mono', 'text-xs', 'text-muted']) expect(detail.className).toContain(c);
  });

  it('옛 cs-·amber·zinc 클래스가 남아 있지 않다', () => {
    const { container } = render(<SupabaseErrorNotice message="x" />);
    expect(container.innerHTML).not.toMatch(/cs-|amber-|zinc-/);
  });
});
