import { WebHareBlob } from "@webhare/services";

declare global {
  interface GlobalEventHandlersEventMap {
    "webhare_testsuite:testdetailevent": CustomEvent<{ x: number }>;
  }
}

function blobSink(x: Blob) {
}

export async function testBlob() {
  const whblob = WebHareBlob.from("Hello, world!");
  blobSink(whblob);

  //adding referece lib=webworker broke extending GlobalEventHandlersEventMap because addEventListener then refers to DedicatedWorkerGlobalScopeEventMap
  addEventListener('webhare_testsuite:testdetailevent', evt => {
    console.log(evt.detail.x);
  });
}
