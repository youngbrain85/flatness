// NewSiteCard(진입 페이지 새 현장 카드, 아트보드 EntrySearch "새 현장 등록"). 지난 새 현장 폼
// (components/__tests__/new-site-form.test.tsx)의 동작 단언 둘(push만·실패 안내)을 그대로 옮기고,
// 카드 해부·trim·공백 이름·중복 제출 방지·취소를 더한다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn(() => ({})) }));

import { createClient } from '@/lib/supabase/client';
import { buttonClass } from '@/components/ui/button';
import { NewSiteCard } from '../new-site-card';

type InsertResult = { data: { id: string } | null; error: { message: string } | null };

// sites insert -> select('id') -> single() 체인 흉내. insertSpy가 넣은 행을 기록한다.
function stubSupabase(result: InsertResult | Promise<InsertResult>, insertSpy?: (row: unknown) => void) {
  return {
    from: (table: string) => {
      if (table === 'sites') {
        return {
          insert: (row: unknown) => {
            insertSpy?.(row);
            return { select: () => ({ single: () => Promise.resolve(result) }) };
          },
        };
      }
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
  };
}

function renderCard(props: Partial<Parameters<typeof NewSiteCard>[0]> = {}) {
  return render(<NewSiteCard initialName="" onCancel={() => {}} {...props} />);
}
const nameInput = () => screen.getByLabelText('현장명 (필수)');
const submit = () => screen.getByRole('button', { name: '현장 등록' });

afterEach(() => {
  vi.clearAllMocks();
});

describe('NewSiteCard 동작 (지난 새 현장 폼에서 옮김)', () => {
  // 회귀 방지: push 직후 refresh는 진행 중이던 이동을 취소한다(로그인 화면에서 실제로
  // 재현된 결함). 이동 대상인 sites/[id]는 force-dynamic이고 동적 페이지의 클라이언트
  // 캐시 staleTime 기본값은 0초라 push만으로 항상 서버에서 새로 받아온다.
  it('현장 등록에 성공하면 새 현장의 대시보드로 push만 하고 refresh는 부르지 않는다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase({ data: { id: 's9' }, error: null }) as never);
    renderCard();

    fireEvent.change(nameInput(), { target: { value: '한밭대 본관' } });
    fireEvent.click(submit());

    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/sites/s9'));
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('저장에 실패하면 이동하지 않고 안내(role=alert, err 색)를 띄우며 버튼을 다시 쓸 수 있다', async () => {
    vi.mocked(createClient).mockReturnValue(
      stubSupabase({ data: null, error: { message: '중복된 현장명입니다' } }) as never,
    );
    renderCard();

    fireEvent.change(nameInput(), { target: { value: '중복' } });
    fireEvent.click(submit());

    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toBe('중복된 현장명입니다');
    expect(notice.className).toContain('text-err');
    expect(pushMock).not.toHaveBeenCalled();
    expect(submit()).not.toBeDisabled();
  });
});

describe('NewSiteCard 입력 정리와 검증', () => {
  it('trim한 값으로 insert하고, 빈 주소·메모는 null로 보낸다', async () => {
    const insertSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase({ data: { id: 's9' }, error: null }, insertSpy) as never);
    renderCard();

    fireEvent.change(nameInput(), { target: { value: '  한밭대 본관 ' } });
    fireEvent.change(screen.getByLabelText('주소'), { target: { value: ' 대전 유성구 ' } });
    fireEvent.change(screen.getByLabelText('메모'), { target: { value: '   ' } });
    fireEvent.click(submit());

    await vi.waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(insertSpy).toHaveBeenCalledWith({ name: '한밭대 본관', address: '대전 유성구', memo: null });
  });

  it('공백만 넣은 현장명은 저장하지 않고 "현장명을 입력하세요."를 띄운다', () => {
    renderCard();

    fireEvent.change(nameInput(), { target: { value: '   ' } });
    fireEvent.click(submit());

    expect(screen.getByRole('alert').textContent).toBe('현장명을 입력하세요.');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('저장 중에는 "현장 등록"이 비활성이라 두 번 눌러도 insert는 한 번이다', async () => {
    let resolveInsert!: (r: InsertResult) => void;
    const pending = new Promise<InsertResult>((r) => { resolveInsert = r; });
    const insertSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(pending, insertSpy) as never);
    renderCard();

    fireEvent.change(nameInput(), { target: { value: '한밭대 본관' } });
    fireEvent.click(submit());
    fireEvent.click(submit());

    expect(submit()).toBeDisabled();
    expect(insertSpy).toHaveBeenCalledTimes(1);
    resolveInsert({ data: { id: 's9' }, error: null });
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/sites/s9'));
  });
});

describe('NewSiteCard 해부 (아트보드 EntrySearch "새 현장 등록")', () => {
  it('제목 "새 현장 등록"의 영역(id newSiteCard)에 필드 셋 · 보조 "취소" · 주 "현장 등록"(plus 아이콘)', () => {
    const { container } = renderCard();
    const card = screen.getByRole('region', { name: '새 현장 등록' });
    expect(card).toHaveAttribute('id', 'newSiteCard');
    expect(nameInput()).toBeRequired();
    expect(screen.getByLabelText('주소')).not.toBeRequired();
    expect(screen.getByLabelText('메모').tagName).toBe('TEXTAREA');
    expect(submit().className).toContain(buttonClass('primary'));
    expect(screen.getByRole('button', { name: '취소' }).className).toContain(buttonClass('normal'));
    expect(container.querySelector('[data-icon="plus"]')).toBeInTheDocument();
  });

  it('initialName을 현장명 칸에 미리 넣는다(검색 결과 0건에서 연 카드)', () => {
    renderCard({ initialName: '한밭대 본관' });
    expect((nameInput() as HTMLInputElement).value).toBe('한밭대 본관');
  });

  it('"취소"는 onCancel을 부르고 저장하지 않는다', () => {
    const onCancel = vi.fn();
    renderCard({ onCancel });
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(createClient).not.toHaveBeenCalled();
  });
});
