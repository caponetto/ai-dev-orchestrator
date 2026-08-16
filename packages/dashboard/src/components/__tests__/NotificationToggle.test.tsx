// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NotificationToggle } from '../NotificationToggle';

describe('NotificationToggle', () => {
  const defaultProps = {
    permission: 'default' as const,
    supported: true,
    onRequestPermission: vi.fn(),
  };

  it('renders nothing when not supported', () => {
    const { container } = render(<NotificationToggle {...defaultProps} supported={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the label for default permission (expanded)', () => {
    render(<NotificationToggle {...defaultProps} />);
    expect(screen.getByText('Enable notifications')).toBeInTheDocument();
  });

  it('renders the label for granted permission', () => {
    render(<NotificationToggle {...defaultProps} permission="granted" />);
    expect(screen.getByText('Notifications on')).toBeInTheDocument();
  });

  it('renders the label for denied permission', () => {
    render(<NotificationToggle {...defaultProps} permission="denied" />);
    expect(screen.getByText('Notifications blocked')).toBeInTheDocument();
  });

  it('is enabled and clickable when permission is default', () => {
    const handler = vi.fn();
    render(<NotificationToggle {...defaultProps} onRequestPermission={handler} />);
    const button = screen.getByText('Enable notifications').closest('button');
    expect(button).not.toBeDisabled();
    fireEvent.click(button as Element);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('is disabled when permission is granted', () => {
    render(<NotificationToggle {...defaultProps} permission="granted" />);
    const button = screen.getByText('Notifications on').closest('button');
    expect(button).toBeDisabled();
  });

  it('is disabled when permission is denied', () => {
    render(<NotificationToggle {...defaultProps} permission="denied" />);
    const button = screen.getByText('Notifications blocked').closest('button');
    expect(button).toBeDisabled();
  });

  describe('collapsed mode', () => {
    it('renders an icon button with aria-label', () => {
      render(<NotificationToggle {...defaultProps} collapsed />);
      expect(screen.getByRole('button', { name: 'Enable notifications' })).toBeInTheDocument();
    });

    it('calls onRequestPermission when clicked in collapsed mode', () => {
      const handler = vi.fn();
      render(<NotificationToggle {...defaultProps} collapsed onRequestPermission={handler} />);
      fireEvent.click(screen.getByRole('button', { name: 'Enable notifications' }));
      expect(handler).toHaveBeenCalledOnce();
    });

    it('is disabled in collapsed mode when permission is granted', () => {
      render(<NotificationToggle {...defaultProps} permission="granted" collapsed />);
      expect(screen.getByRole('button', { name: 'Notifications on' })).toBeDisabled();
    });
  });
});
