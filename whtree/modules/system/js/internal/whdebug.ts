/** The WebHare debug flag framework */

const whdebug = process.env.WEBHARE_DEBUG?.split(',') ?? [];

export function isDebugTagEnabled(tag: string) : boolean
{
  return whdebug.includes(tag);
}
