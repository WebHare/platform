/* this library is loaded into the iframe using InitializeWithAssetpack by test tollium.components.testiframe */

import { sleep } from "@webhare/std";
import * as test from "@webhare/test";
import { Host, createTolliumImage, type HostContext, type GuestProtocol, setupGuest, tolliumActionEnabler } from "@webhare/tollium-iframe-api";

interface OurHostProtocol {
  greeting: { g: string; initinfo: string; initcount: number };
  multiplied: { n: number };
  imagedetails: { src: string; width: number; height: number };
  selected: { s: boolean };
}

const host = new Host<OurHostProtocol>();

let initcount = 0;
let focusNode: HTMLElement | null = null;

async function init(context: HostContext, initData: { my_init_info: string }) {
  if (!focusNode) {
    const styleNode = document.createElement("style");
    styleNode.innerText = `span.focusnode { background: #eeeeff; cursor: pointer; display: inline-block; } span.focusnode:focus { background: #ffeeee; }`;
    document.head.appendChild(styleNode);
    focusNode = document.createElement("span");
    focusNode.innerText = "focus test";
    focusNode.className = "focusnode";
    focusNode.tabIndex = 0;
    focusNode.addEventListener("focus", () => {
      host.post("selected", { s: true });
      tolliumActionEnabler([{}]);
    });
    focusNode.addEventListener("blur", () => {
      host.post("selected", { s: false });
      tolliumActionEnabler([]);
    });
    document.body.appendChild(focusNode);
  }

  await sleep(5);
  test.assert(context.origin);
  host.post("greeting", { g: "Hello from the iframe!", initcount: ++initcount, initinfo: initData.my_init_info });
}

const myEndpoints: GuestProtocol = {
  multiply: (n: number) => host.post("multiplied", { n: n * n }),
  createImage: async (img: string) => {
    host.post("imagedetails", await createTolliumImage(img, 16, 16, "c"));
  }
};

setupGuest(init, myEndpoints);

/////////////////////
// TypeScript Tests for tollium-iframe-aoi

// eslint-disable-next-line no-constant-condition
if (false) { //TS tests - these should all compile (or fail) as specified.
  setupGuest();
  setupGuest((context) => { });
  setupGuest(async (context) => { });
  setupGuest(async (context, initData?: string) => { });
  setupGuest(async (context, initData: string) => { });

  // @ts-expect-error -- this message is not in our protocol
  host.post("nosuchmessage", null);
  // @ts-expect-error -- does not conform to greeting protocol
  host.post("greeting", { g: "Hello from the iframe!" });
}
