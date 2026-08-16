// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useEscapeKey } from '../use-escape-key';

describe('useEscapeKey', () => {
  it('calls the callback when Escape is pressed', () => {
    const callback = vi.fn();
    renderHook(() => {
      useEscapeKey(callback);
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(callback).toHaveBeenCalledOnce();
  });

  it('does not call the callback for other keys', () => {
    const callback = vi.fn();
    renderHook(() => {
      useEscapeKey(callback);
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

    expect(callback).not.toHaveBeenCalled();
  });

  it('removes listener on unmount', () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() => {
      useEscapeKey(callback);
    });

    unmount();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(callback).not.toHaveBeenCalled();
  });

  it('updates the callback reference', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ cb }) => {
        useEscapeKey(cb);
      },
      {
        initialProps: { cb: first },
      },
    );

    rerender({ cb: second });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
