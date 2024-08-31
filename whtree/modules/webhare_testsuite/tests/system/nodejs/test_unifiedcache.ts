import { getTestSiteJS, getTestSiteTemp, testSuiteCleanup } from "@mod-webhare_testsuite/js/testsupport";
import { createWRDTestSchema } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import { loadlib } from "@webhare/harescript";
import { backendConfig, ResourceDescriptor } from "@webhare/services";
import { explainImageProcessing, getUCSubUrl, getUnifiedCC, packImageResizeMethod, type ResourceMetaData } from "@webhare/services/src/descriptor";
import * as test from "@webhare/test";
import { beginWork, commitWork } from "@webhare/whdb";
import { openType } from "@webhare/whfs";
import { getSharpResizeOptions } from "@mod-platform/js/cache/imgcache";
import { createSharpImage, Sharp } from "@webhare/deps/src/deps";

async function testResizeMethods() {
  const examplePng = { width: 320, height: 240, mediaType: "image/png", rotation: 0, mirrored: false, refPoint: null } as const;
  const exampleBmp = { width: 320, height: 240, mediaType: "image/x-bmp", rotation: 0, mirrored: false, refPoint: null } as const;
  const exampleJpg = { width: 320, height: 240, mediaType: "image/jpeg", rotation: 0, mirrored: false, refPoint: null } as const;
  const exampleTiff = { width: 320, height: 240, mediaType: "image/tiff", rotation: 0, mirrored: false, refPoint: null } as const;
  const examplerefPoint = { width: 320, height: 240, mediaType: "image/png", rotation: 0, mirrored: false, refPoint: { x: 180, y: 180 } } as const;
  const exampleKikkertje = { width: 122, height: 148, mediaType: "image/jpeg", rotation: 0, mirrored: false, refPoint: null } as const;
  const exampleSnowbeagle = { width: 428, height: 284, mediaType: "image/jpeg", rotation: 0, mirrored: false, refPoint: null } as const;

  //Test sharp resize methods
  test.eq({
    resize: { width: 21, height: 25, fit: "cover" }, //scaling/stretching requires cover to prevent lines at the edges
    extract: null,
    format: "jpeg",
    formatOptions: { quality: 85 }
  }, getSharpResizeOptions(exampleKikkertje, { method: "scale", setWidth: 25, setHeight: 25 }));

  test.eq({
    resize: null,
    extract: { left: (428 - 100) / 2, top: (284 - 100) / 2, width: 100, height: 100 },
    format: "jpeg",
    formatOptions: { quality: 85 }
  }, getSharpResizeOptions(exampleSnowbeagle, { method: "crop", setHeight: 100, setWidth: 100 }));

  test.eq({
    resize: null,
    extract: { left: (428 - 100) / 2, top: (284 - 100) / 2, width: 100, height: 100 },
    format: "avif",
    formatOptions: { lossless: false }
  }, getSharpResizeOptions(exampleSnowbeagle, { method: "crop", setHeight: 100, setWidth: 100, format: "image/avif" }));

  test.eq({
    resize: { width: 320, height: 240, fit: "cover" },
    extract: null,
    format: "avif",
    formatOptions: { lossless: true }
  }, getSharpResizeOptions(examplePng, { method: "none", format: "image/avif" }));

  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/png", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(examplePng, { method: "none" }));

  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/png", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleBmp, { method: "none", format: "image/png" }));

  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/png", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleBmp, { method: "none", format: "image/png", noForce: true }));
  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/png", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: false, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleBmp, { method: "none", format: "image/png", noForce: false }));

  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/png", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: false, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0, refPoint: { x: 180, y: 180 } }
    , explainImageProcessing(examplerefPoint, { method: "none", format: "image/png", noForce: false }));

  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/png", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleBmp, { method: "none" }));

  //non web formats should still be converted (tiff->jpeg, bmp->png)
  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleTiff, { method: "none" }));
  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: false, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleTiff, { method: "none", noForce: false }));
  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/png", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleBmp, { method: "none" }));
  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/png", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: false, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleBmp, { method: "none", noForce: false }));

  //Fit reduces a too-big input canvas and will return a canvas of varying size. Fitcanvas will always return a canvas of setWidth x setHeight and center the image

  //equal dimensions
  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "fit", setWidth: 320, setHeight: 240 }));
  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "fitcanvas", setWidth: 320, setHeight: 240 }));
  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleTiff, { method: "fit", setWidth: 320, setHeight: 240 }));

  //on a 640X480 canvas, fit won't change a thing. fitcanvas will grow it.
  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "fit", setWidth: 640, setHeight: 480 })
  );
  test.eqPartial({ outWidth: 640, outHeight: 480, outType: "image/jpeg", renderX: 160, renderY: 120, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "fitcanvas", setWidth: 640, setHeight: 480 })
  );

  //on a 200x100 canvas, fit should go for 134x100. fitcanvas should still go for 200x100 but horizontally center it
  test.eqPartial({ outWidth: 134, outHeight: 100, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 134, renderHeight: 100, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "fit", setWidth: 200, setHeight: 100 })
  );
  test.eqPartial({ outWidth: 200, outHeight: 100, outType: "image/jpeg", renderX: 33, renderY: 0, renderWidth: 134, renderHeight: 100, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "fitcanvas", setWidth: 200, setHeight: 100 })
  );

  //Fitting to 640x0 (fit: 320x240, fitcanvas: 640x240)
  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "fit", setWidth: 640, setHeight: 0 })
  );
  test.eqPartial({ outWidth: 640, outHeight: 240, outType: "image/jpeg", renderX: 160, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "fitcanvas", setWidth: 640, setHeight: 0 })
  );
  //Fitting to 200x0 canvas, fit should go for 200x150. fitcanvas agrees
  test.eqPartial({ outWidth: 200, outHeight: 150, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 200, renderHeight: 150, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "fit", setWidth: 200, setHeight: 0 })
  );
  test.eqPartial({ outWidth: 200, outHeight: 150, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 200, renderHeight: 150, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "fitcanvas", setWidth: 200, setHeight: 0 })
  );
  //Fitting to 0x480 (fit: 320x240, fitcanvas: 320x480)
  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "fit", setWidth: 0, setHeight: 480 })
  );
  test.eqPartial({ outWidth: 320, outHeight: 480, outType: "image/jpeg", renderX: 0, renderY: 120, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "fitcanvas", setWidth: 0, setHeight: 480 })
  );
  //Fitting to 0x100 canvas, fit should go for 134x100. fitcanvas agrees
  test.eqPartial({ outWidth: 134, outHeight: 100, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 134, renderHeight: 100, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "fit", setWidth: 0, setHeight: 100 })
  );
  test.eqPartial({ outWidth: 134, outHeight: 100, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 134, renderHeight: 100, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "fitcanvas", setWidth: 0, setHeight: 100 })
  );

  //refPoint is irrelevant for cutoffs (but still scaled)
  test.eqPartial({
    outWidth: 120, outHeight: 90, outType: "image/png", renderX: 0, renderY: 0, renderWidth: 120, renderHeight: 90, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0, refPoint: { x: 68, y: 68 }
  }, explainImageProcessing(examplerefPoint, { method: "fit", setWidth: 120, setHeight: 120 }));

  test.eqPartial({
    outWidth: 320, outHeight: 240, outType: "image/png", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0, refPoint: { x: 180, y: 180 }
  }, explainImageProcessing(examplerefPoint, { method: "fit", setWidth: 320, setHeight: 0 }));

  //refPoint is irrelevant for cutoffs (but still scaled)
  test.eqPartial({
    outWidth: 120, outHeight: 120, outType: "image/png", renderX: 0, renderY: 15, renderWidth: 120, renderHeight: 90, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0, refPoint: { x: 68, y: 83 }
  }, explainImageProcessing(examplerefPoint, { method: "fitcanvas", setWidth: 120, setHeight: 120 }));


  //Scale

  //equal dimensions
  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "scale", setWidth: 320, setHeight: 240 }));
  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "scalecanvas", setWidth: 320, setHeight: 240 }));

  //on a 640X480 canvas, scale and scalecanvas will grow it.
  test.eqPartial({ outWidth: 640, outHeight: 480, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 640, renderHeight: 480, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "scale", setWidth: 640, setHeight: 480 })
  );
  test.eqPartial({ outWidth: 640, outHeight: 480, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 640, renderHeight: 480, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "scalecanvas", setWidth: 640, setHeight: 480 })
  );

  //on a 640X400 canvas, scale and scalecanvas will grow it, but scalecanvas will return 640x400, scale will return 534x400
  test.eqPartial({ outWidth: 534, outHeight: 400, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 534, renderHeight: 400, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "scale", setWidth: 640, setHeight: 400 })
  );
  test.eqPartial({ outWidth: 640, outHeight: 400, outType: "image/jpeg", renderX: 53, renderY: 0, renderWidth: 534, renderHeight: 400, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "scalecanvas", setWidth: 640, setHeight: 400 })
  );


  //on a 640X0 canvas, scale and scalecanvas will grow it.
  test.eqPartial({ outWidth: 640, outHeight: 480, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 640, renderHeight: 480, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "scale", setWidth: 640, setHeight: 0 })
  );
  test.eqPartial({ outWidth: 640, outHeight: 480, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 640, renderHeight: 480, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "scalecanvas", setWidth: 640, setHeight: 0 })
  );

  //on a 0x400 canvas, scale and scalecanvas will grow it.
  test.eqPartial({ outWidth: 534, outHeight: 400, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 534, renderHeight: 400, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "scale", setWidth: 0, setHeight: 400 })
  );
  test.eqPartial({ outWidth: 534, outHeight: 400, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 534, renderHeight: 400, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "scalecanvas", setWidth: 0, setHeight: 400 })
  );

  //refPoint is irrelevant for cutoffs (but still scaled)
  test.eqPartial({
    outWidth: 120, outHeight: 90, outType: "image/png", renderX: 0, renderY: 0, renderWidth: 120, renderHeight: 90, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0, refPoint: { x: 68, y: 68 }
  }
    , explainImageProcessing(examplerefPoint, { method: "scale", setWidth: 120, setHeight: 120 }));

  //refPoint is irrelevant for cutoffs (but still scaled)
  test.eqPartial({
    outWidth: 120, outHeight: 120, outType: "image/png", renderX: 0, renderY: 15, renderWidth: 120, renderHeight: 90, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0, refPoint: { x: 68, y: 83 }
  }
    , explainImageProcessing(examplerefPoint, { method: "scalecanvas", setWidth: 120, setHeight: 120 }));


  //Fill

  //equal dimensions
  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "fill", setWidth: 320, setHeight: 240 }));

  //fill to 640X480 canvas, simply stretches it
  test.eqPartial({ outWidth: 640, outHeight: 480, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 640, renderHeight: 480, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "fill", setWidth: 640, setHeight: 480 })
  );

  //fill to 640x400, render a 640x480 picture but position it at -40
  test.eqPartial({ outWidth: 640, outHeight: 400, outType: "image/jpeg", renderX: 0, renderY: -40, renderWidth: 640, renderHeight: 480, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "fill", setWidth: 640, setHeight: 400 })
  );

  //fill to 640x0, render a 640x480 picture
  test.eqPartial({ outWidth: 640, outHeight: 480, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 640, renderHeight: 480, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "fill", setWidth: 640, setHeight: 0 })
  );
  //fill to 0x400, render a 534x400 picture
  test.eqPartial({ outWidth: 534, outHeight: 400, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 534, renderHeight: 400, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "fill", setWidth: 0, setHeight: 400 })
  );

  //in the output, the image must be rendered somewhat more to the left (-23 (22.5) instead of -20)
  test.eqPartial({
    outWidth: 120, outHeight: 120, outType: "image/png", renderX: -23, renderY: 0, renderWidth: 160, renderHeight: 120, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0, refPoint: { x: 67, y: 90 }
  }, explainImageProcessing(examplerefPoint, { method: "fill", setWidth: 120, setHeight: 120 }));


  //Crop

  //equal dimensions
  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "crop", setWidth: 320, setHeight: 240 }));
  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "cropcanvas", setWidth: 320, setHeight: 240 }));

  //crop to 640X480 canvas, no-op
  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "crop", setWidth: 640, setHeight: 480 })
  );
  test.eqPartial({ outWidth: 640, outHeight: 480, outType: "image/jpeg", renderX: 160, renderY: 120, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "cropcanvas", setWidth: 640, setHeight: 480 })
  );

  //crop to 200x100, render a 320x240 picture but position it at -60,-70
  test.eqPartial({ outWidth: 200, outHeight: 100, outType: "image/jpeg", renderX: -60, renderY: -70, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "crop", setWidth: 200, setHeight: 100 })
  );
  test.eqPartial({ outWidth: 200, outHeight: 100, outType: "image/jpeg", renderX: -60, renderY: -70, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "cropcanvas", setWidth: 200, setHeight: 100 })
  );

  //crop to 640x120 (or only crop height to 320x120), render a 320x240 picture but position it at -60
  test.eqPartial({ outWidth: 320, outHeight: 120, outType: "image/jpeg", renderX: 0, renderY: -60, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "crop", setWidth: 640, setHeight: 120 })
  );
  test.eqPartial({ outWidth: 640, outHeight: 120, outType: "image/jpeg", renderX: 160, renderY: -60, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "cropcanvas", setWidth: 640, setHeight: 120 })
  );

  //in the output, the image must be rendered somewhat more to the left and top (-68 (67.5) instead of -60 and -105 instead of -70)
  test.eqPartial({
    outWidth: 200, outHeight: 100, outType: "image/png", renderX: -68, renderY: -105, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0, refPoint: { x: 112, y: 75 }
  }, explainImageProcessing(examplerefPoint, { method: "crop", setWidth: 200, setHeight: 100 }));


  //Stretch
  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "stretch", setWidth: 320, setHeight: 240 }));
  test.eqPartial({ outWidth: 320, outHeight: 120, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 120, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "stretch", setWidth: 320, setHeight: 120 }));

  //refPoint is irrelevant for cutoffs (but still scaled)
  test.eqPartial({
    outWidth: 120, outHeight: 120, outType: "image/png", renderX: 0, renderY: 0, renderWidth: 120, renderHeight: 120, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0, refPoint: { x: 67, y: 90 }
  }, explainImageProcessing(examplerefPoint, { method: "stretch", setWidth: 120, setHeight: 120 }));


  //Stretch-x: resize in x direction whilst treating the y-setWidth as a limit
  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "stretch-x", setWidth: 320, setHeight: 240 }));
  //stretch-x to 640x500. the result should be 640x480
  test.eqPartial({ outWidth: 640, outHeight: 480, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 640, renderHeight: 480, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "stretch-x", setWidth: 640, setHeight: 500 }));
  //stretch-x to 640x400. y should be constrained, so the result should be 640x400
  test.eqPartial({ outWidth: 640, outHeight: 400, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 640, renderHeight: 400, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "stretch-x", setWidth: 640, setHeight: 400 }));

  //stretch/stretch-x to 640x0. expect 640x480. deny 'stretch' without height
  test.eqPartial({ outWidth: 640, outHeight: 480, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 640, renderHeight: 480, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "stretch-x", setWidth: 640, setHeight: 0 }));
  test.throws(/setHeight is required/, () => explainImageProcessing(exampleJpg, { method: "stretch", setWidth: 640, setHeight: 0 }));

  //Stretch-y: resize in y direction whilst treating the x-setWidth as a limit
  test.eqPartial({ outWidth: 320, outHeight: 240, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 240, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "stretch-y", setWidth: 320, setHeight: 240 }));
  //stretch-y to 640x500. the result should be 640x500
  test.eqPartial({ outWidth: 640, outHeight: 500, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 640, renderHeight: 500, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "stretch-y", setWidth: 640, setHeight: 500 }));
  //stretch-y to 640x400. x should be constrained, so the result should be 534x400
  test.eqPartial({ outWidth: 534, outHeight: 400, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 534, renderHeight: 400, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "stretch-y", setWidth: 640, setHeight: 400 }));

  //stretch/stretch-y to 0x480. expect 640x480. require stetch-y
  test.eqPartial({ outWidth: 640, outHeight: 480, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 640, renderHeight: 480, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "stretch-y", setWidth: 0, setHeight: 480 }));
  test.throws(/setWidth is required/, () => explainImageProcessing(exampleJpg, { method: "stretch", setWidth: 0, setHeight: 480 }));

  //stretch to 0x0. deny
  test.throws(/setWidth is required/, () => explainImageProcessing(exampleJpg, { method: "stretch", setWidth: 0, setHeight: 0 }));

  //quality support for jpeg
  test.eqPartial({ outWidth: 320, outHeight: 120, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 120, bgColor: 0x00FFFFFF, noForce: true, quality: 85, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "stretch", setWidth: 320, setHeight: 120 }));
  test.eqPartial({ outWidth: 320, outHeight: 120, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 120, bgColor: 0x00FFFFFF, noForce: true, quality: 75, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "stretch", setWidth: 320, setHeight: 120, quality: 75 }));
  test.eqPartial({ outWidth: 320, outHeight: 120, outType: "image/jpeg", renderX: 0, renderY: 0, renderWidth: 320, renderHeight: 120, bgColor: 0x00FFFFFF, noForce: true, quality: 95, grayscale: false, rotate: 0, mirror: false, hBlur: 0, vBlur: 0 }
    , explainImageProcessing(exampleJpg, { method: "stretch", setWidth: 320, setHeight: 120, quality: 95 }));
}

