// 루트 404 화면(스펙 §4.2·§4.3): 전역 셸을 지운 뒤에는 notFound()(현장·스캔·정합·보고서 상세)와 알 수 없는
// 주소가 헤더도 돌아갈 길도 없는 Next 기본 404 로 떨어진다. 루트 not-found 가 진입 헤더(상표 + 계정 메뉴)와
// 현장 목록(/)으로 가는 링크를 그려 막다른 화면을 없앤다. not-found 는 async 서버 컴포넌트가 될 수 있다
// (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md "Data Fetching").
// async 라 render() 대신 await 로 얻은 엘리먼트를 그린다(다른 page 테스트와 같은 방식).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

// proxy 가 실어 주는 사용자 헤더(이메일은 인코딩해 싣는다 - lib/supabase/middleware.ts)
const { requestHeaders } = vi.hoisted(() => ({ requestHeaders: { current: {} as Record<string, string> } }));
vi.mock('next/headers', () => ({ headers: async () => new Headers(requestHeaders.current) }));
// 셸 헤더 내부는 components/shell 테스트가 맡는다 - 여기서는 넘긴 이메일만 본다.
vi.mock('@/components/shell/entry-header', () => ({
  EntryHeader: ({ email }: { email: string | null }) => <div data-testid="entry-header" data-email={email ?? ''} />,
}));

import NotFound, { metadata } from '../not-found';
import { LinkButton } from '@/components/ui/button';
import { MAIN_BG, PAGE_MAIN } from '@/components/ui/page';

type El = { type?: unknown; props: Record<string, unknown> };

function findAll(node: unknown, type: unknown, acc: El[] = []): El[] {
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, type, acc)); return acc; }
  const el = node as El;
  if (el.type === type) acc.push(el);
  findAll(el.props?.children, type, acc);
  return acc;
}

async function renderPage() {
  render((await NotFound()) as ReactElement);
}

beforeEach(() => {
  requestHeaders.current = {
    'x-flatness-user-id': 'u1', 'x-flatness-user-email': encodeURIComponent('u1@example.com'),
  };
});

describe('루트 404 (not-found)', () => {
  it('진입 헤더(상표 + 계정 메뉴)를 그리고 요청 사용자 이메일을 넘긴다', async () => {
    await renderPage();
    expect(screen.getByTestId('entry-header')).toHaveAttribute('data-email', 'u1@example.com');
  });

  it('요청 사용자 헤더가 없어도 진입 헤더를 그린다(이메일 없이)', async () => {
    requestHeaders.current = {};
    await renderPage();
    expect(screen.getByTestId('entry-header')).toHaveAttribute('data-email', '');
  });

  it('제목 "페이지를 찾을 수 없습니다"와 안내 한 줄, 현장 목록(/)으로 가는 링크가 있다', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 1, name: '페이지를 찾을 수 없습니다' })).toBeInTheDocument();
    expect(screen.getByText('주소가 바뀌었거나 지워진 화면입니다.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '현장 목록으로' })).toHaveAttribute('href', '/');
  });

  it('본문은 도면 격자 main(MAIN_BG) 하나 안의 본문 상자(PAGE_MAIN)이고 헤더는 그 앞에 온다', async () => {
    await renderPage();
    const mains = screen.getAllByRole('main');
    expect(mains).toHaveLength(1);
    expect(mains[0].className).toBe(MAIN_BG);
    expect((mains[0].firstElementChild as HTMLElement).className).toBe(PAGE_MAIN);
    expect(mains[0].previousElementSibling).toBe(screen.getByTestId('entry-header'));
  });

  it('"현장 목록으로"는 이 화면의 유일한 primary 버튼이다', async () => {
    const buttons = findAll(await NotFound(), LinkButton);
    expect(buttons.map((b) => [b.props.href, b.props.variant])).toEqual([['/', 'primary']]);
  });
});

describe('루트 404 <title>', () => {
  it('화면 이름은 "찾을 수 없음"이고 em dash 가 없다(스펙 §9)', () => {
    expect(metadata.title).toBe('찾을 수 없음');
    expect(JSON.stringify(metadata)).not.toContain('\u2014'); // em dash(U+2014)
  });
});
