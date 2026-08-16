// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '../../../test/render';
import { IterationLimitsSection } from '../IterationLimitsSection';

describe('IterationLimitsSection', () => {
  const defaultProps = {
    defaults: {
      maxReviewIterations: 3,
      maxJudgeArbitrations: 2,
    },
    onChange: vi.fn(),
  };

  it('renders the Iteration Limits section title', () => {
    renderWithRouter(<IterationLimitsSection {...defaultProps} />);
    expect(screen.getByText('Iteration Limits')).toBeInTheDocument();
  });

  it('renders humanized limit names', () => {
    renderWithRouter(<IterationLimitsSection {...defaultProps} />);
    expect(screen.getByText('Max Review Iterations')).toBeInTheDocument();
    expect(screen.getByText('Max Judge Arbitrations')).toBeInTheDocument();
  });

  it('displays current values in inputs', () => {
    renderWithRouter(<IterationLimitsSection {...defaultProps} />);
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
  });

  it('calls onChange with correct patch when a value is changed', () => {
    const onChange = vi.fn();
    renderWithRouter(<IterationLimitsSection {...defaultProps} onChange={onChange} />);
    const input = screen.getByDisplayValue('3');
    fireEvent.change(input, { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith({
      governance: {
        iterationLimits: {
          defaults: { ...defaultProps.defaults, maxReviewIterations: 5 },
        },
      },
    });
  });

  it('calls onChange for a different field', () => {
    const onChange = vi.fn();
    renderWithRouter(<IterationLimitsSection {...defaultProps} onChange={onChange} />);
    const input = screen.getByDisplayValue('2');
    fireEvent.change(input, { target: { value: '4' } });
    expect(onChange).toHaveBeenCalledWith({
      governance: {
        iterationLimits: {
          defaults: { ...defaultProps.defaults, maxJudgeArbitrations: 4 },
        },
      },
    });
  });

  it('does not call onChange when input is cleared (value becomes undefined)', () => {
    const onChange = vi.fn();
    renderWithRouter(<IterationLimitsSection {...defaultProps} onChange={onChange} />);
    const input = screen.getByDisplayValue('3');
    fireEvent.change(input, { target: { value: '' } });
    // The update function returns early when value is undefined
    expect(onChange).not.toHaveBeenCalled();
  });
});
