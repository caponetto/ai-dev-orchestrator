// @vitest-environment jsdom
import { toast } from 'sonner';
import { describe, expect, it, vi } from 'vitest';

import { showError, showInfo, showSuccess } from '../toast';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('showSuccess', () => {
  it('calls toast.success with the message', () => {
    showSuccess('Operation completed');
    expect(toast.success).toHaveBeenCalledWith('Operation completed');
  });
});

describe('showError', () => {
  it('calls toast.error with the message', () => {
    showError('Something went wrong');
    expect(toast.error).toHaveBeenCalledWith('Something went wrong');
  });
});

describe('showInfo', () => {
  it('calls toast.info with the message', () => {
    showInfo('FYI');
    expect(toast.info).toHaveBeenCalledWith('FYI');
  });
});
