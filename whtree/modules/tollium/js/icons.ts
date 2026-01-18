import type { RetrievedImagePart, TolliumToddService } from "@mod-tollium/web/ui/js/types";
import type { UIBusyLock } from "@webhare/dompack";
import { debugFlags } from "@webhare/env";
import { createClient } from "@webhare/jsonrpc-client";
import { throwError } from "@webhare/std";
import * as dompack from "dompack";

declare global {
  interface HTMLImageElement { //FIXME clean up, don't extend global interfaces as it'll leak through everywhere
    knockout: boolean;
    translatex: number;
    translatey: number;
  }
}

type ImageOptions = {
  className?: string;
  title?: string;
};

type ImageCacheData = {
  width: number;
  height: number;
  color: string;
};

type ImageCacheEntry = {
  key: string;
  data: ImageCacheData;
  imgs: HTMLImageElement[];
  /** (Data?) URL for the image */
  result?: string;
};

const toddrpc = createClient<TolliumToddService>("tollium:todd");

// The images to load
const imagequeue = new Map();

// The images that are already loaded
const imagecache = new Map<string, ImageCacheEntry>();

// Used to coalesce image loading
let loadimgtimeout: number | null = null, loadimglock: UIBusyLock | null = null;

// Load the image(s) and apply to an <img> node src
function updateCompositeImage(imgnode: HTMLImageElement, imgnames: string[], width: number, height: number, color: string) {
  // If a white image is requested, fallback to (inverted) black if white not directly available
  if (color === "w")
    color = "w,b";
  // If a color image is requested, fallback to black if color not directly available
  else if (color === "c")
    color = "c,b";

  const data = { imgnames, width, height, color: color || "" };
  const key = `${imgnames.join("+")}|${data.width}|${data.height}|${data.color}`;
  const cached = imagecache.get(key);

  // The data-toddimg attribute is used to reload the image after the cache is cleared
  if (imgnode.dataset.toddimg === key)
    return; //already set or being loaded

  // Update the node to explain which image is coming on. Tests that just want to check this name shouldn't need to wait for the image load itself
  imgnode.dataset.toddimg = key;

  // Check if the image isn't already on the queue
  for (const [, value] of imagecache) {
    if (value.imgs.includes(imgnode)) {
      value.imgs.splice(value.imgs.indexOf(imgnode), 1);
      break;
    }
  }

  // Check if this image src is already loaded
  if (cached && cached.result) {
    if (debugFlags.ild)
      console.log("Applying cached " + key);
    applyLoadedResultToImage(cached, imgnode);
    return imgnode;
  }

  // Add the image to the list of images to load
  if (!cached)
    imagecache.set(key, { key, data, imgs: [] });
  if (imgnode)
    imagecache.get(key)!.imgs.push(imgnode);

  if (!imagequeue.has(key)) {
    imagequeue.set(key, data);
    if (debugFlags.ild)
      console.log("Loading image " + key + ", image queue size: " + imagequeue.size);
  }

  // Try to coalesce multiple loadImages calls into one
  if (!loadimgtimeout) {
    if (debugFlags.ild)
      console.log("Setting image loading timeout");
    loadimglock = dompack.flagUIBusy();
    loadimgtimeout = window.setTimeout(() => void loadImages(), 1);
  }
}

async function loadImages() {
  loadimgtimeout = null;
  loadimglock?.release();
  loadimglock = null;

  const lock = dompack.flagUIBusy();

  // Make a list of images to load
  const toload = [];
  if (debugFlags.ild)
    console.warn("Image queue size: " + imagequeue.size);
  for (const [key, data] of imagequeue) {
    const cached = imagecache.get(key) ?? throwError(`Image ${key} missing in cache`);
    if (debugFlags.ild)
      console.log(key, cached);
    // If nobody is waiting for this image, or if it's already loaded, skip it
    if (!cached.imgs.length || cached.result) {
      applyLoadedResult(cached);
      continue;
    }
    toload.push({ key, data });
  }
  imagequeue.clear();

  // Load the images
  if (debugFlags.ild)
    console.info("Loading " + toload.length + " images");

  try {
    const result = await toddrpc.retrieveImages(toload, Boolean(debugFlags.ild));

    if (debugFlags.ild)
      console.info("Received " + result.images.length + " images", result);

    // Store the loaded images
    const loaded = await Promise.all(result.images.map(res => {
      // Get the cache entry
      const cached = imagecache.get(res.key) ?? throwError(`Image ${res.key} missing in cache`);

      // Process the image (invert, apply overlays)
      return processImage(res.key, res.images, cached.data);
    }));

    // loaded holds all resolved promise results
    if (debugFlags.ild)
      console.info("Applying images");

    loaded.forEach((loadedimg) => {
      if (!loadedimg)
        return;
      // Get the cache entry
      const cached = imagecache.get(loadedimg.key) ?? throwError(`Image ${loadedimg.key} missing in cache`);

      if (!cached.imgs.length)
        return;

      cached.result = loadedimg.result;

      // If no src was returned, the image is broken
      if (!cached.result)
        cached.result = "/.tollium/ui/img/broken.svg";

      // Store the loaded image
      applyLoadedResult(cached);
    });
  } catch (e) {
    console.error(e);
  } finally {
    lock.release();
  }
}

