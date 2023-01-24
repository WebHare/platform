import * as dompack from 'dompack';

export function fixupScopeTRs(node: HTMLElement) {
  for (const tr of dompack.qSA(node, 'tr')) {
    const scoperow = Boolean(tr.querySelector('th[scope=row]'));
    tr.classList.toggle('wh-rtd--hasrowheader', scoperow);

    const scopecol = Boolean(tr.querySelector('th[scope=col]'));
    tr.classList.toggle('wh-rtd--hascolheader', scopecol);
  }
}
