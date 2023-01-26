/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import { qSA } from 'dompack';

export function fixupScopeTRs(node) {
  for (const tr of qSA(node, 'tr')) {
    const scoperow = Boolean(tr.querySelector('th[scope=row]'));
    tr.classList.toggle('wh-rtd--hasrowheader', scoperow);

    const scopecol = Boolean(tr.querySelector('th[scope=col]'));
    tr.classList.toggle('wh-rtd--hascolheader', scopecol);
  }
}
