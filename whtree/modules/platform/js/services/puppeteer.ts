import { connectSharedPuppeteer, type Puppeteer } from "@webhare/deps";

/* Needed practical support:
RECORD screenshotdata := GenerateBrowserScreenshot(link; [ withalpha := TRUE ]);
RECORD screenshotdata := GenerateBrowserScreenshot(link, [ screenwidth/screenheight ]);
  I'm not seeing users of cutouts anymore, so they might as well switch over to TS APIs

*/

export async function generateBrowserScreenshot(url: string, options?: { withalpha: boolean; screenwidth: number; screenheight: number }): Promise<string> {
  await using browser = await connectSharedPuppeteer();
  const page = await browser.newPage();

  if (options?.screenheight && options?.screenwidth)
    await page.setViewport({ width: options.screenwidth, height: options.screenheight, deviceScaleFactor: 1 });

  await page.goto(url, { timeout: 30000 });

  if (options?.withalpha) {
    //kill html/body backgrounds
    await page.evaluate(`{
      document.documentElement.style.cssText += "; background: transparent !important";
      document.body.style.cssText += "; background: transparent !important";
    }`);
  }

  const screenshot = await page.screenshot({ type: "png", omitBackground: Boolean(options?.withalpha), encoding: "base64" });
  await page.close();
  return screenshot;
}

export async function generatePDF(url: string, options?: {
  delay?: number;
  margin?: {
    top?: string;
    left?: string;
    bottom?: string;
    right?: string;
  };
  format?: string;
  headertemplate?: string;
  footertemplate?: string;
  width?: string;
  height?: string;
  withalpha?: boolean;
}
): Promise<string> {
  await using browser = await connectSharedPuppeteer();

  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.goto(url, { timeout: 30000 });

  // Parse page options
  options ||= {};

  //Read options from HTML
  for (const prop of ["top", "left", "right", "bottom"] as const) {
    const val = await page.evaluate(p => document.querySelector(`meta[name=wh-chromepdf-margin-${p}]`)?.getAttribute("value"), prop) as string | null;
    if (val) {
      options.margin ||= {};
      options.margin[prop] = val;
    }
  }

  for (const prop of ["format", "width", "height"] as const) {
    const val = await page.evaluate(p => document.querySelector(`meta[name=wh-chromepdf-${p}]`)?.getAttribute("value"), prop) as string | null;
    if (val)
      options[prop] = val;
  }

  for (const prop of ["headertemplate", "footertemplate"] as const) {
    const val = await page.evaluate(p => document.querySelector(`template[name=wh-chromepdf-${p}]`)?.innerHTML, prop);
    if (val)
      options[prop] = val as string;
  }

  if (options?.withalpha) {
    //kill html/body backgrounds
    await page.evaluate(`{
      document.documentElement.style.cssText += "; background: transparent !important";
      document.body.style.cssText += "; background: transparent !important";
    }`);
  }

  const pdf = await page.pdf({
    format: options.format as Puppeteer.PaperFormat || "A4",
    printBackground: true,
    margin: {
      top: options.margin?.top || "0",
      left: options.margin?.left || "0",
      bottom: options.margin?.bottom || "0",
      right: options.margin?.right || "0"
    },
    displayHeaderFooter: Boolean(options.headertemplate || options.footertemplate),
    headerTemplate: options.headertemplate || "",
    footerTemplate: options.footertemplate || "",
  });

  await page.close();
  return Buffer.from(pdf).toString("base64");
}
