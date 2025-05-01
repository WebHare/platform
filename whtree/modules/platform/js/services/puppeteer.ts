import { connectSharedPuppeteer } from "@webhare/deps";

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
