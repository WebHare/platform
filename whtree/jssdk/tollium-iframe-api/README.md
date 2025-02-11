# Tollium iframe API

This API can be used in iframes loaded within Tollium's 'iframe' component to communicate between server and client and to
integrate with the Tollium user interface.

## Communicating with the Tollium backend

Add an iframe component to a screen:

```xml
<iframe name="myframe" onmessage="onframemessage" />
```

The iframe component can receive and send messages:

```harescript
MACRO OnFrameMessage(RECORD message)
{
  // Do something with the message
  this->RunSimpleScreen("info", `Got message: ${message.msg}`);

  // Send a message back
  ^myframe->PostMessage([ msg := "Thanks for the message" ]);
}
```

In the loaded iframe, use the `postTolliumMessage` function to send messages. The standard 'message' event can be used to
listen for messages from the server.

```typescript
import { postTolliumMessage } from "@webhare/tollium-iframe-api";

window.addEventListener("message", message => {
  // Do something with the message
  console.info(`Got reply: ${message.msg}`);
});

// Send a message to the server
postTolliumMessage({ msg: "This is a message" });
```

## Integrating with the Tollium environment

### Context menus

Define the menu to show in xml:

```xml
<menu name="mycontextmenu">
  <item action="myaction" />
</menu>
```

In the loaded iframe, the `showTolliumContextMenu` function can be used to show a context menu at a given position. Any opened
context menus can be closed using `closeAllTolliumMenus`.

```typescript
import { closeAllTolliumMenus, showTolliumContextMenu } from "@webhare/tollium-iframe-api";

window.addEventListener("click", event => {
  closeAllTolliumMenus();
  showTolliumContextMenu("mycontextmenu", { x: event.clientX, y: event.clientY });
});
```

### Images

Use the `createTolliumImage` function to create a Tollium image. This function returns a Promise that resolves with the image
source url and the image's dimensions.

```typescript
import { createTolliumImage } from "@webhare/tollium-iframe-api";

createTolliumImage("tollium:objects/webhare", 16, 16, "c").then(image => {
  const img = <img src={image.src} width={image.width} height={image.height} />;
});
```
