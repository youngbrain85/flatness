// 현장 사진 갤러리: 4열 그리드 figure 카드 + 128px 이미지/자리표시자 + 12px 캡션(아트보드 SiteDetail).
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
// 서명 URL 조회는 네트워크라 null로 고정한다 - 자리표시자 분기를 본다.
vi.mock('@/lib/photos/upload', () => ({ photoUrl: vi.fn(async () => null) }));

import { PhotoGallery } from '../photo-gallery';
import type { PhotoRow } from '@/lib/domain/types';

const photo = (id: string, caption: string | null): PhotoRow => ({
  id, scan_id: null, location_id: null, site_id: 's1', file_path: `${id}.jpg`, caption, taken_at: null, created_at: '',
});

describe('PhotoGallery (Cloudscape 재스킨)', () => {
  it('사진이 없으면 보조색 안내 문구를 그린다', () => {
    render(<PhotoGallery photos={[]} />);
    expect(screen.getByText('등록된 사진이 없습니다.').className).toContain('text-cs-text-secondary');
  });

  it('figure 카드(1px cs-divider, 8px 라운드) + 128px 자리표시자 + 12px 캡션, md 이상 4열', () => {
    const { container } = render(<PhotoGallery photos={[photo('p1', '현장 전경'), photo('p2', null)]} />);
    expect(container.querySelector('.grid')?.className).toContain('md:grid-cols-4');
    const figures = container.querySelectorAll('figure');
    expect(figures).toHaveLength(2);
    expect(figures[0].className).toContain('border-cs-divider');
    expect(figures[0].className).toContain('rounded-lg');
    const placeholder = figures[0].firstElementChild as HTMLElement;
    expect(placeholder.className).toContain('h-32');
    expect(placeholder.className).toContain('bg-cs-divider');
    const caption = screen.getByText('현장 전경');
    expect(caption.tagName).toBe('FIGCAPTION');
    expect(caption.className).toContain('text-xs');
  });
});
