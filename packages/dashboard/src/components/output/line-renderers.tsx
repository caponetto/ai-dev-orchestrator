import type React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { DashboardAgentStreamEvent } from '../../hooks/use-agent-stream';
import { linkify } from '../../lib/linkify';
import { cn } from '../../lib/utils';

import { formatTime, isStderrWarning, logLevelIcons, logLevelStyles, str } from './output-utils';

const MD_PATTERN = /\*\*[^*]+\*\*|`[^`]+`|^\s*[-*]\s|^\s*\d+\.\s|^#{1,6}\s/m;

function hasMarkdown(text: string): boolean {
  return MD_PATTERN.test(text);
}

function InlineMarkdown({ text }: Readonly<{ text: string }>) {
  return (
    <span className="prose-inline-md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <span>{children}</span>,
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          code: ({ children }) => (
            <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-2xs text-primary/80">
              {children}
            </code>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:text-primary/80"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="ml-4 list-disc space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="ml-4 list-decimal space-y-0.5">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
        }}
      >
        {text}
      </Markdown>
    </span>
  );
}

export function Timestamp({ iso }: Readonly<{ iso: string }>) {
  const time = formatTime(iso);
  if (!time) {
    return null;
  }
  return (
    <span data-timestamp className="mr-2 shrink-0 font-mono text-2xs text-muted-foreground/60">
      {time}
    </span>
  );
}

export function TaskPromptContent({ line }: Readonly<{ line: DashboardAgentStreamEvent }>) {
  const pm = line.protocolMessage;
  if (!pm) {
    return null;
  }

  return (
    <div className="text-xs">
      <div className="flex items-baseline whitespace-pre-wrap text-foreground/80">
        <Timestamp iso={line.timestamp} />
        <span>{linkify(str(pm.payload.description))}</span>
      </div>
    </div>
  );
}

export function renderRawLine(line: DashboardAgentStreamEvent): React.ReactElement {
  let color = 'text-foreground/80';
  if (line.type === 'stderr') {
    color = isStderrWarning(line) ? 'text-orange-400' : 'text-red-400';
  }
  const useMd = line.type !== 'stderr' && hasMarkdown(line.content);
  return (
    <div className={cn('flex items-baseline whitespace-pre-wrap', color)}>
      <Timestamp iso={line.timestamp} />
      {useMd ? <InlineMarkdown text={line.content} /> : <span>{linkify(line.content)}</span>}
    </div>
  );
}

export function renderProgressLine(line: DashboardAgentStreamEvent): React.ReactElement {
  const pm = line.protocolMessage;
  if (!pm) {
    return renderDefaultLine(line);
  }
  const detail = str(pm.payload.detail);
  const suffix = typeof pm.payload.percent === 'number' ? ` (${String(pm.payload.percent)}%)` : '';
  const useMd = hasMarkdown(detail);
  return (
    <div className="flex items-baseline whitespace-pre-wrap text-foreground/80">
      <Timestamp iso={line.timestamp} />
      <span>
        {useMd ? <InlineMarkdown text={detail} /> : linkify(detail)}
        {suffix}
      </span>
    </div>
  );
}

export function renderLogLine(line: DashboardAgentStreamEvent): React.ReactElement {
  const pm = line.protocolMessage;
  if (!pm) {
    return renderDefaultLine(line);
  }
  const level = str(pm.payload.level, 'info');
  const msg = str(pm.payload.message);
  const icon = logLevelIcons[level];
  const useMd = hasMarkdown(msg);
  return (
    <div
      className={cn(
        'flex items-baseline whitespace-pre-wrap',
        logLevelStyles[level] ?? 'text-foreground/80',
      )}
    >
      <Timestamp iso={line.timestamp} />
      <span>
        {icon ? `${icon} ` : ''}
        {useMd ? <InlineMarkdown text={msg} /> : linkify(msg)}
      </span>
    </div>
  );
}

export function renderPermissionResponseLine(line: DashboardAgentStreamEvent): React.ReactElement {
  const pm = line.protocolMessage;
  if (!pm) {
    return renderDefaultLine(line);
  }
  const granted = pm.payload.granted === true;
  return (
    <div
      className={cn(
        'flex items-baseline whitespace-pre-wrap',
        granted ? 'text-emerald-400' : 'text-red-400',
      )}
    >
      <Timestamp iso={line.timestamp} />
      <span>{granted ? '✓ Approved' : '✗ Denied'}</span>
    </div>
  );
}

export function renderDoneLine(line: DashboardAgentStreamEvent): React.ReactElement {
  const pm = line.protocolMessage;
  if (!pm) {
    return renderDefaultLine(line);
  }
  const summary = str(pm.payload.summary, 'Done');
  const useMd = hasMarkdown(summary);
  return (
    <div className="flex items-baseline whitespace-pre-wrap text-emerald-400">
      <Timestamp iso={line.timestamp} />
      <span>
        {'✓'} {useMd ? <InlineMarkdown text={summary} /> : linkify(summary)}
      </span>
    </div>
  );
}

export function renderErrorLine(line: DashboardAgentStreamEvent): React.ReactElement {
  const pm = line.protocolMessage;
  if (!pm) {
    return renderDefaultLine(line);
  }
  return (
    <div className="flex items-baseline whitespace-pre-wrap text-red-400">
      <Timestamp iso={line.timestamp} />
      <span>
        {'✗'} [{str(pm.payload.code, 'error')}] {linkify(str(pm.payload.message))}
      </span>
    </div>
  );
}

export function renderDefaultLine(line: DashboardAgentStreamEvent): React.ReactElement {
  const useMd = hasMarkdown(line.content);
  return (
    <div className="flex items-baseline whitespace-pre-wrap text-foreground/80">
      <Timestamp iso={line.timestamp} />
      {useMd ? <InlineMarkdown text={line.content} /> : <span>{linkify(line.content)}</span>}
    </div>
  );
}

export const lineContentRenderers: Partial<
  Record<string, (line: DashboardAgentStreamEvent) => React.ReactElement>
> = {
  progress: renderProgressLine,
  log: renderLogLine,
  permission_response: renderPermissionResponseLine,
  done: renderDoneLine,
  error: renderErrorLine,
};

export function LineContent({ line }: Readonly<{ line: DashboardAgentStreamEvent }>) {
  const pm = line.protocolMessage;

  if (!pm) {
    return renderRawLine(line);
  }

  const renderer = lineContentRenderers[pm.messageType];
  if (renderer) {
    return renderer(line);
  }

  return renderDefaultLine(line);
}
