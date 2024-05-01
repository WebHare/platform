import type * as sharp from "sharp";
import type * as Puppeteer from "puppeteer";
export type * as Puppeteer from "puppeteer"; //allows access to Puppeteer.Browser, Puppeteer.Page, ..

////////////////////////////// SHARP //////////////////////////
let sharppromise: Promise<typeof sharp> | undefined = undefined;

/** Load Sharp  */
export async function loadSharp(): Promise<typeof sharp> {
  if (!sharppromise)
    sharppromise = import("sharp");
  return await sharppromise;
}

/** Load an image (loading sharp as needed) */
export async function createSharpImage(...args: Parameters<typeof sharp.default>): Promise<ReturnType<typeof sharp.default>> {
  const lib = await loadSharp();
  return lib.default(...args);
}

////////////////////////////// Puppeteer //////////////////////////
let puppeteerpromise: Promise<typeof Puppeteer> | undefined = undefined;


/** Load Puppeteer */
export async function launchPuppeteer(options?: Puppeteer.PuppeteerLaunchOptions): Promise<Puppeteer.Browser> {
  if (!puppeteerpromise)
    puppeteerpromise = import("puppeteer");

  const puppeteer = await puppeteerpromise;
  process.env.CHROMIUM_PATH = puppeteer.executablePath();
  options = { executablePath: __dirname + "/../bin/start-chromium.sh", ...options };
  return await (await puppeteerpromise).launch(options);
}
