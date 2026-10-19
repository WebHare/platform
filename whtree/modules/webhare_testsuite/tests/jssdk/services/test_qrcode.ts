import { getResource } from "@mod-webhare_testsuite/tests/system/nodejs/data/calls";
import { compareSharpImages } from "@mod-webhare_testsuite/tests/system/nodejs/data/image-fetch";
import { createQRCode } from "@webhare/services";
import { createSharpImageFromBlob } from "@webhare/services/src/descriptor";
import * as test from "@webhare/test-backend";

test.runTests([
  async function() {
    const logo = (await getResource("mod::tollium/webdesigns/webinterface/web/img/favicon/apple-touch-icon.png")).file;
    const qrCode = await createQRCode("https://webhare.dev/", {
      size: 500,
      correctLevel: "L",
      colorDark: "#52aefe",
      colorLight: "#4a4a4a",
      logo,
      logoSize:15,
    });
    const qrSharp = await createSharpImageFromBlob(qrCode);
    const refCode = (await getResource("mod::webhare_testsuite/tests/jssdk/services/data/qr.png")).file;
    const refSharp = await createSharpImageFromBlob(refCode);
    await compareSharpImages(refSharp, qrSharp);
  },
]);