function applyLoadedResult(cached: ImageCacheEntry) {
  if (cached.imgs.length && debugFlags.ild)
    console.log("Applying " + cached.key + " to " + cached.imgs.length + " images");

  // Set the src attribute of the img nodes waiting for this image and clear the list
  cached.imgs.forEach(img => applyLoadedResultToImage(cached, img));
  cached.imgs = [];
}

function applyLoadedResultToImage(cached: ImageCacheEntry, img: HTMLImageElement) {
  img.width = cached.data.width;
  img.height = cached.data.height;
  img.src = cached.result ?? throwError(`Image ${cached.key} has no result`);
}

async function processImage(key: string, images: Array<RetrievedImagePart>, data: ImageCacheData) {
  // Check if the base image was found (a default record is returned for broken images)
  if (!images.length || !images[0]) {
    console.error("Broken " + (images.length > 1 ? "base " : "") + "image " + key);
    // Return an empty src, so the 'broken' image is shown
    return { key };
  }
  const baseimg = images[0];
  const basetype = baseimg.type;
  if (debugFlags.ild)
    console.log("Received image " + key + " of type " + basetype);


  // basedata is the base64-encoded base image data
  let basedata = baseimg.data;

  // If the image is black and a white image is wanted, invert the image
  if (baseimg.invertable && basetype === "image/svg+xml" && baseimg.color === "b" && data.color === "w,b") {
    if (debugFlags.ild)
      console.log("Inverting image");
    basedata = invertImage(basedata);
  }

  // Apply overlays, if any
  if (images.length === 1) {
    // No extra processing has to be done; return the current image data as data URI
    return { key, result: "data:" + basetype + ";base64," + basedata };
  }

  // Base image and overlays are drawn on a canvas, taking pixel ratio into account
  const canvaswidth = data.width * window.devicePixelRatio, canvasheight = data.height * window.devicePixelRatio;

  // imgnodes is the list of img nodes that are drawn on the composite canvas
  // imgloads is the list of promises that resolve for each loaded img node (or rejected for broken overlays)
  const imgnodes: HTMLImageElement[] = [], imgloads: Array<Promise<number>> = [];
  images.forEach((overlayimg, idx) => {
    // Check if the overlay image (idx > 0) was found (a default record is returned for broken imagesw)
    if (idx && !overlayimg) {
      // Add a rejected promise
      imgloads.push(Promise.reject(new Error("Broken overlay " + idx + " for " + key)));
      return;
    }
    // The image data is either the base image data or the overlay image data
    let imgdata = idx ? overlayimg.data : basedata;
    // If this is a black overlay and a white image is wanted, invert the overlay
    if (idx && overlayimg.invertable && overlayimg.type === "image/svg+xml" && overlayimg.color === "b" && data.color === "w,b") {
      if (debugFlags.ild)
        console.log("Inverting overlay " + idx);
      imgdata = invertImage(imgdata);
    }

    const imgsrc = "data:" + overlayimg.type + ";base64," + imgdata;
    const imgnode = new Image(canvaswidth, canvasheight);
    imgnode.knockout = overlayimg.knockout;
    imgnode.translatex = overlayimg.translatex;
    imgnode.translatey = overlayimg.translatey;

    //ADDME: In Safari, icons are sometimes rendered smaller than they actually are, don't know what causes this...

    // Load the images into drawable img nodes
    imgloads.push(new Promise((resolve, reject) => {
      if (debugFlags.ild)
        console.log("Reading image " + idx);
      imgnode.onload = function () {
        if (debugFlags.ild)
          console.log("Read image " + idx);
        resolve(idx);
      };
      imgnode.onerror = function (e) {
        reject(new Error("Error reading image " + idx + " for " + key + " (" + imgsrc + ")"));
      };
      imgnode.src = imgsrc;
    }));
    imgnodes.push(imgnode);
  });

  try {
    // Wait for all images to be loaded
    await Promise.all(imgloads);

    if (debugFlags.ild)
      console.info("Combining layers");

    let canvas = document.createElement("canvas");
    canvas.width = canvaswidth;
    canvas.height = canvasheight;
    let ctx = canvas.getContext("2d") ?? throwError("Could not get canvas 2D context");
    let layercanvas, layerctx;
    const canvasstack = [canvas];

    // Draw the layers
    let idx = 0;
    for (const imgnode of imgnodes) {
      // If the layercanvas exists, it is the current backgrondlayer, don't knockout this layer
      const knockout = !layercanvas;
      if (knockout) {
        layercanvas = document.createElement("canvas");
        layercanvas.width = canvaswidth;
        layercanvas.height = canvasheight;
        layerctx = layercanvas.getContext("2d");
      }

      layerctx!.drawImage(imgnode, imgnode.translatex, imgnode.translatey, canvaswidth, canvasheight);

      if (idx && knockout) { // Knockout overlay
        if (debugFlags.ild)
          console.info("Knockout overlay " + idx);

        // Draw a knockout shape by drawing the overlay with a "destination-out" composite operation at positions 1
        // logical pixel to the top, left, right and bottom
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.imageSmoothingEnabled = false;

        // For very large images (> 192 pixels), widen the knockout outline
        const range = Math.max(Math.round(canvaswidth / window.devicePixelRatio) / 128, Number(window.devicePixelRatio));
        for (let x = -range; x <= range; ++x)
          for (let y = -range; y <= range; ++y)
            ctx.drawImage(layercanvas!, x, y);

        ctx.restore();
      }

      // Draw the image
      ctx.drawImage(layercanvas!, 0, 0);

      if (imgnode.knockout) {
        // Next layer can knockout this layer
        layercanvas = null;
        layerctx = null;
      } else {
        if (debugFlags.ild)
          console.info("Adding stack layer for non-knockout layer " + idx);

        // Create a new canvas
        canvas = document.createElement("canvas");
        canvas.width = canvaswidth;
        canvas.height = canvasheight;
        ctx = canvas.getContext("2d") ?? throwError("Could not get canvas 2D context");
        canvasstack.push(canvas);
      }

      ++idx;
    }

    // Get and return the image data url
    if (debugFlags.ild)
      console.log("Setting cached src " + key);

    // Combine the layers into a single image
    canvas = document.createElement("canvas");
    canvas.width = canvaswidth;
    canvas.height = canvasheight;
    ctx = canvas.getContext("2d") ?? throwError("Could not get canvas 2D context");
    for (layercanvas of canvasstack)
      ctx.drawImage(layercanvas, 0, 0);

    return { key, result: canvas.toDataURL() };
  } catch (e) {
    // An overlay could not be loaded, return an empty src, so the 'broken' image is shown
    console.error(e);
    return { key };
  }
}

