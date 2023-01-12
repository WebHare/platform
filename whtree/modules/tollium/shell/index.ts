/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

/* @mod-tollium/shell/ is a slow restructuring of the Tollium Application Portal under this root
*/

import "./desktop";

//---- legacy imports below this line ---
import IndyShell from '@mod-tollium/web/ui/js/shell';


export default function startTolliumShell() {
  const shell = new IndyShell({
    applicationportal: location.href.split('#')[0], //the shell will always talk back to the applicationportal that started it - and we need to pass the full URL to get ?app= to work
  });
}
