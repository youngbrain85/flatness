// Supabase 오류 알림: warning Alert(스펙 §4)로 갈아끼우되 문구는 그대로다(Free 일시정지 안내).
// 상세 메시지는 mono 12px 보조색.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SupabaseErrorNotice } from '../supabase-error';

describe('SupabaseErrorNotice', () => {
  it('warning Alert 안에 제목(700)·안내 문장·상세(mono 12px)를 그린다', () => {
    const { container } = render(<SupabaseErrorNotice message="fetch failed" />);
    const alert = container.querySelector('[data-alert="warning"]') as HTMLElement;
    expect(alert).not.toBeNull();
    expect(alert.className).toContain('border-cs-warning');
    expect(alert.className).toContain('bg-cs-warning-bg');
    expect(container.querySelector('[data-icon="alert-triangle"]')).toBeInTheDocument();

    expect(screen.getByText('Supabase 연결에 실패했습니다').className).toContain('font-bold');
    expect(screen.getByText(/Free 프로젝트는 7일 미사용 시 일시정지됩니다/)).toBeInTheDocument();
    expect(screen.getByText(/Restore\(재개\)한 뒤 새로고침하세요/)).toBeInTheDocument();
    expect(screen.getByText(/\.env\.local의 URL·anon key를 확인하세요/)).toBeInTheDocument();

    // '상세: ' + {message} 두 텍스트 노드를 getByText가 이어 붙여 비교한다
    const detail = screen.getByText('상세: fetch failed');
    expect(detail.className).toContain('font-mono');
    expect(detail.className).toContain('text-xs');
    expect(detail.className).toContain('text-cs-text-secondary');
  });

  it('옛 amber/zinc 클래스가 남아 있지 않다(T12 스윕 선반영)', () => {
    const { container } = render(<SupabaseErrorNotice message="x" />);
    expect(container.innerHTML).not.toMatch(/amber-|zinc-/);
  });
});
