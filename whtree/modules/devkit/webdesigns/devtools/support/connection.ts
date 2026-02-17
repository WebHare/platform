export const toolssocketdefer = Promise.withResolvers<WebSocket>(); //NOTE inited on demand.. as our imports may run before us!

export function getToolsSocketPromise() {
  return toolssocketdefer.promise;
}