async function testImgMethodPacking() {
  let finalmethod;
  const unpack = await loadlib("wh::graphics/filters.whlib").GfxUnpackImageResizeMethod;
  finalmethod = await unpack(packImageResizeMethod({ method: "stretch", setWidth: 320, setHeight: 320, quality: 95, grayscale: true }));
  test.eq(95, finalmethod.quality);
  test.eq(true, finalmethod.grayscale);
  test.eq(true, finalmethod.fixorientation);

  finalmethod = await unpack(packImageResizeMethod({ method: "stretch", setWidth: 320, setHeight: 320, quality: 95, grayscale: true, fixOrientation: false }));
  test.eq(false, finalmethod.fixorientation);

  finalmethod = await unpack(packImageResizeMethod({ method: "fitcanvas", setWidth: 125, setHeight: 131, fixOrientation: true }));
  test.eq({ method: "fitcanvas", setwidth: 125, setheight: 131, format: "", bgcolor: 0x00FFFFFF, noforce: true, quality: 85, grayscale: false, fixorientation: true, hblur: 0, vblur: 0 }, finalmethod);

  finalmethod = await unpack(packImageResizeMethod({ method: "none" }));
  test.eq(false, finalmethod.fixorientation);
  test.eq("", finalmethod.format);

  finalmethod = await unpack(packImageResizeMethod({ method: "none", fixOrientation: true }));
  test.eq(true, finalmethod.fixorientation);

  finalmethod = await unpack(packImageResizeMethod({ method: "none", format: "image/png" }));
  test.eq(false, finalmethod.fixorientation);
  test.eq("image/png", finalmethod.format);

  finalmethod = await unpack(packImageResizeMethod({ method: "none", format: "image/gif", fixOrientation: true }));
  test.eq(true, finalmethod.fixorientation);
  test.eq("image/gif", finalmethod.format);

  finalmethod = await unpack(packImageResizeMethod({ method: "none", hBlur: 12345, vBlur: 4321 }));
  test.eq(12345, finalmethod.hblur);
  test.eq(4321, finalmethod.vblur);
}

