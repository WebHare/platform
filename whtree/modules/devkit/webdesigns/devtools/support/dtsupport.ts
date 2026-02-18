export function getToolsOrigin() {
  //@ts-expect-error unable to use import.meta in bundling yet
  return new URL(import.meta.url).origin;
}
