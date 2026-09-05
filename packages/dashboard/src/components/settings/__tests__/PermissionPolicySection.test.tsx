// @vitest-environment jsdom
import type { SettingsPermissionPolicy } from '@ai-dev-orchestrator/schemas';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '../../../test/render';
import { PermissionPolicySection } from '../PermissionPolicySection';

describe('PermissionPolicySection', () => {
  const mockPolicy: SettingsPermissionPolicy = {
    defaultAction: 'ask_human',
    safeCommands: ['npm test', 'npm run lint'],
    rules: [{ action: 'file_read', decision: 'grant' }],
  };

  const defaultProps = {
    policy: mockPolicy,
    onChange: vi.fn(),
  };

  it('renders the Permission Policy section title', () => {
    renderWithRouter(<PermissionPolicySection {...defaultProps} />);
    expect(screen.getByText('Permission Policy')).toBeInTheDocument();
  });

  it('renders Safe Commands sub-section', () => {
    renderWithRouter(<PermissionPolicySection {...defaultProps} />);
    expect(screen.getByText('Safe Commands')).toBeInTheDocument();
  });

  it('renders Rules sub-section', () => {
    renderWithRouter(<PermissionPolicySection {...defaultProps} />);
    expect(screen.getByText('Rules')).toBeInTheDocument();
  });

  it('displays existing safe commands', () => {
    renderWithRouter(<PermissionPolicySection {...defaultProps} />);
    expect(screen.getByText('npm test')).toBeInTheDocument();
    expect(screen.getByText('npm run lint')).toBeInTheDocument();
  });

  it('has Add button for safe commands', () => {
    renderWithRouter(<PermissionPolicySection {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('has Add Rule button', () => {
    renderWithRouter(<PermissionPolicySection {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Add Rule' })).toBeInTheDocument();
  });

  it('renders rule table headers when rules exist', () => {
    renderWithRouter(<PermissionPolicySection {...defaultProps} />);
    expect(screen.getByText('Action')).toBeInTheDocument();
    expect(screen.getByText('Decision')).toBeInTheDocument();
    expect(screen.getByText('Scope')).toBeInTheDocument();
    expect(screen.getByText('Pattern')).toBeInTheDocument();
  });

  it('renders Remove buttons for safe commands', () => {
    renderWithRouter(<PermissionPolicySection {...defaultProps} />);
    const removeButtons = screen.getAllByRole('button', { name: /remove/i });
    expect(removeButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('handles undefined policy gracefully', () => {
    renderWithRouter(<PermissionPolicySection policy={undefined} onChange={vi.fn()} />);
    expect(screen.getByText('Permission Policy')).toBeInTheDocument();
  });

  it('allows adding a safe command via input', () => {
    const onChange = vi.fn();
    renderWithRouter(<PermissionPolicySection {...defaultProps} onChange={onChange} />);
    const input = screen.getByPlaceholderText('e.g. npm test');
    fireEvent.change(input, { target: { value: 'npm run build' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenCalled();
  });

  it('emits correct patch when adding a safe command', () => {
    const onChange = vi.fn();
    renderWithRouter(<PermissionPolicySection {...defaultProps} onChange={onChange} />);
    const input = screen.getByPlaceholderText('e.g. npm test');
    fireEvent.change(input, { target: { value: 'pnpm build' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenCalledWith({
      governance: {
        permissionPolicy: {
          ...mockPolicy,
          safeCommands: ['npm test', 'npm run lint', 'pnpm build'],
        },
      },
    });
  });

  it('does not add empty safe command', () => {
    const onChange = vi.fn();
    renderWithRouter(<PermissionPolicySection {...defaultProps} onChange={onChange} />);
    const input = screen.getByPlaceholderText('e.g. npm test');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not add duplicate safe command', () => {
    const onChange = vi.fn();
    renderWithRouter(<PermissionPolicySection {...defaultProps} onChange={onChange} />);
    const input = screen.getByPlaceholderText('e.g. npm test');
    fireEvent.change(input, { target: { value: 'npm test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('adds safe command when pressing Enter', () => {
    const onChange = vi.fn();
    renderWithRouter(<PermissionPolicySection {...defaultProps} onChange={onChange} />);
    const input = screen.getByPlaceholderText('e.g. npm test');
    fireEvent.change(input, { target: { value: 'pnpm test' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({
      governance: {
        permissionPolicy: {
          ...mockPolicy,
          safeCommands: ['npm test', 'npm run lint', 'pnpm test'],
        },
      },
    });
  });

  it('removes a safe command when clicking Remove', () => {
    const onChange = vi.fn();
    renderWithRouter(<PermissionPolicySection {...defaultProps} onChange={onChange} />);
    const removeButtons = screen.getAllByRole('button', { name: /remove/i });
    // First two Remove buttons correspond to safe commands
    fireEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith({
      governance: {
        permissionPolicy: {
          ...mockPolicy,
          safeCommands: ['npm run lint'],
        },
      },
    });
  });

  it('adds a new rule when clicking Add Rule', () => {
    const onChange = vi.fn();
    renderWithRouter(<PermissionPolicySection {...defaultProps} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Rule' }));
    expect(onChange).toHaveBeenCalledWith({
      governance: {
        permissionPolicy: {
          ...mockPolicy,
          rules: [
            { action: 'file_read', decision: 'grant' },
            { action: 'file_read', decision: 'grant' },
          ],
        },
      },
    });
  });

  it('removes a rule when clicking its Remove button', () => {
    const onChange = vi.fn();
    renderWithRouter(<PermissionPolicySection {...defaultProps} onChange={onChange} />);
    const removeButtons = screen.getAllByRole('button', { name: /remove/i });
    // The last Remove button is for the rule row
    fireEvent.click(removeButtons[removeButtons.length - 1]);
    expect(onChange).toHaveBeenCalledWith({
      governance: {
        permissionPolicy: {
          ...mockPolicy,
          rules: [],
        },
      },
    });
  });

  it('updates rule scope via text input', () => {
    const onChange = vi.fn();
    renderWithRouter(<PermissionPolicySection {...defaultProps} onChange={onChange} />);
    const scopeInput = screen.getByPlaceholderText('e.g. src/**');
    fireEvent.change(scopeInput, { target: { value: 'lib/**' } });
    expect(onChange).toHaveBeenCalledWith({
      governance: {
        permissionPolicy: {
          ...mockPolicy,
          rules: [{ action: 'file_read', decision: 'grant', scope: 'lib/**' }],
        },
      },
    });
  });

  it('updates rule pattern via text input', () => {
    const onChange = vi.fn();
    renderWithRouter(<PermissionPolicySection {...defaultProps} onChange={onChange} />);
    const patternInput = screen.getByPlaceholderText('e.g. *.ts');
    fireEvent.change(patternInput, { target: { value: '*.json' } });
    expect(onChange).toHaveBeenCalledWith({
      governance: {
        permissionPolicy: {
          ...mockPolicy,
          rules: [{ action: 'file_read', decision: 'grant', pattern: '*.json' }],
        },
      },
    });
  });

  it('updates rule action via inline select', () => {
    const onChange = vi.fn();
    renderWithRouter(<PermissionPolicySection {...defaultProps} onChange={onChange} />);
    // The rule row has InlineSelect for action and decision
    // The comboboxes in rule table: action select, decision select
    const ruleTable = screen.getByRole('table');
    const selects = ruleTable.querySelectorAll('select');
    // First select is action, second is decision
    fireEvent.change(selects[0], { target: { value: 'file_write' } });
    expect(onChange).toHaveBeenCalledWith({
      governance: {
        permissionPolicy: {
          ...mockPolicy,
          rules: [{ action: 'file_write', decision: 'grant' }],
        },
      },
    });
  });

  it('updates rule decision via inline select', () => {
    const onChange = vi.fn();
    renderWithRouter(<PermissionPolicySection {...defaultProps} onChange={onChange} />);
    const ruleTable = screen.getByRole('table');
    const selects = ruleTable.querySelectorAll('select');
    // Second select is decision
    fireEvent.change(selects[1], { target: { value: 'deny' } });
    expect(onChange).toHaveBeenCalledWith({
      governance: {
        permissionPolicy: {
          ...mockPolicy,
          rules: [{ action: 'file_read', decision: 'deny' }],
        },
      },
    });
  });

  it('handles policy with no safeCommands or rules', () => {
    const onChange = vi.fn();
    const emptyPolicy: SettingsPermissionPolicy = { defaultAction: 'ask_human' };
    renderWithRouter(<PermissionPolicySection policy={emptyPolicy} onChange={onChange} />);
    // Should not render any Remove buttons for commands
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    // Add a safe command
    const input = screen.getByPlaceholderText('e.g. npm test');
    fireEvent.change(input, { target: { value: 'echo hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenCalledWith({
      governance: {
        permissionPolicy: {
          ...emptyPolicy,
          safeCommands: ['echo hello'],
        },
      },
    });
  });
});
