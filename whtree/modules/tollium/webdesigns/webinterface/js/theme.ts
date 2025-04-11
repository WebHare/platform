// This function is a stub for future dynamic theme switching
export function setTheme(name: string) {
  window.dispatchEvent(new CustomEvent("tollium-iframe-api:theme-change", { detail: { name } }));
}
