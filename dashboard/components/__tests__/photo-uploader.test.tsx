// 사진 업로더: 설명 입력(inputClass, 360px 상한) + '사진 추가' normal 알약(label이 숨은 file input을 연다).
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/photos/upload', () => ({ uploadPhoto: vi.fn() }));

import { PhotoUploader } from '../photo-uploader';

describe('PhotoUploader (Cloudscape 재스킨)', () => {
  it('설명 입력은 inputClass(360px 상한), "사진 추가"는 normal 버튼 + upload 아이콘, 파일 입력은 숨김', () => {
    const { container } = render(<PhotoUploader target={{ site_id: 's1' }} onUploaded={() => {}} />);
    const caption = screen.getByPlaceholderText('사진 설명(선택)');
    expect(caption.className).toContain('border-cs-input-border');
    expect(caption.className).toContain('max-w-[360px]');
    const add = screen.getByText('사진 추가');
    expect(add.tagName).toBe('LABEL');
    expect(add.className).toContain('border-cs-link');
    expect(add.className).toContain('rounded-full');
    expect(container.querySelector('[data-icon="upload"]')).toBeInTheDocument();
    const file = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(file.className).toContain('hidden');
    expect(file.accept).toBe('image/jpeg,image/png,image/webp');
  });
});