async function testImgCacheTokens() {
  const examplePng = { width: 320, height: 240, mediaType: "image/png", hash: "u4HI1_mWV8E0UWndfoBvwsQr4PxwK7pdZLzYjWSw_0Q", rotation: 0, mirrored: false, refPoint: null, dbLoc: { source: 1, id: 123, cc: 456 } } as ResourceMetaData;
  const exampleRefPoint = { ...examplePng, refPoint: { x: 120, y: 180 } };

  async function analyze(suburl: string) {
    return await loadlib("mod::system/lib/internal/cache/imgcache.whlib").AnalyzeUnifiedURLToken(`i${suburl}/image.png`);
  }
  async function getHSUC(...args: unknown[]) {
    return await loadlib("mod::system/lib/internal/cache/imgcache.whlib").GetUCSubUrl(...args);
  }
  async function getHSCC(date: Date) {
    return await loadlib("mod::system/lib/internal/cache/imgcache.whlib").GetUnifiedCC(date);
  }

  const pngJsTok = getUCSubUrl({ method: "fill", setWidth: 25, setHeight: 25 }, examplePng, 1, '.png');
  const pngHsTok = await getHSUC({ method: "fill", setWidth: 25, setHeight: 25 }, examplePng, 1, 1, 123, 456, '.png');
  test.eq(pngJsTok, pngHsTok);
  test.eqPartial({ item: { type: 1, id: 123, cc: 456, resizemethod: { method: 'fill', setwidth: 25, setheight: 25 } } }, await analyze(pngHsTok));

  const refPointJsTok = getUCSubUrl({ method: "fill", setWidth: 25, setHeight: 25 }, exampleRefPoint, 1, '.png');
  const refPointHsTok = await getHSUC({ method: "fill", setWidth: 25, setHeight: 25 }, exampleRefPoint, 1, 1, 123, 456, '.png');
  test.assert(refPointJsTok !== pngJsTok, "A refpoint should affect the hash so the tokens cannot match");
  test.eq(refPointJsTok, refPointHsTok);

  const testdate = new Date(2021, 1, 1, 12, 34, 56, 789);
  test.eq(await getHSCC(testdate), getUnifiedCC(testdate));
}

