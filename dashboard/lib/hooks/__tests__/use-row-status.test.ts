import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { useRowStatus } from '../use-row-status';

const { supabaseStub, removeChannelMock, channelStub } = vi.hoisted(() => {
  const removeChannelMock = vi.fn();
  const channelStub = {
    on: vi.fn(function (this: unknown) { return this; }),
    subscribe: vi.fn(function (this: unknown) { return this; }),
  };
  const supabaseStub = {
    channel: vi.fn(() => channelStub),
    removeChannel: removeChannelMock,
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    })),
  };
  return { supabaseStub, removeChannelMock, channelStub };
});

vi.mock('@/lib/supabase/client', () => ({ createClient: () => supabaseStub }));

function Harness({ table, id, initial, column }: {
  table: 'scans' | 'analyses' | 'reports'; id: string; initial: string;
  column?: 'status' | 'gen_status';
}) {
  useRowStatus(table, id, initial, column);
  return null;
}

describe('useRowStatus 언마운트 정리 (리뷰 Minor)', () => {
  it('언마운트 시 Realtime 채널 구독 해제와 폴링 타이머 정리를 모두 수행한다', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = render(createElement(Harness, { table: 'scans', id: 's1', initial: 'uploaded' }));

    unmount();

    expect(removeChannelMock).toHaveBeenCalledTimes(1);
    expect(removeChannelMock).toHaveBeenCalledWith(channelStub);
    expect(clearIntervalSpy).toHaveBeenCalled();

    clearIntervalSpy.mockRestore();
  });
});

describe('useRowStatus 폴링 정지 (저비용 개선 m2)', () => {
  it('폴링으로 종결 상태(done/failed 등)를 감지하면 이후 폴링 요청을 멈춘다', async () => {
    supabaseStub.from.mockClear();
    supabaseStub.from.mockImplementationOnce(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { status: 'done' } }) }) }),
    }));
    vi.useFakeTimers();

    const { unmount } = render(createElement(Harness, { table: 'analyses', id: 'a1', initial: 'processing' }));

    await vi.advanceTimersByTimeAsync(5000); // 1차 폴링: status='done' 확인 -> clearInterval
    expect(supabaseStub.from).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15000); // 정지됐다면 이후 틱에서 추가 폴링 요청이 없어야 함
    expect(supabaseStub.from).toHaveBeenCalledTimes(1);

    unmount();
    vi.useRealTimers();
  });
});

describe('useRowStatus reports 폴링 유지 (저비용 개선 m1)', () => {
  it('reports는 종결 상태(done)를 감지해도 폴링을 멈추지 않는다(재생성이 되돌릴 수 있어서)', async () => {
    supabaseStub.from.mockClear();
    supabaseStub.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { gen_status: 'done' } }) }) }),
    }));
    vi.useFakeTimers();

    const { unmount } = render(
      createElement(Harness, { table: 'reports', id: 'r1', initial: 'processing', column: 'gen_status' }),
    );

    await vi.advanceTimersByTimeAsync(5000); // 1차 폴링: gen_status='done' 확인
    expect(supabaseStub.from).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15000); // scans·analyses였다면 멈췄을 구간 - reports는 계속 폴링해야 함
    expect(supabaseStub.from).toHaveBeenCalledTimes(4);

    unmount();
    vi.useRealTimers();
  });
});
