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

function Harness({ table, id, initial }: { table: 'scans' | 'analyses'; id: string; initial: string }) {
  useRowStatus(table, id, initial);
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
