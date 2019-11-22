import * as dompack from 'dompack';
import { qSA } from 'dompack';

export function fixupScopeTRs(node)
{
  for(let tr of qSA(node, 'tr'))
  {
    let scoperow = !!tr.querySelector('th[scope=row]');
    tr.classList.toggle('wh-rtd--hasrowheader', scoperow);

    let scopecol = !!tr.querySelector('th[scope=col]');
    tr.classList.toggle('wh-rtd--hascolheader', scopecol);
  }
}
