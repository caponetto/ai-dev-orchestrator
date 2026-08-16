// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '../../../test/render';
import { HelpIcon, NumberInput, SectionCard, Select, Toggle } from '../FormControls';

describe('SectionCard', () => {
  it('renders title and children', () => {
    renderWithRouter(
      <SectionCard title="Test Section">
        <div>section content</div>
      </SectionCard>,
    );
    expect(screen.getByText('Test Section')).toBeInTheDocument();
    expect(screen.getByText('section content')).toBeInTheDocument();
  });

  it('renders tooltip when provided', () => {
    renderWithRouter(
      <SectionCard title="Test" tooltip="Help text">
        <div />
      </SectionCard>,
    );
    expect(screen.getByText('?')).toBeInTheDocument();
  });
});

describe('HelpIcon', () => {
  it('renders the question mark indicator', () => {
    renderWithRouter(<HelpIcon text="Some help" />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });
});

describe('Toggle', () => {
  it('renders label text', () => {
    renderWithRouter(<Toggle label="Enable feature" checked={false} onChange={vi.fn()} />);
    expect(screen.getByText('Enable feature')).toBeInTheDocument();
  });

  it('renders a switch element', () => {
    renderWithRouter(<Toggle label="Feature" checked={true} onChange={vi.fn()} />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('reflects checked state via aria-checked', () => {
    renderWithRouter(<Toggle label="Feature" checked={true} onChange={vi.fn()} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onChange when clicked', () => {
    const onChange = vi.fn();
    renderWithRouter(<Toggle label="Feature" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('NumberInput', () => {
  it('renders label text', () => {
    renderWithRouter(<NumberInput label="Max tokens" value={100} onChange={vi.fn()} />);
    expect(screen.getByText('Max tokens')).toBeInTheDocument();
  });

  it('renders the input with value', () => {
    renderWithRouter(<NumberInput label="Count" value={42} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('42')).toBeInTheDocument();
  });

  it('calls onChange with number value', () => {
    const onChange = vi.fn();
    renderWithRouter(<NumberInput label="Count" value={10} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('10'), { target: { value: '20' } });
    expect(onChange).toHaveBeenCalledWith(20);
  });

  it('calls onChange with undefined for empty value', () => {
    const onChange = vi.fn();
    renderWithRouter(<NumberInput label="Count" value={10} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('10'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});

describe('Select', () => {
  it('renders label text', () => {
    renderWithRouter(
      <Select label="Level" value="info" options={['debug', 'info', 'warn']} onChange={vi.fn()} />,
    );
    expect(screen.getByText('Level')).toBeInTheDocument();
  });

  it('renders all options', () => {
    renderWithRouter(
      <Select label="Level" value="info" options={['debug', 'info', 'warn']} onChange={vi.fn()} />,
    );
    expect(screen.getByText('debug')).toBeInTheDocument();
    expect(screen.getByText('info')).toBeInTheDocument();
    expect(screen.getByText('warn')).toBeInTheDocument();
  });

  it('uses labelMap for display names', () => {
    renderWithRouter(
      <Select
        label="Level"
        value="info"
        options={['info', 'warn']}
        labelMap={{ info: 'Info', warn: 'Warning' }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Info')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
  });

  it('calls onChange when selection changes', () => {
    const onChange = vi.fn();
    renderWithRouter(
      <Select label="Level" value="info" options={['debug', 'info', 'warn']} onChange={onChange} />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'warn' } });
    expect(onChange).toHaveBeenCalledWith('warn');
  });
});
