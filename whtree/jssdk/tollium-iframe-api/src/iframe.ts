// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/tollium-iframe-api" {
}

let imgQueueId = 0;
const imgQueue: Map<number, { id: number; imgname: string; resolve: (value: { src: string; width: number; height: number }) => void }> = new Map();

/** Post a message from the iframe to the Tollium component
*/
export function postTolliumMessage(message: Record<string, unknown>, origin = "*") {
  window.parent.postMessage({ $tolliumMsg: "message", message }, origin);
};

/** Show a menu at a given position
    @param menuName - The name of the menu to show
    @param pos - The position to show the menu at, relative to the top left of the iframe
*/
export function showTolliumContextMenu(menuName: string, pos: { x: number; y: number }, origin = "*") {
  window.parent.postMessage({ $tolliumMsg: "contextmenu", name: menuName, x: pos.x, y: pos.y }, origin);
};

/** Close any currently opened (context) menus */
export function closeAllTolliumMenus(origin = "*") {
  window.parent.postMessage({ $tolliumMsg: "closeallmenus" }, origin);
};

/** Check enabled state of all actions
    @param selectionflags - The flags for the current selection
*/
export function tolliumActionEnabler(selectionflags: string[], origin = "*") {
  window.parent.postMessage({ $tolliumMsg: "actionenabler", selectionflags: selectionflags }, origin);
};

/** Retrieve the source for an image
    @param imgname - The module:path/img name of the image
    @param width - The preferred width
    @param height - The preferred height
    @param color - The preferred color: black (for light backgrounds), color or white (for dark backgrounds)
    @returns Source and actual width and height of the created image
*/
export async function createTolliumImage(imgname: string, width: number, height: number, color: "b" | "c" | "w" = "b", origin = "*"): Promise<{ src: string; width: number; height: number }> {
  return new Promise(resolve => {
    const id = ++imgQueueId;
    imgQueue.set(id, { id, imgname, resolve });
    window.parent.postMessage({ $tolliumMsg: "createimage", id, imgname, width, height, color }, origin);
  });
}

// Listen for messages from the iframe
window.addEventListener("message", event => {
  switch (event.data.$tolliumMsg) {
    case "createdimage":
      {
        // The result of the 'createImage' call
        const queued = imgQueue.get(event.data.id);
        if (queued) {
          imgQueue.delete(queued.id);
          queued.resolve({ src: event.data.src, width: event.data.width, height: event.data.height });
        }
        break;
      }
  }
}, true);
