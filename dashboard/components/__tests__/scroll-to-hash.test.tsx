// 대시보드 타일(/sites/{id}/locations#loc-{id})로 클라이언트 이동했을 때 해당 측정위치 카드로 스크롤한다.
// Next 의 해시 스크롤은 loading.tsx 화면에서 한 번뿐인 기회를 써 버린다(components/scroll-to-hash.tsx 주석).
// jsdom 에는 Element.scrollIntoView 가 없어서 프로토타입에 스텁을 건다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ScrollToHash } from '../scroll-to-hash';

describe('ScrollToHash', () => {
  const scrollIntoView = vi.fn();
  const added: HTMLElement[] = [];

  function addTarget(id: string) {
    const el = document.createElement('li');
    el.id = id;
    document.body.appendChild(el);
    added.push(el);
    return el;
  }

  beforeEach(() => {
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    window.location.hash = '';
    added.splice(0).forEach((el) => el.remove());
    scrollIntoView.mockClear();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('주소 끝 #loc-<id>와 같은 id의 요소로 스크롤한다', () => {
    const target = addTarget('loc-l1');
    window.location.hash = '#loc-l1';

    render(<ScrollToHash />);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(target);
  });

  it('퍼센트 인코딩된 해시는 풀어서 같은 id의 요소를 찾는다', () => {
    const target = addTarget('loc-가나');
    window.location.hash = `#${encodeURIComponent('loc-가나')}`;

    render(<ScrollToHash />);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(target);
  });

  it('해시가 없으면 아무것도 하지 않는다', () => {
    addTarget('loc-l1');

    expect(() => render(<ScrollToHash />)).not.toThrow();

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('해시의 요소가 화면에 없으면 아무것도 하지 않는다', () => {
    window.location.hash = '#loc-없음';

    expect(() => render(<ScrollToHash />)).not.toThrow();

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('짝이 안 맞는 % 인코딩이어도 던지지 않고 원문 그대로 같은 id의 요소를 찾는다', () => {
    const target = addTarget('loc-%E0%A4%A');
    window.location.hash = '#loc-%E0%A4%A';

    expect(() => render(<ScrollToHash />)).not.toThrow();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(target);
  });

  it('마운트할 때 한 번만 스크롤한다(다시 그려도 반복하지 않는다)', () => {
    addTarget('loc-l1');
    window.location.hash = '#loc-l1';

    const { rerender } = render(<ScrollToHash />);
    rerender(<ScrollToHash />);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
