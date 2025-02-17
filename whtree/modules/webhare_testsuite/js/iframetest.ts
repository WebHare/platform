/* this library is loaded into the iframe using InitializeWithAssetpack by test tollium.components.testiframe */

import { sleep } from "@webhare/std";
import * as test from "@webhare/test";
import { Host, createTolliumImage, type HostContext, type GuestProtocol, setupGuest } from "@webhare/tollium-iframe-api";

interface OurHostProtocol {
  greeting: { g: string; initinfo: string; initcount: number };
  multiplied: { n: number };
  imagedetails: { src: string; width: number; height: number };
}

const host = new Host<OurHostProtocol>();

let initcount = 0;

async function init(context: HostContext, initData: { my_init_info: string }) {
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
