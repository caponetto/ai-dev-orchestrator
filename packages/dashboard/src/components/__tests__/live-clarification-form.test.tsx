// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api/client';
import { LiveClarificationForm } from '../live-clarification-form';

vi.mock('../../api/client', () => ({ api: { respondClarification: vi.fn() } }));
const props = { runId: 'run', messageId: 'question', answered: false, expired: false };
beforeEach(() => vi.mocked(api.respondClarification).mockReset().mockResolvedValue({ ok: true }));
describe('live clarification responses', () => {
  it('rejects blank form submissions and sends the trimmed answer to the request endpoint', async () => {
    const user = userEvent.setup();
    render(<LiveClarificationForm {...props} />);
    const input = screen.getByRole('textbox', { name: 'Clarification answer' });
    expect(screen.getByRole('button', { name: 'Send answer' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Answer clarification' }));
    expect(api.respondClarification).not.toHaveBeenCalled();
    await user.type(input, ' Blue ');
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(api.respondClarification).toHaveBeenCalledWith('run', 'question', 'Blue');
    expect(await screen.findByText('Answer submitted')).toBeInTheDocument();
  });
  it.each([new Error('disk unavailable'), 'offline'])(
    'retains the answer and restores controls after %s',
    async (error) => {
      vi.mocked(api.respondClarification).mockRejectedValueOnce(error);
      const user = userEvent.setup();
      render(<LiveClarificationForm {...props} />);
      await user.type(screen.getByRole('textbox'), 'Blue');
      await user.click(screen.getByRole('button', { name: 'Send answer' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        error instanceof Error ? error.message : error,
      );
      expect(screen.getByRole('textbox')).toHaveValue('Blue');
      await user.click(screen.getByRole('button', { name: 'Send answer' }));
      await waitFor(() => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });
      expect(screen.getByText('Answer submitted')).toBeInTheDocument();
    },
  );
  it('prevents duplicate submissions while the durable write is pending', async () => {
    let resolve!: (value: { ok: boolean }) => void;
    vi.mocked(api.respondClarification).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const user = userEvent.setup();
    render(<LiveClarificationForm {...props} />);
    const input = screen.getByRole('textbox');
    await user.type(input, 'Blue');
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Answer clarification' }));
    expect(api.respondClarification).toHaveBeenCalledOnce();
    resolve({ ok: true });
    expect(await screen.findByText('Answer submitted')).toBeInTheDocument();
  });
  it('removes controls when an external response or dispatch completion arrives', () => {
    const { rerender } = render(<LiveClarificationForm {...props} />);
    rerender(<LiveClarificationForm {...props} expired />);
    expect(screen.getByText('Request expired (agent finished)')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    rerender(<LiveClarificationForm {...props} answered expired />);
    expect(screen.getByText('Answer submitted')).toBeInTheDocument();
    expect(screen.queryByText(/Request expired/)).not.toBeInTheDocument();
  });
});