async function fetchUCLink(url: string, expectType: string) {
  const finalurl = new URL(url, backendConfig.backendURL).href;
  const fetchResult = await fetch(finalurl);
  test.eq(200, fetchResult.status);
  test.eq(expectType, fetchResult.headers.get("content-type"));
  const fetchBuffer = await fetchResult.arrayBuffer();
  const fetchData = await ResourceDescriptor.from(Buffer.from(fetchBuffer), { getImageMetadata: true });
  return { resource: fetchData, finalurl, fetchBuffer };
}

async function compareSharpImages(expect: Sharp, actual: Sharp, maxMSE = 0) {
  const rawExpect = await expect.raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  const rawActual = await actual.raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  test.eq(rawExpect.info, rawActual.info);

  let totalDiff = 0; //squared absolute difference
  for (let row = 0; row < rawActual.info.height; ++row)
    for (let col = 0; col < rawActual.info.width; ++col)
      for (let channel = 0; channel < rawActual.info.channels; ++channel) {
        const idx = (row * rawActual.info.width + col) * rawActual.info.channels + channel;
        totalDiff += Math.sqrt(Math.abs(rawExpect.data[idx] - rawActual.data[idx]));
      }

  const mse = totalDiff / (rawActual.info.width * rawActual.info.height * rawActual.info.channels);
  if (mse > maxMSE)
    throw new Error(`MSE too high: ${mse} > ${maxMSE}`);
}

