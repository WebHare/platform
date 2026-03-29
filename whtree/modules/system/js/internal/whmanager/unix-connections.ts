export function getSocketsBaseDir(serviceManagerId?: string): string | null {
  serviceManagerId ||= process.env.WEBHARE_SERVICEMANAGERID;
  if (!serviceManagerId)
    return null;

  //socket paths need to be short, so we need a /tmp/ subpoath
  return `/tmp/whsock.${serviceManagerId}/`;
}
