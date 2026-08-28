// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithRouter } from '../../test/render';
import { BudgetPanel } from '../BudgetPanel';

const baseMock = {
  runId: 'run-1',
  totalInputTokens: 5000,
  totalOutputTokens: 3000,
  totalTokens: 8000,
  byRole: [],
  budgetSummary: {
    configuredMaxTokens: 100000,
    budgetExceeded: false,
    alertThresholds: [0.5, 0.8],
    crossedThresholds: [],
  },
};

describe('BudgetPanel', () => {
  it('renders budget heading', () => {
    renderWithRouter(<BudgetPanel data={baseMock} />);
    expect(screen.getByText('Budget')).toBeInTheDocument();
  });

  it('displays token counts', () => {
    renderWithRouter(<BudgetPanel data={baseMock} />);
    const formattedTotal = (8000).toLocaleString();
    const formattedMax = (100000).toLocaleString();
    expect(screen.getByText((content) => content.includes(formattedTotal))).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes(formattedMax))).toBeInTheDocument();
  });

  it('shows exceeded badge when budget is exceeded', () => {
    const exceeded = {
      ...baseMock,
      budgetSummary: {
        configuredMaxTokens: 100000,
        budgetExceeded: true,
        alertThresholds: [0.5, 0.8],
        crossedThresholds: [],
      },
    };
    renderWithRouter(<BudgetPanel data={exceeded} />);
    expect(screen.getByText('Exceeded')).toBeInTheDocument();
  });

  it('renders nothing when no budget is configured', () => {
    const noBudget = {
      ...baseMock,
      budgetSummary: undefined,
    };
    const { container } = renderWithRouter(<BudgetPanel data={noBudget} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders alert threshold labels', () => {
    renderWithRouter(<BudgetPanel data={baseMock} />);
    expect(screen.getByText('Alerts:')).toBeInTheDocument();
    expect(screen.getByText(/50%/)).toBeInTheDocument();
    expect(screen.getByText(/80%/)).toBeInTheDocument();
  });
});