async function testImgCache() {
  const fish = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { getImageMetadata: true });
  test.throws(/Cannot use toResize/, () => fish.toResized({ method: "none" }));

  const testsitejs = await getTestSiteJS();
  const snowbeagle = await testsitejs.openFile("photoalbum/snowbeagle.jpg");
  const wrappedBeagle = snowbeagle.data.toResized({ method: "none" });
  test.eq(wrappedBeagle.link, (await loadlib("mod::system/lib/cache.whlib").WrapCachedImage(snowbeagle.data, { method: "none" })).link);
  await fetchUCLink(wrappedBeagle.link, "image/jpeg");

  const goldfishpng = await testsitejs.openFile("photoalbum/goudvis.png");
  const wrappedGoldfishPng = goldfishpng.data.toResized({ method: "none" });
  const dlFishPng = await fetchUCLink(wrappedGoldfishPng.link, "image/png");
  const imgFishPng = await createSharpImage(dlFishPng.fetchBuffer);

  //convert to WEBP using imagecache
  const wrappedGoldfishWebp = goldfishpng.data.toResized({ method: "none", format: "image/webp" });
  const dlFishWebp = await fetchUCLink(wrappedGoldfishWebp.link, "image/webp");
  await compareSharpImages(imgFishPng, await createSharpImage(dlFishWebp.fetchBuffer));

  //convert to AVIF using imagecache
  const wrappedGoldfishAvif = goldfishpng.data.toResized({ method: "none", format: "image/avif" });
  const dlFishAvif = await fetchUCLink(wrappedGoldfishAvif.link, "image/avif");
  await compareSharpImages(imgFishPng, await createSharpImage(dlFishAvif.fetchBuffer), 0.20);

  const kikkerdata = await openType("http://www.webhare.net/xmlns/beta/test").get(testsitejs.id) as any; //FIXME remove 'as any' as soon we have typings
  const wrappedKikker = kikkerdata.arraytest[0].blobcell.toResized({ method: "none" });
  await fetchUCLink(wrappedKikker.link, "image/jpeg");
  test.eq(wrappedKikker.link, (await loadlib("mod::system/lib/cache.whlib").WrapCachedImage(kikkerdata.arraytest[0].blobcell, { method: "none" })).link);

  //test BMP to WEBP
  const homersbrainBMP = await testsitejs.openFile("photoalbum/homersbrain.bmp");
  const wrappedHomersbrainWebp = homersbrainBMP.data.toResized({ method: "none", format: "image/webp" });
  const dlHomersbrainWebp = await fetchUCLink(wrappedHomersbrainWebp.link, "image/webp");

  const homersbrainPNG = await ResourceDescriptor.fromResource("mod::webhare_testsuite/tests/system/testdata/homersbrain.png", { getImageMetadata: true });
  const homersbrainSharp = await createSharpImage(await homersbrainPNG.resource.arrayBuffer());
  await compareSharpImages(homersbrainSharp, await createSharpImage(dlHomersbrainWebp.fetchBuffer), 0);
}

