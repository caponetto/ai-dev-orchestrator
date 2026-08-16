// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '../../../test/render';
import { RoleAssignmentsSection } from '../RoleAssignmentsSection';

describe('RoleAssignmentsSection', () => {
  const defaultProps = {
    assignments: {
      planner: { model: 'gpt-4', runner: 'openai' },
      implementer: { model: 'claude-3', runner: 'anthropic' },
    },
    availableRunners: ['openai', 'anthropic'],
    modelsByRunner: {
      openai: ['gpt-4', 'gpt-3.5-turbo'],
      anthropic: ['claude-3', 'claude-2'],
    },
    permissionPolicy: { defaultAction: 'ask_human' as const },
    onChange: vi.fn(),
  };

  it('renders the Role Assignments heading', () => {
    renderWithRouter(<RoleAssignmentsSection {...defaultProps} />);
    expect(screen.getByText('Role Assignments')).toBeInTheDocument();
  });

  it('renders table headers', () => {
    renderWithRouter(<RoleAssignmentsSection {...defaultProps} />);
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('Runner')).toBeInTheDocument();
    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByText('Trust Level')).toBeInTheDocument();
  });

  it('displays humanized role names', () => {
    renderWithRouter(<RoleAssignmentsSection {...defaultProps} />);
    expect(screen.getByText('Planner')).toBeInTheDocument();
    expect(screen.getByText('Implementer')).toBeInTheDocument();
  });

  it('renders select dropdowns for runners and models', () => {
    renderWithRouter(<RoleAssignmentsSection {...defaultProps} />);
    const comboboxes = screen.getAllByRole('combobox');
    expect(comboboxes.length).toBeGreaterThanOrEqual(4);
  });

  it('calls onChange when model is changed', () => {
    const onChange = vi.fn();
    renderWithRouter(<RoleAssignmentsSection {...defaultProps} onChange={onChange} />);
    const comboboxes = screen.getAllByRole('combobox');
    // Each role row has: runner, model, trust level (3 selects per row)
    // Row 1 (planner): comboboxes[0]=runner, comboboxes[1]=model, comboboxes[2]=trust
    fireEvent.change(comboboxes[1], { target: { value: 'gpt-3.5-turbo' } });
    expect(onChange).toHaveBeenCalledWith({
      roles: {
        assignments: {
          ...defaultProps.assignments,
          planner: { model: 'gpt-3.5-turbo', runner: 'openai' },
        },
      },
    });
  });

  it('calls onChange when runner is changed and keeps model if valid', () => {
    const onChange = vi.fn();
    const props = {
      ...defaultProps,
      assignments: {
        planner: { model: 'gpt-4', runner: 'openai' },
      },
      modelsByRunner: {
        openai: ['gpt-4', 'gpt-3.5-turbo'],
        anthropic: ['gpt-4', 'claude-2'],
      },
    };
    renderWithRouter(<RoleAssignmentsSection {...props} onChange={onChange} />);
    const comboboxes = screen.getAllByRole('combobox');
    // comboboxes[0]=runner for planner
    fireEvent.change(comboboxes[0], { target: { value: 'anthropic' } });
    expect(onChange).toHaveBeenCalledWith({
      roles: {
        assignments: {
          planner: { runner: 'anthropic', model: 'gpt-4' },
        },
      },
    });
  });

  it('resets model to first available when runner changes and current model is invalid', () => {
    const onChange = vi.fn();
    renderWithRouter(<RoleAssignmentsSection {...defaultProps} onChange={onChange} />);
    const comboboxes = screen.getAllByRole('combobox');
    // Change planner runner from openai to anthropic
    // planner model is gpt-4, which is not in anthropic models
    fireEvent.change(comboboxes[0], { target: { value: 'anthropic' } });
    expect(onChange).toHaveBeenCalledWith({
      roles: {
        assignments: {
          ...defaultProps.assignments,
          planner: { runner: 'anthropic', model: 'claude-3' },
        },
      },
    });
  });

  it('calls onChange when trust level is changed', () => {
    const onChange = vi.fn();
    renderWithRouter(<RoleAssignmentsSection {...defaultProps} onChange={onChange} />);
    const comboboxes = screen.getAllByRole('combobox');
    // comboboxes[2]=trust for planner
    fireEvent.change(comboboxes[2], { target: { value: 'high' } });
    expect(onChange).toHaveBeenCalledWith({
      governance: {
        permissionPolicy: {
          defaultAction: 'ask_human',
          roleTrust: { planner: 'high' },
        },
      },
    });
  });

  it('handles undefined permissionPolicy when changing trust level', () => {
    const onChange = vi.fn();
    renderWithRouter(
      <RoleAssignmentsSection {...defaultProps} permissionPolicy={undefined} onChange={onChange} />,
    );
    const comboboxes = screen.getAllByRole('combobox');
    // Change trust level for planner
    fireEvent.change(comboboxes[2], { target: { value: 'none' } });
    expect(onChange).toHaveBeenCalledWith({
      governance: {
        permissionPolicy: {
          defaultAction: 'ask_human',
          roleTrust: { planner: 'none' },
        },
      },
    });
  });

  it('preserves existing roleTrust values when changing another role trust', () => {
    const onChange = vi.fn();
    const props = {
      ...defaultProps,
      permissionPolicy: {
        defaultAction: 'ask_human' as const,
        roleTrust: { implementer: 'high' as const },
      },
    };
    renderWithRouter(<RoleAssignmentsSection {...props} onChange={onChange} />);
    const comboboxes = screen.getAllByRole('combobox');
    // Change trust level for planner (comboboxes[2])
    fireEvent.change(comboboxes[2], { target: { value: 'none' } });
    expect(onChange).toHaveBeenCalledWith({
      governance: {
        permissionPolicy: {
          defaultAction: 'ask_human',
          roleTrust: { implementer: 'high', planner: 'none' },
        },
      },
    });
  });
});
