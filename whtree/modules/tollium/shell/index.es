/* @mod-tollium/shell/ is a slow restructuring of the Tollium Application Portal under this root
*/

import "./desktop";

//---- legacy imports below this line ---
import IndyShell from '@mod-tollium/web/ui/js/shell';

export default function startTolliumShell()
{
  window.$shell = new IndyShell;
}