async function testFileCache() {
  await beginWork();
  const testsite = await getTestSiteJS();
  const tmpfolder = await getTestSiteTemp();
  const docxje = await tmpfolder.createFile("empty.docx", { data: await ResourceDescriptor.fromResource("mod::webhare_testsuite/tests/system/testdata/empty.docx") /* FIXME, publish: false*/ });
  const extensionless = await tmpfolder.createFile("extensionless", { data: await ResourceDescriptor.from(Buffer.from("\x00\x01\x02\x03")) });
  const oddity = await tmpfolder.createFile("Bowie Space!.oddity", { data: await ResourceDescriptor.from(Buffer.from("Space?")) });
  const oddity2 = await tmpfolder.createFile("Bowie Space!.oddity 2!", { data: await ResourceDescriptor.from(Buffer.from("Space?")) });

  await commitWork();

  const docxjelink = docxje.data.toLink({ fileName: "empty.docx" });
  test.eq(/\/empty.docx$/, docxjelink);
  const docxjelink_fetched = await fetch(new URL(docxjelink, backendConfig.backendURL));
  test.eq(200, docxjelink_fetched.status);
  test.eq("application/vnd.openxmlformats-officedocument.wordprocessingml.document", docxjelink_fetched.headers.get("content-type"));

  let odditylink = oddity.data.toLink({ baseURL: backendConfig.backendURL });
  test.eq(/\/bowie-space.oddity.bin$/, odditylink);
  let odditylink_fetched = await fetch(odditylink);
  test.eq(200, odditylink_fetched.status);
  test.eq("application/octet-stream", odditylink_fetched.headers.get("content-type"));

  odditylink = oddity.data.toLink({ allowAnyExtension: true, baseURL: testsite.webRoot });
  test.eq(/\/bowie-space.oddity$/, odditylink);
  odditylink_fetched = await fetch(odditylink);
  test.eq(200, odditylink_fetched.status);
  test.eq("application/octet-stream", odditylink_fetched.headers.get("content-type"));

  let oddity2link = oddity2.data.toLink();
  test.eq(/\/bowie-space.oddity-2.bin$/, oddity2link);
  let oddity2link_fetched = await fetch(new URL(oddity2link, backendConfig.backendURL));
  test.eq(200, oddity2link_fetched.status);
  test.eq("application/octet-stream", oddity2link_fetched.headers.get("content-type"));

  //TBH allowAnyExtension sounds like asking for trouble. Once we have a JS webserver attempt to fully lock down the content-type returned
  oddity2link = oddity2.data.toLink({ allowAnyExtension: true });
  test.eq(/\/bowie-space.oddity-2$/, oddity2link);
  oddity2link_fetched = await fetch(new URL(oddity2link, backendConfig.backendURL));
  test.eq(200, oddity2link_fetched.status);
  test.eq("application/octet-stream", oddity2link_fetched.headers.get("content-type"));

  const extensionlesslink = extensionless.data.toLink({ allowAnyExtension: true, baseURL: backendConfig.backendURL });
  test.eq(/\/extensionless$/, extensionlesslink);
  const extensionlesslink_fetched = await fetch(extensionlesslink);
  test.eq(200, extensionlesslink_fetched.status);
  test.eq("application/octet-stream", extensionlesslink_fetched.headers.get("content-type"));
}

