export class DevToolsSettings {
  //the values here are the defaults
  cssReload = true;
  fullReload = false;
  resourceReload = false;
  tools = true;
  showWarnings = true;
}

export const __settings = new DevToolsSettings();

export function getSettings(): Readonly<DevToolsSettings> {
  return __settings;
}
