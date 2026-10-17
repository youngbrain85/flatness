// 사진 업로더(아트보드 SiteDetail '현장 사진'): 설명 입력 + '사진 추가' 보조 버튼 모양 label이
// 키보드로 닿는(sr-only) 파일 입력을 연다. 업로드 로직(uploadPhoto 호출·캡션·오류)은 그대로다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/photos/upload', () => ({ uploadPhoto: vi.fn() }));

import { uploadPhoto } from '@/lib/photos/upload';
import { PhotoUploader } from '../photo-uploader';
import { buttonClass } from '@/components/ui/button';
import { inputClass } from '@/components/ui/form';

afterEach(() => {
  vi.clearAllMocks();
});

describe('PhotoUploader (다크 C안)', () => {
  it('설명 입력은 이름 있는 입력칸(360px 상한), "사진 추가"는 보조 버튼 모양 label + upload 아이콘', () => {
    const { container } = render(<PhotoUploader target={{ site_id: 's1' }} onUploaded={() => {}} />);
    const caption = screen.getByRole('textbox', { name: '사진 설명(선택)' });
    expect(caption.className).toContain(inputClass);
    expect(caption.className).toContain('max-w-[360px]');
    const add = screen.getByText('사진 추가');
    expect(add.tagName).toBe('LABEL');
    expect(add.className).toContain(buttonClass('normal'));
    expect(add.querySelector('[data-icon="upload"]')).not.toBeNull();
    const file = container.querySelector('input[type="file"]') as HTMLInputElement;
    // display:none(hidden)이면 Tab으로 닿지 않는다 - 화면에서만 감춘다
    expect(file.className).toContain('sr-only');
    expect(file.className).not.toContain('hidden');
    expect(file.accept).toBe('image/jpeg,image/png,image/webp');
  });

  it('파일을 고르면 설명과 함께 올리고 onUploaded를 부른 뒤 설명칸을 비운다', async () => {
    vi.mocked(uploadPhoto).mockResolvedValue({} as never);
    const onUploaded = vi.fn();
    const { container } = render(<PhotoUploader target={{ site_id: 's1' }} onUploaded={onUploaded} />);
    fireEvent.change(screen.getByRole('textbox', { name: '사진 설명(선택)' }), { target: { value: '현장 전경' } });
    const pic = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [pic] } });

    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(uploadPhoto).toHaveBeenCalledWith(expect.anything(), pic, { site_id: 's1' }, '현장 전경');
    expect(screen.getByRole('textbox', { name: '사진 설명(선택)' })).toHaveValue('');
  });

  it('업로드가 실패하면 원인을 경고(role=alert)로 보인다', async () => {
    vi.mocked(uploadPhoto).mockRejectedValue(new Error('지원하지 않는 이미지 형식입니다 (jpg/jpeg/png/webp)'));
    const { container } = render(<PhotoUploader target={{ site_id: 's1' }} onUploaded={() => {}} />);
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] } });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('지원하지 않는 이미지 형식입니다');
    expect(alert.className).toContain('text-err');
  });
});
