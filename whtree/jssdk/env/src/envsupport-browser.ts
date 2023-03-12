export function getDefaultRPCBase() {
  return location.origin + "/";
}

export function registerDebugConfigChangedCallback(cb: () => void) {
  // no implementation in the browser
}
