import { create, toDataURL } from "qrcode";
import { createSharpImageFromBlob } from "@webhare/services/src/descriptor";

/**
 * QR code encoding options
 */
type QRCodeOptions = {
  /** Max output size in pixels, defaults to 256 (=256x256 pixels) */
  size?: number;
  /** QR code margin in modules, defaults to 4 modules */
  margin?: number;
  /** Draw color (CSS color value), defaults to black */
  colorDark?: string;
  /** Background color (CSS color value), defaults to white */
  colorLight?: string;
  /** Error correction level, one of "L", "M", "Q" or "H", defaults to "H" (=highest) */
  correctLevel?: "L" | "M" | "Q" | "H";
  /** A logo to add to the QR code. Adding a logo may require you to tune the QR code size or error correction */
  logo?: Blob;
  /** Override the logo size if the QR code doesn't work with the automatically determined logo size (the size is in modules
      (blocks), the logo is rendered with a padding of 1 module on each side within this size) */
  logoSize?: number;
};

/**
 * Generate a QR code
 * @param text The text
 * @param options Encoding options
 * @returns The QR code as a PNG File
 */
export async function createQRCode(text: string, options?: QRCodeOptions) {
  const qrOptions = {
    errorCorrectionLevel: options?.correctLevel ?? "H",
  };
  const renderOptions = {
    ...qrOptions,
    margin: options?.margin ?? 4,
    width: options?.size ?? 256,
    color: {
      dark: options?.colorDark ?? "#000000",
      light: options?.colorLight ?? "#ffffff",
    },
  };
//throw new Error(JSON.stringify(renderOptions,undefined,2));
  // Create the QR code and fetch it into a blob
  const dataUrl = await toDataURL(text, renderOptions);
  let dataBlob = await (await fetch(dataUrl)).blob();

  // Check if a logo should be added
  if (options?.logo?.size) {
    const qr = await createSharpImageFromBlob(dataBlob);
    // Too bad we can't just use the resulting QRCode to render it, but we want the number of modules for our calculations here
    const count = create(text, qrOptions).modules.size;
    const size = (await qr.metadata()).width / (count + 2 * renderOptions.margin) || 1;

    let logoSize = options.logoSize;
    if (!logoSize) {
      // Get the number of modules we can use within the error correction level
      const modules = count * count;
      let lm = 0;
      switch (qrOptions.errorCorrectionLevel) {
        case "L": { lm = 5 * modules / 100; break; } // L: up to 7% damage
        case "M": { lm = 10 * modules / 100; break; } // M: up to 15% damage
        case "Q": { lm = 12 * modules / 100; break; } // Q: up to 25% damage
        case "H": { lm = 15 * modules / 100; break; } // H: up to 30% damage
      }
      // Get the size of the square to put the logo in
      logoSize = Math.floor(Math.sqrt(lm));
    }
    // Make sure the logo lines up with the modules
    if (logoSize % 2 !== count % 2)
      --logoSize;
    // We want a border of 1 module around the logo, so we need at least 3 modules in size
    if (logoSize < 3)
      logoSize = 0;

    // Read and resize the logo
    if (logoSize) {
      const logo = await createSharpImageFromBlob(options.logo);
      const logoWidthHeight = Math.floor((logoSize - 2) * size);
      logo.resize(logoWidthHeight, logoWidthHeight, { fit: "inside" });

      // Add an empty background after the logo
      const bgWidthHeight = Math.ceil(logoSize * size);
      qr.composite([
        { input: { create: { width: bgWidthHeight, height: bgWidthHeight, channels: 3, background: renderOptions.color.light } } },
        { input: Buffer.from(await logo.png().toBuffer()) },
      ]);
      dataBlob = new Blob([await qr.png().toBuffer()]);
    }
  }
  return new File([dataBlob], "qr.png", { type: "image/png" });
}
