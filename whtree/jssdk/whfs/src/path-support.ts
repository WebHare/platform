/** Historic WHFS Space contains the snapshots and the recyclebin and shouldn't normally be updated */
export function isHistoricWHFSSpace(path: string) {
  path = path.toUpperCase();
  if (path.startsWith("/WEBHARE-PRIVATE/PLATFORM/WHFS/") //WH6.0+ migrates all historic WHFS content to this space
    || path.startsWith("/WEBHARE-PRIVATE/SYSTEM/WHFS/SNAPSHOTS/") //WH5.9
    || path.startsWith("/WEBHARE-PRIVATE/SYSTEM/WHFS-VERSIONS/") //WH5.9
    || path.startsWith("/WEBHARE-PRIVATE/SYSTEM/WHFS-DRAFTS/") //WH5.9
    || path.startsWith("/WEBHARE-PRIVATE/SYSTEM/WHFS-AUTOSAVES/") //WH5.9
  )
    return true;
  return false;
}