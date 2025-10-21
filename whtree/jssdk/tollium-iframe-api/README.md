# Tollium iframe API

This API can be used in iframes loaded within Tollium's 'iframe' component to communicate between server and client and to
integrate with the Tollium user interface.

## Communicating with the Tollium backend

Add an iframe component to a screen:

```xml
<iframe name="myframe" onclientmessage="onframemessage" />
```

The iframe component can receive and send messages:

```harescript
MACRO OnFrameMessage(STRING message, RECORD data)
{
  // Do something with the message
  this->RunSimpleScreen("info", `Got message of type ${message}`);

  // Send a message back
  ^myframe->Post("response", [ msg := "Thanks for the message" ]);
}
```

We recommend having the iframe define the protocol for messages it will send the host:

```typescript

interface OurHostProtocol {
  greeting: { g: string };
  multiplied: { n: number };
}

const host = new Host<OurHostProtocol>();
```

You can then send messages to the host using `host.post(...)` and define endpoints for messages it will receive from the host:

```typescript
async function init(context: HostContext, initData: { my_init_info: string }) {
  console.log("init", initData);
  host.post("greeting", { g: "Hello from the iframe!" });
}

const myEndpoints: GuestProtocol = {
  multiply: (n: number) => host.post("multiplied", { n: n * n }),
  ...
};

setupGuest(init, myEndpoints);
```

The iframe guest code *must* invoke setupGuest before messages are actually sent and received. They will be queued until the
`init` callback, if any, has successfully completed. If needed you should verify the origin of the host loading your iframe
inside this callback.

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

### Tollium styling

The `tollium.css` stylesheet can be used in iframes loaded within Tollium's 'iframe' component to more seamlessly blend in
with the Tollium interface. In the future, this package will be used to centralize all Tollium styling and skinning.

Just import the stylesheet to activate some basic styling:

```typescript
import "@webhare/tollium-iframe-api/styling/tollium.css";
```

This stylesheet sets some default font, color and border styling on the html element (to show borders, set the `border-width`
to `var(--tollium-border-width)`) and loads the Roboto font used by Tollium. It also exposes some CSS variables.

```css
#mydiv
{
  outline: 2px solid var(--tollium-color-accent);
}
```

To use style elements (colors etc.) from TypeScript or listen to theme changes, use `getTheme` to get the `theme` object,
which exposes properties for the Tollium style properties.

```typescript
import { getTheme } from "@webhare/tollium-iframe-api";

const theme = getTheme();
document.getElementById("mydiv").style.outline = `2px solid ${theme.colorAccent}`;
```

The currenly active theme is added to the html element's class list as `tollium-theme-<name>`, which is used to automatically
update the CSS variables when the theme changes. If you need to more explicitly handle theme changes, you can listen for the
`change` event on the `theme` object:

```typescript
import { getTheme } from "@webhare/tollium-iframe-api";

const theme = getTheme();
theme.on("change", () => console.info("The theme is now", theme.name));
```

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

## Security considerations

The iframe should use a `Content-Security-Policy: frame-ancestors...` header to ensure it's not loaded by an unexpected host.
If it's not possible to protect the guest page this way we recommend verifying the origin in the init callback to ensure it
has the expected value.

Avoid using `postMessage` and `message` event listeners directly.