async function testWRDImgCache() {
  const schema = await createWRDTestSchema();
  const fish = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { getImageMetadata: true }); //FIXME WRD should auto-complete metadata itself
  await beginWork();
  const unit_id = await schema.insert("whuserUnit", { wrdTitle: "Root unit", wrdTag: "TAG" });
  const personid = await schema.insert("wrdPerson", { testFile: fish, testImage: fish, whuserUnit: unit_id, wrdContactEmail: "goldfish@beta.webhare.net" });
  await commitWork();

  const wrappedGoldfish = await schema.getFields("wrdPerson", personid, ["testImage"]);
  test.assert(wrappedGoldfish);
  const fetchedGoldFishLink = wrappedGoldfish.testImage!.toResized({ method: "none" }).link;
  test.eq(/goudvis\.png$/, fetchedGoldFishLink);
  const fetchedGoldFish = await fetchUCLink(fetchedGoldFishLink, "image/png");
  test.eq(fetchedGoldFishLink, (await loadlib("mod::system/lib/cache.whlib").WrapCachedImage(wrappedGoldfish.testImage, { method: "none" })).link);
  const fetchedGoldFishDirect = await fetchUCLink(wrappedGoldfish.testImage!.toLink(), "image/png");
  test.eq(fetchedGoldFish.resource.hash, fetchedGoldFishDirect.resource.hash);
}


test.run([
  testSuiteCleanup,
  testResizeMethods,
  testImgMethodPacking,
  testImgCacheTokens,
  testImgCache,
  testFileCache,
  testWRDImgCache
]);
