// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '../../test/render';
import { AbortDialog, RerunDialog, RetryDialog } from '../run-header-dialogs';
import type { RerunContext } from '../run-header-dialogs';

const { mockAbort, mockRetry, mockCreateRun, mockShowError, mockShowSuccess } = vi.hoisted(() => ({
  mockAbort: vi.fn(),
  mockRetry: vi.fn(),
  mockCreateRun: vi.fn(),
  mockShowError: vi.fn(),
  mockShowSuccess: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: {
    abort: mockAbort,
    retry: mockRetry,
    createRun: mockCreateRun,
  },
}));

vi.mock('../../lib/toast', () => ({
  showError: mockShowError,
  showSuccess: mockShowSuccess,
}));

beforeEach(() => {
  mockAbort.mockReset();
  mockRetry.mockReset();
  mockCreateRun.mockReset();
  mockShowError.mockReset();
  mockShowSuccess.mockReset();
});

describe('AbortDialog', () => {
  const defaultProps = {
    runId: 'run-123',
    open: true,
    onOpenChange: vi.fn(),
    onAborted: vi.fn(),
  };

  beforeEach(() => {
    defaultProps.onOpenChange.mockReset();
    defaultProps.onAborted.mockReset();
  });

  it('renders title and description when open', () => {
    renderWithRouter(<AbortDialog {...defaultProps} />);

    expect(screen.getByRole('heading', { name: 'Abort Run' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Provide an optional reason for aborting this run. This will appear in the chat log.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("e.g. Plan doesn't address the security requirements"),
    ).toBeInTheDocument();
  });

  it('renders nothing visible when closed', () => {
    renderWithRouter(<AbortDialog {...defaultProps} open={false} />);

    expect(screen.queryByText('Abort Run')).not.toBeInTheDocument();
  });

  it('calls onOpenChange(false) when Cancel is clicked', () => {
    renderWithRouter(<AbortDialog {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls api.abort and handles success with no reason', async () => {
    mockAbort.mockResolvedValue({ success: true });

    renderWithRouter(<AbortDialog {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Abort Run' }));

    await waitFor(() => {
      expect(mockAbort).toHaveBeenCalledWith('run-123', undefined);
    });

    expect(mockShowSuccess).toHaveBeenCalledWith('Run aborted');
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
    expect(defaultProps.onAborted).toHaveBeenCalled();
  });

  it('calls api.abort with a custom reason', async () => {
    mockAbort.mockResolvedValue({ success: true });

    renderWithRouter(<AbortDialog {...defaultProps} />);

    fireEvent.change(
      screen.getByPlaceholderText("e.g. Plan doesn't address the security requirements"),
      { target: { value: 'Bad plan' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Abort Run' }));

    await waitFor(() => {
      expect(mockAbort).toHaveBeenCalledWith('run-123', 'Bad plan');
    });

    expect(mockShowSuccess).toHaveBeenCalledWith('Run aborted');
    expect(defaultProps.onAborted).toHaveBeenCalled();
  });

  it('shows error when API returns success=false', async () => {
    mockAbort.mockResolvedValue({ success: false, error: 'Run not found' });

    renderWithRouter(<AbortDialog {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Abort Run' }));

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Run not found');
    });

    expect(mockShowSuccess).not.toHaveBeenCalled();
    expect(defaultProps.onAborted).not.toHaveBeenCalled();
  });

  it('shows default error when API returns success=false with no error message', async () => {
    mockAbort.mockResolvedValue({ success: false });

    renderWithRouter(<AbortDialog {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Abort Run' }));

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Abort failed');
    });
  });

  it('shows error message when API throws an Error', async () => {
    mockAbort.mockRejectedValue(new Error('Network down'));

    renderWithRouter(<AbortDialog {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Abort Run' }));

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Network down');
    });

    expect(defaultProps.onAborted).not.toHaveBeenCalled();
  });

  it('shows generic error when API throws a non-Error', async () => {
    mockAbort.mockRejectedValue('something broke');

    renderWithRouter(<AbortDialog {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Abort Run' }));

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Abort request failed');
    });
  });
});

describe('RetryDialog', () => {
  const defaultProps = {
    runId: 'run-456',
    open: true,
    onOpenChange: vi.fn(),
    onRetried: vi.fn(),
  };

  beforeEach(() => {
    defaultProps.onOpenChange.mockReset();
    defaultProps.onRetried.mockReset();
  });

  it('renders title and description when open', () => {
    renderWithRouter(<RetryDialog {...defaultProps} />);

    expect(screen.getByRole('heading', { name: 'Retry Run' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'This will re-run the workflow from the state that caused the failure, carrying over all prior artifacts and progress.',
      ),
    ).toBeInTheDocument();
  });

  it('renders nothing visible when closed', () => {
    renderWithRouter(<RetryDialog {...defaultProps} open={false} />);

    expect(screen.queryByText('Retry Run')).not.toBeInTheDocument();
  });

  it('calls onOpenChange(false) when Cancel is clicked', () => {
    renderWithRouter(<RetryDialog {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls api.retry and handles success', async () => {
    mockRetry.mockResolvedValue({ success: true });

    renderWithRouter(<RetryDialog {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry Run' }));

    await waitFor(() => {
      expect(mockRetry).toHaveBeenCalledWith('run-456');
    });

    expect(mockShowSuccess).toHaveBeenCalledWith('Run retried');
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
    expect(defaultProps.onRetried).toHaveBeenCalled();
  });

  it('shows error when API returns success=false', async () => {
    mockRetry.mockResolvedValue({ success: false, error: 'Cannot retry' });

    renderWithRouter(<RetryDialog {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry Run' }));

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Cannot retry');
    });

    expect(mockShowSuccess).not.toHaveBeenCalled();
    expect(defaultProps.onRetried).not.toHaveBeenCalled();
  });

  it('shows default error when API returns success=false with no error message', async () => {
    mockRetry.mockResolvedValue({ success: false });

    renderWithRouter(<RetryDialog {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry Run' }));

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Retry failed');
    });
  });

  it('shows error message when API throws an Error', async () => {
    mockRetry.mockRejectedValue(new Error('Server error'));

    renderWithRouter(<RetryDialog {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry Run' }));

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Server error');
    });

    expect(defaultProps.onRetried).not.toHaveBeenCalled();
  });

  it('shows generic error when API throws a non-Error', async () => {
    mockRetry.mockRejectedValue(42);

    renderWithRouter(<RetryDialog {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry Run' }));

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Retry request failed');
    });
  });
});

describe('RerunDialog', () => {
  const baseContext: RerunContext = {
    prompt: 'Fix the login bug',
    workflow: 'default-workflow',
    repoRoot: '/home/user/project',
  };

  const defaultProps = {
    context: baseContext,
    open: true,
    onOpenChange: vi.fn(),
    onRerun: vi.fn(),
  };

  beforeEach(() => {
    defaultProps.onOpenChange.mockReset();
    defaultProps.onRerun.mockReset();
  });

  it('renders title, prompt, workflow, and context when open', () => {
    renderWithRouter(<RerunDialog {...defaultProps} />);

    expect(screen.getByText('Rerun Workflow')).toBeInTheDocument();
    expect(
      screen.getByText('This will start a new run with the same prompt, workflow, and context.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Fix the login bug')).toBeInTheDocument();
    expect(screen.getByText('default-workflow')).toBeInTheDocument();
    expect(screen.getByText('/home/user/project')).toBeInTheDocument();
  });

  it('truncates prompts longer than 120 characters', () => {
    const longPrompt = 'A'.repeat(150);
    const truncated = `${'A'.repeat(120)}…`;

    renderWithRouter(
      <RerunDialog {...defaultProps} context={{ ...baseContext, prompt: longPrompt }} />,
    );

    expect(screen.getByText(truncated)).toBeInTheDocument();
    expect(screen.queryByText(longPrompt)).not.toBeInTheDocument();
  });

  it('does not truncate prompts of exactly 120 characters', () => {
    const exactPrompt = 'B'.repeat(120);

    renderWithRouter(
      <RerunDialog {...defaultProps} context={{ ...baseContext, prompt: exactPrompt }} />,
    );

    expect(screen.getByText(exactPrompt)).toBeInTheDocument();
  });

  it('hides workflow when not provided', () => {
    renderWithRouter(<RerunDialog {...defaultProps} context={{ prompt: 'Short prompt' }} />);

    expect(screen.getByText('Prompt:')).toBeInTheDocument();
    expect(screen.queryByText('Workflow:')).not.toBeInTheDocument();
    expect(screen.queryByText('Context:')).not.toBeInTheDocument();
  });

  it('hides context when not provided', () => {
    renderWithRouter(
      <RerunDialog {...defaultProps} context={{ prompt: 'Short prompt', workflow: 'wf' }} />,
    );

    expect(screen.getByText('Workflow:')).toBeInTheDocument();
    expect(screen.queryByText('Context:')).not.toBeInTheDocument();
  });

  it('renders nothing visible when closed', () => {
    renderWithRouter(<RerunDialog {...defaultProps} open={false} />);

    expect(screen.queryByText('Rerun Workflow')).not.toBeInTheDocument();
  });

  it('calls onOpenChange(false) when Cancel is clicked', () => {
    renderWithRouter(<RerunDialog {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls api.createRun with correct params and handles success', async () => {
    mockCreateRun.mockResolvedValue({ success: true });

    renderWithRouter(<RerunDialog {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rerun' }));

    await waitFor(() => {
      expect(mockCreateRun).toHaveBeenCalledWith(
        'Fix the login bug',
        'default-workflow',
        '/home/user/project',
      );
    });

    expect(mockShowSuccess).toHaveBeenCalledWith('New run started');
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
    expect(defaultProps.onRerun).toHaveBeenCalled();
  });

  it('calls api.createRun with undefined for missing optional params', async () => {
    mockCreateRun.mockResolvedValue({ success: true });

    renderWithRouter(<RerunDialog {...defaultProps} context={{ prompt: 'Just a prompt' }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rerun' }));

    await waitFor(() => {
      expect(mockCreateRun).toHaveBeenCalledWith('Just a prompt', undefined, undefined);
    });
  });

  it('shows error when API returns success=false', async () => {
    mockCreateRun.mockResolvedValue({ success: false, error: 'Quota exceeded' });

    renderWithRouter(<RerunDialog {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rerun' }));

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Quota exceeded');
    });

    expect(mockShowSuccess).not.toHaveBeenCalled();
    expect(defaultProps.onRerun).not.toHaveBeenCalled();
  });

  it('shows default error when API returns success=false with no error message', async () => {
    mockCreateRun.mockResolvedValue({ success: false });

    renderWithRouter(<RerunDialog {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rerun' }));

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Rerun failed');
    });
  });

  it('shows error message when API throws an Error', async () => {
    mockCreateRun.mockRejectedValue(new Error('Connection refused'));

    renderWithRouter(<RerunDialog {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rerun' }));

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Connection refused');
    });

    expect(defaultProps.onRerun).not.toHaveBeenCalled();
  });

  it('shows generic error when API throws a non-Error', async () => {
    mockCreateRun.mockRejectedValue(null);

    renderWithRouter(<RerunDialog {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rerun' }));

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Rerun request failed');
    });
  });
});
