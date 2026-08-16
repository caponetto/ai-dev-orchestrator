// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '../../../test/render';
import { EscalationSection } from '../EscalationSection';

describe('EscalationSection', () => {
  const defaultProps = {
    logLevel: 'info',
    budget: { maxTokensPerRun: 100000 },
    permissionPolicy: { defaultAction: 'ask_human' as const },
    onChange: vi.fn(),
  };

  it('renders the Runtime section title', () => {
    renderWithRouter(<EscalationSection {...defaultProps} />);
    expect(screen.getByText('Runtime')).toBeInTheDocument();
  });

  it('renders Log Level select', () => {
    renderWithRouter(<EscalationSection {...defaultProps} />);
    expect(screen.getByText('Log Level')).toBeInTheDocument();
  });

  it('renders Max Tokens input', () => {
    renderWithRouter(<EscalationSection {...defaultProps} />);
    expect(screen.getByText('Max Tokens / Run')).toBeInTheDocument();
  });

  it('renders Default Permission select', () => {
    renderWithRouter(<EscalationSection {...defaultProps} />);
    expect(screen.getByText('Default Permission')).toBeInTheDocument();
  });

  it('renders log level options', () => {
    renderWithRouter(<EscalationSection {...defaultProps} />);
    expect(screen.getByText('Debug')).toBeInTheDocument();
    expect(screen.getByText('Info')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('calls onChange with runtime patch when log level changes', () => {
    const onChange = vi.fn();
    renderWithRouter(<EscalationSection {...defaultProps} onChange={onChange} />);
    const selects = screen.getAllByRole('combobox');
    // The first select is Log Level
    fireEvent.change(selects[0], { target: { value: 'debug' } });
    expect(onChange).toHaveBeenCalledWith({ runtime: { logLevel: 'debug' } });
  });

  it('calls onChange with governance patch when max tokens changes', () => {
    const onChange = vi.fn();
    renderWithRouter(<EscalationSection {...defaultProps} onChange={onChange} />);
    const numberInput = screen.getByDisplayValue('100000');
    fireEvent.change(numberInput, { target: { value: '50000' } });
    expect(onChange).toHaveBeenCalledWith({
      governance: { budget: { maxTokensPerRun: 50000 } },
    });
  });

  it('calls onChange with undefined when max tokens input is cleared', () => {
    const onChange = vi.fn();
    renderWithRouter(<EscalationSection {...defaultProps} onChange={onChange} />);
    const numberInput = screen.getByDisplayValue('100000');
    fireEvent.change(numberInput, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({
      governance: { budget: { maxTokensPerRun: undefined } },
    });
  });

  it('calls onChange with governance patch when default permission changes', () => {
    const onChange = vi.fn();
    renderWithRouter(<EscalationSection {...defaultProps} onChange={onChange} />);
    const selects = screen.getAllByRole('combobox');
    // The second select is Default Permission
    fireEvent.change(selects[1], { target: { value: 'deny' } });
    expect(onChange).toHaveBeenCalledWith({
      governance: {
        permissionPolicy: {
          defaultAction: 'deny',
        },
      },
    });
  });

  it('uses default permissionPolicy when none is provided', () => {
    const onChange = vi.fn();
    renderWithRouter(
      <EscalationSection
        logLevel="info"
        budget={undefined}
        permissionPolicy={undefined}
        onChange={onChange}
      />,
    );
    const selects = screen.getAllByRole('combobox');
    // Default Permission select should default to ask_human
    fireEvent.change(selects[1], { target: { value: 'grant' } });
    expect(onChange).toHaveBeenCalledWith({
      governance: {
        permissionPolicy: {
          defaultAction: 'grant',
        },
      },
    });
  });
});
