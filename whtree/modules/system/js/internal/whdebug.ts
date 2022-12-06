/** The WebHare debug flag framework */

const whdebug = process.env.WEBHARE_DEBUG?.split(',') ?? [];

export function isDebugTagEnabled(tag: string) : boolean
{
  //FIXME we still need to look into WebHare's global debug state and support broadcasted 'live' config udates too
  return whdebug.includes(tag);
}
