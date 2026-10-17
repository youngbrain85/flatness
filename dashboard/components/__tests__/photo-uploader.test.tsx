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

  it('설명을 비워 두면 caption 없이(undefined) 올린다', async () => {
    vi.mocked(uploadPhoto).mockResolvedValue({} as never);
    const onUploaded = vi.fn();
    const { container } = render(<PhotoUploader target={{ site_id: 's1' }} onUploaded={onUploaded} />);
    const pic = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [pic] } });

    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(uploadPhoto).toHaveBeenCalledWith(expect.anything(), pic, { site_id: 's1' }, undefined);
  });

  it('파일을 고르지 않고 창을 닫으면 아무것도 올리지 않는다', () => {
    const { container } = render(<PhotoUploader target={{ site_id: 's1' }} onUploaded={() => {}} />);
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [] } });

    expect(uploadPhoto).not.toHaveBeenCalled();
    expect(screen.getByText('사진 추가')).toBeInTheDocument();
  });

  it('Error가 아닌 값으로 실패하면 기본 문구를 경고로 보인다', async () => {
    vi.mocked(uploadPhoto).mockRejectedValue('boom');
    const { container } = render(<PhotoUploader target={{ site_id: 's1' }} onUploaded={() => {}} />);
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } });

    expect((await screen.findByRole('alert')).textContent).toBe('사진 업로드에 실패했습니다');
  });

  it('다시 올리기 시작하면 앞의 오류 안내를 지운다', async () => {
    vi.mocked(uploadPhoto).mockRejectedValueOnce(new Error('첫 실패')).mockResolvedValueOnce({} as never);
    const onUploaded = vi.fn();
    const { container } = render(<PhotoUploader target={{ site_id: 's1' }} onUploaded={onUploaded} />);
    const file = container.querySelector('input[type="file"]')!;
    const pic = new File(['x'], 'a.jpg', { type: 'image/jpeg' });

    fireEvent.change(file, { target: { files: [pic] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('첫 실패');
    fireEvent.change(file, { target: { files: [pic] } });

    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('올리는 동안에는 "업로드 중..."으로 바뀌고 파일 입력이 잠긴다', async () => {
    let finish: () => void = () => {};
    vi.mocked(uploadPhoto).mockImplementation(() => new Promise<never>((resolve) => { finish = () => resolve({} as never); }));
    const { container } = render(<PhotoUploader target={{ site_id: 's1' }} onUploaded={() => {}} />);
    const file = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(file, { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } });

    const busy = await screen.findByText('업로드 중...');
    expect(busy.tagName).toBe('LABEL');
    expect(busy.className).toContain(buttonClass('normal', { disabled: true }));
    expect(file).toBeDisabled();

    finish();
    expect(await screen.findByText('사진 추가')).toBeInTheDocument();
    expect(file).not.toBeDisabled();
  });

  // 실패한 뒤 같은 파일을 다시 고르면 브라우저는 값이 그대로라 change 를 보내지 않는다 - 끝날 때마다 값을 비운다.
  it('끝나면(실패해도) 같은 파일을 다시 골라도 change가 오도록 파일 입력 값을 비운다', async () => {
    vi.mocked(uploadPhoto).mockRejectedValue(new Error('실패'));
    const { container } = render(<PhotoUploader target={{ site_id: 's1' }} onUploaded={() => {}} />);
    const file = container.querySelector('input[type="file"]') as HTMLInputElement;
    const assigned = vi.fn();
    Object.defineProperty(file, 'value', { configurable: true, get: () => '', set: assigned });
    fireEvent.change(file, { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } });

    await screen.findByRole('alert');
    expect(assigned).toHaveBeenCalledWith('');
  });

  it('숨은 파일 입력이 포커스를 받으면 label 에 외곽선이 보인다(has-[:focus-visible])', () => {
    render(<PhotoUploader target={{ site_id: 's1' }} onUploaded={() => {}} />);
    const add = screen.getByText('사진 추가');
    // sr-only 입력은 포커스 테두리가 보이지 않는다 - 전역 :focus-visible 규칙의 유일한 예외로 label 이 외곽선을 그린다
    expect(add.className).toContain('has-[:focus-visible]:outline-2');
    expect(add.className).toContain('has-[:focus-visible]:outline-offset-2');
    expect(add.className).toContain('has-[:focus-visible]:outline-ink');
  });
});
