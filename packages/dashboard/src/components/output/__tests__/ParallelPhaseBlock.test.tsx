// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it } from 'vitest';

import type { ParallelPhase } from '../parallel-phases';
import { ParallelPhaseBlock } from '../ParallelPhaseBlock';

const phase: ParallelPhase = {
  stateId: 'IMPLEMENT',
  dispatches: new Map([
    ['writer-1', { roleId: 'code_writer', dispatchId: 'writer-1', lines: [], status: 'working' }],
    [
      'reviewer-1',
      { roleId: 'code_reviewer', dispatchId: 'reviewer-1', lines: [], status: 'done' },
    ],
    ['tester-1', { roleId: 'test_runner', dispatchId: 'tester-1', lines: [], status: 'error' }],
  ]),
};

function renderBlock() {
  return render(
    <ParallelPhaseBlock
      phase={phase}
      runId="run-1"
      seenTimestamps={new Set()}
      scrollContainer={React.createRef<HTMLDivElement>()}
      roleMetaMap={
        new Map([
          ['code_writer', { runner: 'codex', model: 'gpt-5' }],
          ['code_reviewer', { model: 'gpt-5-mini' }],
        ])
      }
      dispatchPromptMap={new Map([['writer-1', 'Write the feature']])}
      dispatchDescriptionMap={new Map([['writer-1', 'Implement the requested behavior']])}
      dispatchArtifactMap={new Map()}
      historicalArtifactMap={new Map()}
    />,
  );
}

describe('ParallelPhaseBlock', () => {
  it('shows dispatch summaries with status, role metadata, and prompt controls', () => {
    renderBlock();

    expect(screen.getByText(/Parallel Agents/)).toBeInTheDocument();
    expect(screen.getByText(/2\/3 complete/)).toBeInTheDocument();
    expect(screen.getByText('Code Writer')).toBeInTheDocument();
    expect(screen.getByText('Code Reviewer')).toBeInTheDocument();
    expect(screen.getByText('Test Runner')).toBeInTheDocument();
    expect(screen.getByText('Implement the requested behavior')).toBeInTheDocument();
    expect(screen.getAllByText(/gpt-5/)).toHaveLength(2);
  });

  it('expands to the all-dispatch summary and supports filtering a dispatch', async () => {
    const user = userEvent.setup();
    renderBlock();

    await user.click(screen.getByRole('button', { name: /Parallel Agents/ }));
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getAllByText('Code Writer')).toHaveLength(2);

    await user.click(screen.getAllByRole('button', { name: /Code Writer/ })[0]);
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Parallel Agents/ }));
    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument();
  });
});
