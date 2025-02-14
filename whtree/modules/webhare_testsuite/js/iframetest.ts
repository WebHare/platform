/* this library is loaded into the iframe using InitializeWithAssetpack by test tollium.components.testiframe */

import { sleep } from "@webhare/std";
import * as test from "@webhare/test";
import { Host, createTolliumImage, type HostProtocol, type HostContext, type GuestProtocol, setupGuest } from "@webhare/tollium-iframe-api";

interface OurHostProtocol extends HostProtocol {
  greeting: { g: string };
  multiplied: { n: number };
  imagedetails: { src: string; width: number; height: number };
}

const host = new Host<OurHostProtocol>();

async function init(context: HostContext, initData: { my_init_info: string }) {
  await sleep(5);
  test.eq("Hi Frame!", initData.my_init_info);
  console.log("init", initData);
  host.post("greeting", { g: "Hello from the iframe!" });
}

const myEndpoints: GuestProtocol = {
  multiply: (n: number) => host.post("multiplied", { n: n * n }),
  createImage: async (img: string) => {
    host.post("imagedetails", await createTolliumImage(img, 16, 16, "c"));
  }
};

setupGuest(init, myEndpoints);