function invertImage(svgdata: string) {
  svgdata = window.atob(svgdata);
  //console.log(svgdata);
  // Switch '#4a4a4a' and '#f3f3f3', adding a space to prevent double substitution
  // And using doublespaces now, as the CSS rewriter for IE (RewriteImgStyles) will already add the first space
  svgdata = svgdata.replace(/(stroke|fill): ?#4a4a4a;/gi, "$1:  #f3f3f3;");
  svgdata = svgdata.replace(/(stroke|fill): ?#f3f3f3;/gi, "$1:  #4a4a4a;");
  svgdata = svgdata.replace(/(stroke|fill): ?rgb\(74,74,74\);/gi, "$1:  #f3f3f3;");
  svgdata = svgdata.replace(/(stroke|fill): ?rgb\(243,243,243\);/gi, "$1:  #4a4a4a;");
  svgdata = svgdata.replace(/(stroke|fill)="#4a4a4a/gi, "$1=\" #f3f3f3");
  svgdata = svgdata.replace(/(stroke|fill)="#f3f3f3/gi, "$1=\" #4a4a4a");
  svgdata = svgdata.replace(/(stroke|fill)="rgb\(74,74,74\)/gi, "$1=\" #f3f3f3");
  svgdata = svgdata.replace(/(stroke|fill)="rgb\(243,243,243\)/gi, "$1=\" #4a4a4a");
  //console.log(svgdata);
  return window.btoa(svgdata);
}

export function resetImageCache() {
  if (debugFlags.ild)
    console.warn("Clearing image cache");

  imagequeue.clear();
  imagecache.clear();
  if (loadimgtimeout) {
    window.clearTimeout(loadimgtimeout);
    loadimgtimeout = null;
  }
  if (loadimglock) {
    loadimglock.release();
    loadimglock = null;
  }

  loadMissingImages({ force: true });
}

export function loadMissingImages({ force, node }: { force?: boolean; node?: HTMLElement } = {}) {
  for (const img of (node || document).querySelectorAll<HTMLImageElement>("img[data-toddimg]")) {
    if ((!img.src || force) && img.dataset.toddimg) {
      const data = img.dataset.toddimg.split("|");
      img.dataset.toddimg = data.slice(0, 4).join("|") + "|reloading";
      updateCompositeImage(img, data[0].split("+"), parseInt(data[1]), parseInt(data[2]), data[3]);
    }
  }
}

export function createImage(imgname: string, width: number, height: number, color: "b" | "c" | "w", eloptions?: ImageOptions) {
  return createCompositeImage(imgname.split("+"), width, height, color, eloptions);
}

function createCompositeImage(imgnames: string[], width: number, height: number, color: "b" | "c" | "w", eloptions?: ImageOptions) {
  const imgnode = dompack.create('img', { width, height, ...eloptions });
  updateCompositeImage(imgnode, imgnames, width, height, color);
  return imgnode;
}

export function updateImage(imgnode: HTMLImageElement, imgname: string, width: number, height: number, color: "b" | "c" | "w") {
  return updateCompositeImage(imgnode, imgname.split("+"), width, height, color);
}
