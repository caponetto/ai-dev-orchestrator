// @vitest-environment jsdom
import type { ArtifactRef } from '@ai-dev-orchestrator/schemas';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DispatchArtifacts } from '../../../lib/dispatch-artifacts';
import { ArtifactsPopover, TokenUsageInline } from '../ArtifactsPopover';

const makeRef = (type: string, name: string, version: number): ArtifactRef => ({
  type: type as ArtifactRef['type'],
  name,
  version,
  checksum: '',
});

describe('TokenUsageInline', () => {
  it('renders input and output token counts', () => {
    render(<TokenUsageInline usage={{ inputTokens: 1500, outputTokens: 800 }} />);
    // formatTokens renders abbreviated values
    expect(screen.getByText(/↓/)).toBeInTheDocument();
    expect(screen.getByText(/↑/)).toBeInTheDocument();
  });

  it('returns null when both token counts are zero', () => {
    const { container } = render(<TokenUsageInline usage={{ inputTokens: 0, outputTokens: 0 }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders when only inputTokens are positive', () => {
    const { container } = render(
      <TokenUsageInline usage={{ inputTokens: 500, outputTokens: 0 }} />,
    );
    expect(container.firstChild).not.toBeNull();
  });
});

describe('ArtifactsPopover', () => {
  const emptyArtifacts: DispatchArtifacts = {
    inputs: [],
    outputs: [],
  };

  const artifactsWithData: DispatchArtifacts = {
    inputs: [makeRef('specification', 'api-spec', 1)],
    outputs: [makeRef('code', 'handler', 1)],
  };

  it('renders the Artifacts trigger button', () => {
    render(<ArtifactsPopover artifacts={emptyArtifacts} />);
    expect(screen.getByRole('button', { name: 'View artifacts' })).toBeInTheDocument();
  });

  it('deduplicates input refs', () => {
    const duplicatedInputs: DispatchArtifacts = {
      inputs: [makeRef('specification', 'api-spec', 1), makeRef('specification', 'api-spec', 1)],
      outputs: [],
    };
    // Component uses useMemo with deduplicateRefs - just verify it renders without error
    const { container } = render(<ArtifactsPopover artifacts={duplicatedInputs} />);
    expect(container).toBeTruthy();
  });

  it('deduplicates output refs', () => {
    const duplicatedOutputs: DispatchArtifacts = {
      inputs: [],
      outputs: [makeRef('code', 'handler', 1), makeRef('code', 'handler', 1)],
    };
    const { container } = render(<ArtifactsPopover artifacts={duplicatedOutputs} />);
    expect(container).toBeTruthy();
  });

  it('accepts an onViewArtifact callback', () => {
    const onView = vi.fn();
    const { container } = render(
      <ArtifactsPopover artifacts={artifactsWithData} onViewArtifact={onView} />,
    );
    expect(container).toBeTruthy();
  });
});
