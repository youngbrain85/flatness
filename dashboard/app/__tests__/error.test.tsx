// 루트 오류 화면(app/error.tsx): 처리하지 못한 렌더 오류가 헤더도 돌아갈 길도 없는 Next 기본 오류 화면으로
// 떨어지지 않게, 진입 헤더(상표 + 계정 메뉴)와 현장 목록(/)으로 가는 primary 링크, "다시 시도" 보조 버튼을 그린다.
// "다시 시도"는 unstable_retry(다시 받아 다시 그리기)를 부른다. reset 은 다시 받지 않고 다시 그리기만 해서 서버 렌더
// 오류에서는 같은 오류를 또 그린다(node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md
// "reset": 대부분은 unstable_retry 를 쓰라고 한다).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// 셸 헤더 내부는 components/shell 테스트가 맡는다 - 여기서는 넘긴 이메일만 본다(루트 404 테스트와 같은 방식).
vi.mock('@/components/shell/entry-header', () => ({
  EntryHeader: ({ email }: { email: string | null }) => <div data-testid="entry-header" data-email={email ?? ''} />,
}));

import RootError from '../error';
import { buttonClass } from '@/components/ui/button';
import { MAIN_BG, PAGE_MAIN } from '@/components/ui/page';

function renderError() {
  const reset = vi.fn();
  const unstableRetry = vi.fn();
  const view = render(<RootError error={new Error('boom')} reset={reset} unstable_retry={unstableRetry} />);
  return { ...view, reset, unstableRetry };
}

describe('루트 오류 화면 (app/error.tsx)', () => {
  it('진입 헤더를 이메일 없이 그리고, 본문은 도면 격자 main(MAIN_BG) 하나 안의 본문 상자(PAGE_MAIN)다', () => {
    renderError();
    const header = screen.getByTestId('entry-header');
    expect(header).toHaveAttribute('data-email', '');
    const mains = screen.getAllByRole('main');
    expect(mains).toHaveLength(1);
    expect(mains[0].className).toBe(MAIN_BG);
    expect((mains[0].firstElementChild as HTMLElement).className).toBe(PAGE_MAIN);
    expect(mains[0].previousElementSibling).toBe(header);
  });

  it('제목 "화면을 불러오지 못했습니다"와 안내 한 줄을 그리고 화면 글자에 em dash 가 없다', () => {
    const { container } = renderError();
    expect(screen.getByRole('heading', { level: 1, name: '화면을 불러오지 못했습니다' })).toBeInTheDocument();
    expect(screen.getByText('일시적인 문제일 수 있습니다. 다시 시도하거나 현장 목록으로 돌아가세요.')).toBeInTheDocument();
    expect(container.textContent).not.toContain('—'); // em dash(U+2014)
  });

  it('"현장 목록으로"는 /로 가는 이 화면의 유일한 primary, "다시 시도"는 보조 버튼이다', () => {
    const { container } = renderError();
    const home = screen.getByRole('link', { name: '현장 목록으로' });
    expect(home).toHaveAttribute('href', '/');
    expect(home.className).toBe(buttonClass('primary'));
    const retry = screen.getByRole('button', { name: '다시 시도' });
    expect(retry).toHaveAttribute('type', 'button');
    expect(retry.className).toBe(buttonClass('normal'));
    const primaries = Array.from(container.querySelectorAll('a, button'))
      .filter((el) => el.className === buttonClass('primary'));
    expect(primaries).toEqual([home]);
  });

  it('"다시 시도"를 누르면 unstable_retry 를 한 번 부르고 reset 은 부르지 않는다(다시 받아야 서버 오류가 풀린다)', () => {
    const { reset, unstableRetry } = renderError();
    expect(unstableRetry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(unstableRetry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });
});
