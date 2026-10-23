import { getResource } from "@mod-webhare_testsuite/tests/system/nodejs/data/calls";
import { compareSharpImages } from "@mod-webhare_testsuite/tests/system/nodejs/data/image-fetch";
import { createSharpImage } from "@webhare/deps";
import { getSharpResizeOptions } from "@mod-platform/js/cache/imgcache";
import { createQRCode, createdResizedSharpImage, resizeImage } from "@webhare/graphics";
import { ResourceDescriptor } from "@webhare/services";
import { createSharpImageFromBlob } from "@webhare/services/src/descriptor";
import * as test from "@webhare/test-backend";

test.runTests([
  "Resize images",
  async function () {
    //TODO it'd be nice if createSharpImage also supported the createSharpImage(options) syntax, avoiding the first 'undefined' parameter here
    const source = await createSharpImage({ create: { width: 80, height: 40, channels: 3, background: "#ff0000" } });
    const resource = await ResourceDescriptor.from(await source.png().toBuffer(), { getImageMetadata: true, fileName: "source.image.png" });

    const sharpImage = await createdResizedSharpImage(resource, { method: "fit", width: 20, height: 20 });
    const result = await sharpImage.png().toBuffer({ resolveWithObject: true });
    test.eqPartial({ width: 20, height: 10, format: "png" }, result.info);

    const file = await resizeImage(resource, { method: "fit", width: 20, height: 20 });
    test.assert(file instanceof File);
    test.eq("source.image.png", file.name);
    test.eq("image/png", file.type);
    test.eqPartial({ width: 20, height: 10, format: "png" }, await (await createSharpImage(await file.bytes())).metadata());

    for (const method of ["fitCanvas", "scaleCanvas"] as const) {
      const options = { method, width: 20, height: 20, bgColor: 0xff0000ff };
      const canvasImage = await createdResizedSharpImage(resource, options);
      const canvasFile = await resizeImage(resource, options);
      for (const image of [canvasImage, await createSharpImage(await canvasFile.bytes())]) {
        const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true });
        test.eqPartial({ width: 20, height: 20, channels: 3 }, info);
        test.eq([0, 0, 255], [...data.subarray(0, 3)]);
        const center = (10 * info.width + 10) * info.channels;
        test.eq([255, 0, 0], [...data.subarray(center, center + 3)]);
      }
    }

    for (const [format, extension, sharpFormat] of [
      ["image/jpeg", ".jpg", "jpeg"],
      ["image/png", ".png", "png"],
      ["image/webp", ".webp", "webp"],
      ["image/avif", ".avif", "heif"],
      ["image/gif", ".gif", "gif"]
    ] as const) {
      const converted = await resizeImage(resource, { method: "fill", width: 10, height: 10, format });
      test.eq("source.image" + extension, converted.name);
      test.eq(format, converted.type);
      test.eqPartial({ width: 10, height: 10, format: sharpFormat }, await (await createSharpImage(await converted.bytes())).metadata());
    }

    const unchanged = await createdResizedSharpImage(resource, { method: "none", noForce: true });
    test.eqPartial({ width: 80, height: 40, format: "png" }, await unchanged.metadata());
    const unchangedFile = await resizeImage(resource, { method: "none", noForce: true, format: "keep" });
    test.eq("source.image.png", unchangedFile.name);
    test.eq("image/png", unchangedFile.type);
    test.eqPartial({ width: 80, height: 40, format: "png" }, await (await createSharpImage(await unchangedFile.bytes())).metadata());
    test.eq(Buffer.from(await resource.file.arrayBuffer()), Buffer.from(await unchangedFile.arrayBuffer()));

    const jpegResource = await ResourceDescriptor.from((await getResource("mod::system/web/tests/snowbeagle.jpg")).file, { getImageMetadata: true });
    for (const method of [
      { method: "none", noForce: true },
      { method: "fit", width: 500, height: 500, noForce: true, format: "keep" }
    ] as const) {
      const jpegFile = await resizeImage(jpegResource, method);
      test.eq("image/jpeg", jpegFile.type);
      test.eq(Buffer.from(await jpegResource.file.arrayBuffer()), Buffer.from(await jpegFile.arrayBuffer()));
    }

    const grayscaleOptions = { method: "none", noForce: true, grayscale: true } as const;
    const grayscaleImage = await createdResizedSharpImage(resource, grayscaleOptions);
    const grayscaleFile = await resizeImage(resource, grayscaleOptions);
    for (const image of [grayscaleImage, await createSharpImage(await grayscaleFile.bytes())]) {
      const rendered = await createSharpImage(await image.png().toBuffer());
      const { data, info } = await rendered.toColourspace("srgb").removeAlpha().raw().toBuffer({ resolveWithObject: true });
      test.eqPartial({ width: 80, height: 40, channels: 3 }, info);
      test.eq(data[0], data[1]);
      test.eq(data[1], data[2]);
      test.assert(data[0] > 0 && data[0] < 255);
    }
    test.assert(getSharpResizeOptions(resource, { method: "none", noForce: true, blur: 1, format: "keep" }) !== null);
    test.eq(null, getSharpResizeOptions(resource, { method: "none", noForce: true, blur: 0, format: "keep" }));

    const unnamed = await ResourceDescriptor.from(await source.png().toBuffer(), { getImageMetadata: true });
    test.eq("image.jpg", (await resizeImage(unnamed, { method: "none", format: "image/jpeg" })).name);
    test.eq({ width: 80, height: 40, fileName: "source.image.png" }, { width: resource.width, height: resource.height, fileName: resource.fileName });

    const unscanned = await ResourceDescriptor.from(await source.png().toBuffer(), { mediaType: "image/png" });
    await test.throws(/Width and height are required/, createdResizedSharpImage(unscanned, { method: "fit", width: 10 }));
    const text = await ResourceDescriptor.from("not an image", { mediaType: "text/plain" });
    await test.throws(/not supported for resizing/, resizeImage(text, { method: "none" }));
  },

  "Create QR codes",
  async function () {
    const logo = (await getResource("mod::tollium/webdesigns/webinterface/web/img/favicon/apple-touch-icon.png")).file;
    const qrCode = await createQRCode("https://webhare.dev/", {
      size: 500,
      correctLevel: "L",
      colorDark: "#52aefe",
      colorLight: "#4a4a4a",
      logo,
      logoSize: 15,
    });
    const qrSharp = await createSharpImageFromBlob(qrCode);
    const refCode = (await getResource("mod::webhare_testsuite/tests/jssdk/services/data/qr.png")).file;
    const refSharp = await createSharpImageFromBlob(refCode);
    await compareSharpImages(refSharp, qrSharp);
  }
]);
