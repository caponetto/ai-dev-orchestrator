// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { api } from '../../api/client';
import { renderWithRouter } from '../../test/render';
import { AnswerForm } from '../AnswerForm';

vi.mock('../../api/client', () => ({
  api: {
    answer: vi.fn().mockResolvedValue({ success: true }),
  },
}));

describe('AnswerForm', () => {
  const defaultProps = {
    runId: 'run-1',
    reason: 'clarification_needed',
    requestingState: 'requirements_analysis',
    onSuccess: vi.fn(),
  };

  it('renders the clarification context label', () => {
    renderWithRouter(<AnswerForm {...defaultProps} />);
    expect(
      screen.getByText('The agent needs clarification before proceeding.'),
    ).toBeInTheDocument();
  });

  it('renders the waiting context label for non-clarification reasons', () => {
    renderWithRouter(<AnswerForm {...defaultProps} reason="other_reason" />);
    expect(screen.getByText(/waiting for input from requirements analysis/i)).toBeInTheDocument();
  });

  it('renders textarea and submit button', () => {
    renderWithRouter(<AnswerForm {...defaultProps} />);
    expect(screen.getByPlaceholderText('Type your response...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit answer/i })).toBeInTheDocument();
  });

  it('disables submit button when textarea is empty', () => {
    renderWithRouter(<AnswerForm {...defaultProps} />);
    expect(screen.getByRole('button', { name: /submit answer/i })).toBeDisabled();
  });

  it('enables submit button when text is entered', () => {
    renderWithRouter(<AnswerForm {...defaultProps} />);
    fireEvent.change(screen.getByPlaceholderText('Type your response...'), {
      target: { value: 'My answer' },
    });
    expect(screen.getByRole('button', { name: /submit answer/i })).toBeEnabled();
  });

  it('calls api.answer on submit and triggers onSuccess', async () => {
    vi.mocked(api.answer).mockClear();
    vi.mocked(api.answer).mockResolvedValue({ success: true });
    const onSuccess = vi.fn();
    renderWithRouter(<AnswerForm {...defaultProps} onSuccess={onSuccess} />);

    fireEvent.change(screen.getByPlaceholderText('Type your response...'), {
      target: { value: 'My answer' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }));

    await waitFor(() => {
      expect(vi.mocked(api.answer)).toHaveBeenCalledWith('run-1', 'My answer');
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it('shows error when API returns success=false', async () => {
    vi.mocked(api.answer).mockResolvedValue({ success: false, error: 'Validation error' });
    renderWithRouter(<AnswerForm {...defaultProps} />);

    fireEvent.change(screen.getByPlaceholderText('Type your response...'), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }));

    await waitFor(() => {
      expect(screen.getByText('Validation error')).toBeInTheDocument();
    });
  });

  it('shows Unknown error when API returns success=false without error message', async () => {
    vi.mocked(api.answer).mockResolvedValue({ success: false });
    renderWithRouter(<AnswerForm {...defaultProps} />);

    fireEvent.change(screen.getByPlaceholderText('Type your response...'), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }));

    await waitFor(() => {
      expect(screen.getByText('Unknown error')).toBeInTheDocument();
    });
  });

  it('shows error when API throws Error', async () => {
    vi.mocked(api.answer).mockRejectedValue(new Error('Network failure'));
    renderWithRouter(<AnswerForm {...defaultProps} />);

    fireEvent.change(screen.getByPlaceholderText('Type your response...'), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }));

    await waitFor(() => {
      expect(screen.getByText('Network failure')).toBeInTheDocument();
    });
  });

  it('shows error when API throws non-Error', async () => {
    vi.mocked(api.answer).mockRejectedValue('fail');
    renderWithRouter(<AnswerForm {...defaultProps} />);

    fireEvent.change(screen.getByPlaceholderText('Type your response...'), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }));

    await waitFor(() => {
      expect(screen.getByText('fail')).toBeInTheDocument();
    });
  });

  it('does not submit with whitespace-only input', () => {
    renderWithRouter(<AnswerForm {...defaultProps} />);
    fireEvent.change(screen.getByPlaceholderText('Type your response...'), {
      target: { value: '   ' },
    });
    expect(screen.getByRole('button', { name: /submit answer/i })).toBeDisabled();
  });

  it('trims content before sending', async () => {
    vi.mocked(api.answer).mockClear();
    vi.mocked(api.answer).mockResolvedValue({ success: true });
    renderWithRouter(<AnswerForm {...defaultProps} />);

    fireEvent.change(screen.getByPlaceholderText('Type your response...'), {
      target: { value: '  hello  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }));

    await waitFor(() => {
      expect(vi.mocked(api.answer)).toHaveBeenCalledWith('run-1', 'hello');
    });
  });
});
