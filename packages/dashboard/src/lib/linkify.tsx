import { LinkifyIt } from 'linkify-it';
import type React from 'react';

const linkifier = new LinkifyIt();

export function linkify(text: string): React.ReactNode {
  if (!text) {
    return text;
  }

  const matches = linkifier.match(text);
  if (!matches) {
    return text;
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of matches) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    parts.push(
      <a
        key={match.index}
        href={match.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 hover:text-primary/80"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        {match.raw}
      </a>,
    );

    lastIndex = match.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}
