// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/deps" {
}

////////////////////////////// esbuild //////////////////////////
// We need to expose some internal esbuild APIs for plugin builders
export type * as ESBuild from "esbuild";

////////////////////////////// Kysely //////////////////////////
// We need to expose Kysely to generated db/ files
export type * as Kysely from "kysely";

////////////////////////////// SHARP //////////////////////////
import type * as sharp from "sharp";
let sharppromise: Promise<typeof sharp> | undefined = undefined;

/** Load Sharp  */
export async function loadSharp(): Promise<typeof sharp> {
  if (!sharppromise)
    sharppromise = import("sharp");
  return await sharppromise;
}

/** Load an image (loading sharp as needed) */
export async function createSharpImage(...args: Parameters<typeof sharp.default>): Promise<Sharp> {
  const lib = await loadSharp();
  lib.default.cache(false); //disable sharp's cache
  lib.default.concurrency(1); //we manage workers
  return lib.default(...args);
}

export type Sharp = sharp.Sharp;
export type SharpColor = sharp.Color;
export type SharpRegion = sharp.Region;
export type SharpResizeOptions = sharp.ResizeOptions;
export type SharpExtendOptions = sharp.ExtendOptions;
export type SharpJpegOptions = sharp.JpegOptions;
export type SharpPngOptions = sharp.PngOptions;
export type SharpWebpOptions = sharp.WebpOptions;
export type SharpAvifOptions = sharp.AvifOptions;
export type SharpGifOptions = sharp.GifOptions;

////////////////////////////// Puppeteer //////////////////////////
import type * as Puppeteer from "puppeteer";
export type * as Puppeteer from "puppeteer"; //allows access to Puppeteer.Browser, Puppeteer.Page, ..

let puppeteerpromise: Promise<typeof Puppeteer> | undefined = undefined;

/** Load Puppeteer */
export async function launchPuppeteer(options?: Puppeteer.LaunchOptions): Promise<Puppeteer.Browser & AsyncDisposable> {
  if (!puppeteerpromise)
    puppeteerpromise = import("puppeteer");

  const puppeteer = await puppeteerpromise;
  process.env.CHROMIUM_PATH = puppeteer.executablePath();
  options = { executablePath: __dirname + "/../bin/start-chromium.sh", ...options };

  const puppet = await puppeteer.launch(options) as Puppeteer.Browser & AsyncDisposable;
  if (!puppet[Symbol.asyncDispose]) //it should be there, but just not exposed..
    throw new Error("Puppet unexpectedly lacks Symbol.asyncDispose");

  return puppet;
}

/** Connect Puppeteer to existing browser */
export async function connectPuppeteer(options: Puppeteer.ConnectOptions): Promise<Puppeteer.Browser & AsyncDisposable> {
  if (!puppeteerpromise)
    puppeteerpromise = import("puppeteer");

  const puppeteer = await puppeteerpromise;
  const puppet = await (puppeteer).connect(options) as Puppeteer.Browser & AsyncDisposable;
  if (!puppet[Symbol.asyncDispose]) //it should be there, but just not exposed..
    throw new Error("Puppet unexpectedly lacks Symbol.asyncDispose");

  return puppet;
}
