/** Get the current script name */
export function getScriptName() {
  //require.main is not set until the main code runs and the bridge may connect before it does.
  return globalThis.process?.argv?.[1] ?? require.main ?? "<unknown JavaScript script>";
}
