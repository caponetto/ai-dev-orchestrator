import { humanize } from '../../lib/humanize';

import type { AgreementView } from './shared';
import { METADATA_KEYS, omitKeys, renderMetadata, renderObject, toRaw } from './shared';

export function renderAgreement(view: AgreementView): string {
  const raw = toRaw(view);
  const sections: string[] = [];

  const type = view.type ?? view.agreementType ?? 'Agreement';
  sections.push(`# ${humanize(type)}`);

  const meta = renderMetadata(raw);
  if (meta) {
    sections.push(meta);
  }

  const status = view.status ?? view.approvalStatus;
  if (status) {
    sections.push(`**Status:** ${status}`);
  }

  const remaining = omitKeys(raw, [
    'type',
    'status',
    'agreementType',
    'approvalStatus',
    ...METADATA_KEYS,
  ]);
  if (Object.keys(remaining).length > 0) {
    sections.push(renderObject(remaining, 1));
  }

  return sections.join('\n\n');
}
