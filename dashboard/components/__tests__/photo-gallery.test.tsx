// 현장 사진 갤러리(아트보드 SiteDetail '현장 사진'): 260px 이상 칸 자동 채움 + figure 카드 +
// 128px 검정 사진 칸(사진을 못 받았으면 사진 아이콘) + 13px 캡션.
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
// 서명 URL 조회는 네트워크라 목으로 고정한다(기본: 못 받음 = null).
vi.mock('@/lib/photos/upload', () => ({ photoUrl: vi.fn(async () => null) }));

import { photoUrl } from '@/lib/photos/upload';
import { PhotoGallery } from '../photo-gallery';
import type { PhotoRow } from '@/lib/domain/types';

const photo = (id: string, caption: string | null): PhotoRow => ({
  id, scan_id: null, location_id: null, site_id: 's1', file_path: `${id}.jpg`, caption, taken_at: null, created_at: '',
});

describe('PhotoGallery (다크 C안)', () => {
  it('사진이 없으면 안내 문구를 그린다', () => {
    render(<PhotoGallery photos={[]} />);
    expect(screen.getByText('등록된 사진이 없습니다.').className).toContain('text-muted');
  });

  it('figure 카드(ground · line-2 · 12px) + 128px 검정 사진 칸(아직 없으면 사진 아이콘) + 13px 캡션', () => {
    const { container } = render(<PhotoGallery photos={[photo('p1', '현장 전경'), photo('p2', null)]} />);
    expect(container.firstElementChild?.className).toContain('grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))]');
    const figures = container.querySelectorAll('figure');
    expect(figures).toHaveLength(2);
    expect(figures[0].className).toContain('bg-ground');
    expect(figures[0].className).toContain('border-line-2');
    expect(figures[0].className).toContain('rounded-card');
    const slot = figures[0].firstElementChild as HTMLElement;
    expect(slot.className).toContain('h-32');
    expect(slot.className).toContain('bg-stage');
    expect(slot.querySelector('[data-icon="photo"]')).not.toBeNull();
    const caption = screen.getByText('현장 전경');
    expect(caption.tagName).toBe('FIGCAPTION');
    expect(caption.className).toContain('text-ink-2');
    // 캡션이 없는 사진은 figcaption 을 그리지 않는다
    expect(figures[1].querySelector('figcaption')).toBeNull();
  });

  it('서명 URL을 받으면 그 사진을 캡션 alt로 그린다', async () => {
    vi.mocked(photoUrl).mockImplementation(async (_s, path) => (path === 'p1.jpg' ? 'https://example.test/p1.jpg' : null));
    render(<PhotoGallery photos={[photo('p1', '현장 전경')]} />);

    const img = await screen.findByRole('img', { name: '현장 전경' });
    expect(img).toHaveAttribute('src', 'https://example.test/p1.jpg');
  });

  it('캡션이 없는 사진은 alt를 "현장 사진"으로 그린다', async () => {
    vi.mocked(photoUrl).mockImplementation(async () => 'https://example.test/x.jpg');
    render(<PhotoGallery photos={[photo('p1', null)]} />);

    expect(await screen.findByRole('img', { name: '현장 사진' })).toHaveAttribute('src', 'https://example.test/x.jpg');
  });

  // 업로드 뒤 router.refresh()로 사진 목록이 늘어나면 새 사진의 서명 URL도 받아 그린다(effect 의존성 [photos]).
  it('사진이 늘어나면 새 사진의 서명 URL도 받아 그린다', async () => {
    vi.mocked(photoUrl).mockImplementation(async (_s, path) => `https://example.test/${path}`);
    const { rerender } = render(<PhotoGallery photos={[photo('p1', '첫 사진')]} />);
    expect(await screen.findByRole('img', { name: '첫 사진' })).toBeInTheDocument();

    rerender(<PhotoGallery photos={[photo('p1', '첫 사진'), photo('p2', '새 사진')]} />);

    expect(await screen.findByRole('img', { name: '새 사진' })).toHaveAttribute('src', 'https://example.test/p2.jpg');
  });

  // cancelled 가드: 옛 목록의 서명 URL 응답이 늦게 와도 그 사이 바뀐 목록의 URL을 덮어쓰지 않는다.
  it('늦게 도착한 옛 응답은 새 사진 목록의 URL을 덮어쓰지 않는다', async () => {
    let releaseOld: (url: string | null) => void = () => {};
    vi.mocked(photoUrl).mockImplementation((_s, path) => (path === 'old.jpg'
      ? new Promise<string | null>((resolve) => { releaseOld = resolve; })
      : Promise.resolve(`https://example.test/${path}`)));
    const { rerender } = render(<PhotoGallery photos={[photo('old', '옛 사진')]} />);
    rerender(<PhotoGallery photos={[photo('new', '새 사진')]} />);
    expect(await screen.findByRole('img', { name: '새 사진' })).toBeInTheDocument();

    await act(async () => {
      releaseOld('https://example.test/old.jpg');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByRole('img', { name: '새 사진' })).toBeInTheDocument();
  });
});
