import { createHash } from 'node:crypto';

const ALGORITHM = 'sha256';
const PREFIX = `${ALGORITHM}:`;

export function hashContent(data: string | Buffer): string {
  const hash = createHash(ALGORITHM)
    .update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data)
    .digest('hex');
  return `${PREFIX}${hash}`;
}
