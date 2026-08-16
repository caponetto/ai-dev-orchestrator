// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '../../../test/render';
import { QualityGatesSection } from '../QualityGatesSection';

describe('QualityGatesSection', () => {
  const mockGates: Record<string, Record<string, unknown>> = {
    specificationReadiness: {
      minCompletenessScore: 0.8,
      requiresApproval: true,
    },
    implementationReview: {
      maxHighSeverityFindings: 0,
      maxMediumSeverityFindings: 3,
    },
  };

  const defaultProps = {
    gates: mockGates,
    onChange: vi.fn(),
  };

  it('renders the Quality Gates section title', () => {
    renderWithRouter(<QualityGatesSection {...defaultProps} />);
    expect(screen.getByText('Quality Gates')).toBeInTheDocument();
  });

  it('renders humanized gate names', () => {
    renderWithRouter(<QualityGatesSection {...defaultProps} />);
    expect(screen.getByText('Specification Readiness')).toBeInTheDocument();
    expect(screen.getByText('Implementation Review')).toBeInTheDocument();
  });

  it('renders number inputs for numeric settings', () => {
    renderWithRouter(<QualityGatesSection {...defaultProps} />);
    expect(screen.getByDisplayValue('0.8')).toBeInTheDocument();
    expect(screen.getByDisplayValue('0')).toBeInTheDocument();
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();
  });

  it('renders toggle for boolean settings', () => {
    renderWithRouter(<QualityGatesSection {...defaultProps} />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('renders humanized field labels', () => {
    renderWithRouter(<QualityGatesSection {...defaultProps} />);
    expect(screen.getByText('Min Completeness Score')).toBeInTheDocument();
    expect(screen.getByText('Requires Approval')).toBeInTheDocument();
    expect(screen.getByText('Max High Severity Findings')).toBeInTheDocument();
  });

  it('calls onChange when a number input value changes', () => {
    const onChange = vi.fn();
    renderWithRouter(<QualityGatesSection {...defaultProps} onChange={onChange} />);
    const input = screen.getByDisplayValue('0.8');
    fireEvent.change(input, { target: { value: '0.9' } });
    expect(onChange).toHaveBeenCalledWith({
      governance: {
        qualityGates: {
          ...mockGates,
          specificationReadiness: {
            ...mockGates.specificationReadiness,
            minCompletenessScore: 0.9,
          },
        },
      },
    });
  });

  it('calls onChange with 0 when number input is cleared', () => {
    const onChange = vi.fn();
    renderWithRouter(<QualityGatesSection {...defaultProps} onChange={onChange} />);
    const input = screen.getByDisplayValue('0.8');
    fireEvent.change(input, { target: { value: '' } });
    // NumberInput passes undefined; updateGate coerces to 0
    expect(onChange).toHaveBeenCalledWith({
      governance: {
        qualityGates: {
          ...mockGates,
          specificationReadiness: { ...mockGates.specificationReadiness, minCompletenessScore: 0 },
        },
      },
    });
  });

  it('calls onChange when boolean toggle is clicked', () => {
    const onChange = vi.fn();
    renderWithRouter(<QualityGatesSection {...defaultProps} onChange={onChange} />);
    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({
      governance: {
        qualityGates: {
          ...mockGates,
          specificationReadiness: { ...mockGates.specificationReadiness, requiresApproval: false },
        },
      },
    });
  });

  it('calls onChange for maxHighSeverityFindings number input', () => {
    const onChange = vi.fn();
    renderWithRouter(<QualityGatesSection {...defaultProps} onChange={onChange} />);
    const input = screen.getByDisplayValue('3');
    fireEvent.change(input, { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith({
      governance: {
        qualityGates: {
          ...mockGates,
          implementationReview: {
            ...mockGates.implementationReview,
            maxMediumSeverityFindings: 5,
          },
        },
      },
    });
  });
});
