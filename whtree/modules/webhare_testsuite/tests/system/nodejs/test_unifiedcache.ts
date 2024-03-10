import { getTestSiteJS } from "@mod-webhare_testsuite/js/testsupport";
import { loadlib } from "@webhare/harescript";
import { ResourceDescriptor } from "@webhare/services";
import { explainImageProcessing, getUCSubUrl, packImageResizeMethod, type ResourceMetaData } from "@webhare/services/src/descriptor";
import * as test from "@webhare/test";


async function testResizeMethods() {
  const examplePng = { width: 320, height: 240, mediaType: "image/png", rotation: 0, mirrored: false, refPoint: null } as const;
  const exampleBmp = { width: 320, height: 240, mediaType: "image/x-bmp", rotation: 0, mirrored: false, refPoint: null } as const;
  const exampleJpg = { width: 320, height: 240, mediaType: "image/jpeg", rotation: 0, mirrored: false, refPoint: null } as const;
  const exampleTiff = { width: 320, height: 240, mediaType: "image/tiff", rotation: 0, mirrored: false, refPoint: null } as const;
  const examplerefPoint = { width: 320, height: 240, mediaType: "image/png", rotation: 0, mirrored: false, refPoint: { x: 180, y: 180 } } as const;

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
  const examplePng = { width: 320, height: 240, mediaType: "image/png", hash: "u4HI1_mWV8E0UWndfoBvwsQr4PxwK7pdZLzYjWSw_0Q", rotation: 0, mirrored: false, refPoint: null } as ResourceMetaData;
  const exampleRefPoint = { ...examplePng, refPoint: { x: 120, y: 180 } };

  async function analyze(suburl: string) {
    return await loadlib("mod::system/lib/internal/cache/imgcache.whlib").AnalyzeUnifiedURLToken(`i${suburl}/image.png`);
  }
  async function getHSUC(...args: unknown[]) {
    return await loadlib("mod::system/lib/internal/cache/imgcache.whlib").GetUCSubUrl(...args);
  }

  const pngJsTok = getUCSubUrl({ method: "fill", setWidth: 25, setHeight: 25 }, examplePng, 1, 1, 123, 456, '.png');
  const pngHsTok = await getHSUC({ method: "fill", setWidth: 25, setHeight: 25 }, examplePng, 1, 1, 123, 456, '.png');
  test.eq(pngJsTok, pngHsTok);
  test.eqPartial({ item: { type: 1, id: 123, cc: 456, resizemethod: { method: 'fill', setwidth: 25, setheight: 25 } } }, await analyze(pngHsTok));

  const refPointJsTok = getUCSubUrl({ method: "fill", setWidth: 25, setHeight: 25 }, exampleRefPoint, 1, 1, 123, 456, '.png');
  const refPointHsTok = await getHSUC({ method: "fill", setWidth: 25, setHeight: 25 }, exampleRefPoint, 1, 1, 123, 456, '.png');
  test.assert(refPointJsTok !== pngJsTok, "A refpoint should affect the hash so the tokens cannot match");
  test.eq(refPointJsTok, refPointHsTok);
}

async function testImgCache() {
}

test.run([
  testResizeMethods,
  testImgMethodPacking,
  testImgCacheTokens,
  testImgCache
]);
