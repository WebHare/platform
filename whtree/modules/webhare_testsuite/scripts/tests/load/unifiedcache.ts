/* Load test the image cache */

import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { run } from "@webhare/cli";
import { backendConfig } from "@webhare/services";
import { rmSync } from "node:fs";

run({
  main: async function () {
    //clean up img cache first
    rmSync(backendConfig.dataRoot + "caches/platform/uc", { recursive: true, force: true });

    const testsitejs = await test.getTestSiteJS();
    const snowbeagle = await testsitejs.openFile("photoalbum/snowbeagle.jpg");

    const promises = [];
    const totals = { numErrors: 0, numSuccess: 0 };

    for (let size = 1000; size < 2000; ++size) {
      //FIXME why can't I set baseurl ?
      const webpBeagle = snowbeagle.data.toResized({ method: "scale", format: "image/webp", width: size, height: size });
      const avifBeagle = snowbeagle.data.toResized({ method: "scale", format: "image/avif", width: size, height: size });

      test.eq(size, webpBeagle.width);

      promises.push(fetch(new URL(webpBeagle.link, backendConfig.backendURL)).then(async (response) => {
        if (!response.ok)
          throw new Error(`HTTP error on the ${size}x${size} webp: ${response.status}`);

        return response.arrayBuffer();
      }).then(() => { ++totals.numSuccess; }, () => { ++totals.numErrors; }));

      promises.push(fetch(new URL(avifBeagle.link, backendConfig.backendURL)).then(async (response) => {
        if (!response.ok)
          throw new Error(`HTTP error on the ${size}x${size} avif: ${response.status}`);

        return response.arrayBuffer();
      }).then(() => { ++totals.numSuccess; }, () => { ++totals.numErrors; }));
    }

    const start = Date.now();
    const timer = setInterval(() => {
      console.log(totals, `${Math.floor(totals.numSuccess / ((Date.now() - start) / 60000))} per minute`);
    }, 5000);
    await Promise.all(promises);
    clearInterval(timer);
  }
});
