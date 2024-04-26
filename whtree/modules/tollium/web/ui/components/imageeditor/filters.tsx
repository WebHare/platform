import * as dompack from "dompack";

import { debugFlags } from "@webhare/env";
import { getTid } from "@mod-tollium/js/gettid";
import * as toddImages from "@mod-tollium/js/icons";
import { Toolbar, ToolbarButton, ToolbarSeparator } from "@mod-tollium/web/ui/components/toolbar/toolbars";
import * as $todd from "@mod-tollium/web/ui/js/support";
import Frame from '@mod-tollium/webdesigns/webinterface/components/frame/frame';

import { CreateScreenCallback, ImageToolbarPanel, SetModalLayerOpacityCallback, SetProgressCallback, SetStatusCallback } from ".";
import { ImageSurface } from "./surface";
import { SurfaceTool } from "./surfacetool";

import "./imageeditor.lang.json";

/*ADDME: Uncomment these to activate face recognition filter
let CCV = require('./ccv.js');
let faceCascade = require('./face.js'); */

export type ImageFilter = "all" | "grayscale" | "invert" | "sharpen" | "blur" | "brightnesscontrast" | "autocontrast" | "coloradjust";

export type PhotoFiltersProps = {
  filterdata: Uint8ClampedArray;
};

type PhotoFiltersOptions = {
  resourceBase?: string;
  setProgress?: SetProgressCallback;
  setStatus?: SetStatusCallback;
  createScreen?: CreateScreenCallback;
  getAllowedFilters?: () => ImageFilter[];
  setModalLayerOpacity?: SetModalLayerOpacityCallback;
};

type FilterMessage = {
  type: "progress";
  progress: number;
  value?: number;
  max?: number;
} | {
  type: "result";
  result: ImageData;
} | {
  type: "debug";
  debug: string;
};

type FilterValues = Record<string, string>;

class PhotoFilters extends SurfaceTool {
  options: PhotoFiltersOptions;
  filterData: Uint8ClampedArray | null = null;
  filterTime = 0;
  previewData: ImageData | null = null;
  filterPanel: ImageToolbarPanel;
  grayscaleButton: ToolbarButton;
  invertButton: ToolbarButton;
  sharpenButton: ToolbarButton;
  blurButton: ToolbarButton;
  brightnessContrastButton: ToolbarButton;
  autoContrastButton: ToolbarButton;
  colorAdjustButton: ToolbarButton;
  worker: Worker | null = null;
  filterBox: HTMLDivElement | null = null;
  tmpCanvas: HTMLCanvasElement | null = null;
  progress: HTMLProgressElement | null = null;

  constructor(surface: ImageSurface, options?: PhotoFiltersOptions) {
    super(surface);

    this.options = {
      resourceBase: "",
      ...options
    };

    this.filterPanel = new ImageToolbarPanel("filters", {
      onClose: () => this.stop(),
      onApply: () => this.apply()
    });
    this.grayscaleButton = new ToolbarButton(this.filterPanel, {
      label: getTid("tollium:components.imgedit.editor.grayscale"),
      icon: toddImages.createImage("tollium:actions/grayscale", 24, 24, "b"),
      onExecute: () => this.grayscale()
    });
    this.filterPanel.addButton(this.grayscaleButton);
    this.invertButton = new ToolbarButton(this.filterPanel, {
      label: getTid("tollium:components.imgedit.editor.invert"),
      icon: toddImages.createImage("tollium:actions/invert", 24, 24, "b"),
      onExecute: () => this.invert()
    });
    this.filterPanel.addButton(this.invertButton);
    this.sharpenButton = new ToolbarButton(this.filterPanel, {
      label: getTid("tollium:components.imgedit.editor.sharpen"),
      icon: toddImages.createImage("tollium:actions/sharpen", 24, 24, "b"),
      onExecute: () => this.sharpen()
    });
    this.filterPanel.addButton(this.sharpenButton);
    this.blurButton = new ToolbarButton(this.filterPanel, {
      label: getTid("tollium:components.imgedit.editor.blur"),
      icon: toddImages.createImage("tollium:actions/blur", 24, 24, "b"),
      onExecute: () => this.blur()
    });
    this.filterPanel.addButton(this.blurButton);
    this.brightnessContrastButton = new ToolbarButton(this.filterPanel, {
      label: getTid("tollium:components.imgedit.editor.brightnesscontrast"),
      icon: toddImages.createImage("tollium:actions/brightnesscontrast", 24, 24, "b"),
      onExecute: () => this.brightnessContrast()
    });
    this.filterPanel.addButton(this.brightnessContrastButton);
    this.autoContrastButton = new ToolbarButton(this.filterPanel, {
      label: getTid("tollium:components.imgedit.editor.autocontrast"),
      icon: toddImages.createImage("tollium:actions/autocontrast", 24, 24, "b"),
      onExecute: () => this.autocontrast()
    });
    this.filterPanel.addButton(this.autoContrastButton);
    this.colorAdjustButton = new ToolbarButton(this.filterPanel, {
      label: getTid("tollium:components.imgedit.editor.coloradjust"),
      icon: toddImages.createImage("tollium:actions/colors", 24, 24, "b"),
      onExecute: () => this.colorAdjust()
    });
    this.filterPanel.addButton(this.colorAdjustButton);
    if (debugFlags.ixf) {
      this.filterPanel.addButton(new ToolbarSeparator(this.filterPanel));
      this.filterPanel.addButton(new ToolbarButton(this.filterPanel, {
        label: getTid("tollium:components.imgedit.editor.sepia"),
        icon: toddImages.createImage("tollium:actions/sepia", 24, 24, "b"),
        onExecute: () => this.sepia()
      }));
      this.filterPanel.addButton(new ToolbarButton(this.filterPanel, {
        label: getTid("tollium:components.imgedit.editor.posterize"),
        icon: toddImages.createImage("tollium:actions/posterize", 24, 24, "b"),
        onExecute: () => this.posterize()
      }));
      /*ADDME: Uncomment these to activate face recognition filter
      if (typeof CCV === "object") {
        this.filterpanel.addButton(new ToolbarButton(this.filterpanel, {
          label: getTid("tollium:components.imgedit.editor.findfaces"),
          icon: toddImages.createImage("tollium:actions/findfaces", 24, 24, "b"),
          onExecute: () => this.findFaces()
        }));
      } */
    }
  }

  updateFilterButtons() {
    const allowedFilters = this.options.getAllowedFilters ? this.options.getAllowedFilters() : [];
    const allAllowed = allowedFilters.indexOf("all") >= 0;
    this.grayscaleButton.node.style.display = allAllowed || allowedFilters.indexOf("grayscale") >= 0 ? "" : "none";
    this.invertButton.node.style.display = allAllowed || allowedFilters.indexOf("invert") >= 0 ? "" : "none";
    this.sharpenButton.node.style.display = allAllowed || allowedFilters.indexOf("sharpen") >= 0 ? "" : "none";
    this.blurButton.node.style.display = allAllowed || allowedFilters.indexOf("blur") >= 0 ? "" : "none";
    this.brightnessContrastButton.node.style.display = allAllowed || allowedFilters.indexOf("brightnesscontrast") >= 0 ? "" : "none";
    this.autoContrastButton.node.style.display = allAllowed || allowedFilters.indexOf("autocontrast") >= 0 ? "" : "none";
    this.colorAdjustButton.node.style.display = allAllowed || allowedFilters.indexOf("coloradjust") >= 0 ? "" : "none";
  }

  startFiltering(toolbar: Toolbar) {
    this.updateFilterButtons();
    toolbar.activateModalPanel(this.filterPanel);
    this.surface.hidePreviewCanvas();

    this.worker = new Worker(this.options.resourceBase + "components/imageeditor/filters-worker.js");
    this.worker.addEventListener("message", evt => this.onFilterResult(evt.data as FilterMessage));

    this.start();
  }

  start() {
    this.filterBox = <div class="wh-filterbox" style={this.surface.canvas.style.cssText} />;
    this.surface.node.append(this.filterBox!);

    this.tmpCanvas = <canvas class="wh-filterbox-img" width={this.surface.canvas.width} height={this.surface.canvas.height} />;
    this.filterBox!.append(this.tmpCanvas!);
    const tmpCtx = this.tmpCanvas!.getContext('2d')!;
    tmpCtx.drawImage(this.surface.canvas, 0, 0, this.surface.canvas.width, this.surface.canvas.height);

    if (this.options.setStatus)
      this.options.setStatus(this.surface.canvas.width, this.surface.canvas.height);

    this.filterData = null;
  }

  stop() {
    if (this.worker)
      this.worker.terminate();
    this.worker = null;

    this.surface.showPreviewCanvas();
    this.filterBox!.remove();
    this.refreshSurface();
  }

  apply() {
    this.surface.showPreviewCanvas();
    if (!this.filterData)
      return; //no changes

    this.applyCanvas({ filterdata: this.filterData });
    this.surface.pushUndo({ action: "filters", comp: this, props: { filterdata: this.filterData }, meta: false });
    this.refreshSurface();
  }

  applyCanvas(props: PhotoFiltersProps) {
    const pixels = this.getPixels(this.surface.canvas);
    for (let i = 0; i < props.filterdata.length; ++i)
      pixels.data[i] = props.filterdata[i];
    this.setPixels(this.surface.canvas, pixels);
  }

  grayscale() {
    this.runFilter("grayscale");
  }

  sepia() {
    this.runFilter("sepiaTone");
  }

  posterize() {
    const components = {
      level: {
        type: "slider", title: getTid("tollium:components.imgedit.filters.level"),
        min: 2, max: 256, step: 1, value: 4,
        width: "1pr"
      }
    };
    this.runFilterDialog(getTid("tollium:components.imgedit.filters.posterize"), components, values => {
      const level = parseInt(values.level);
      this.runFilter("posterize", level);
    });
  }

  invert() {
    this.runFilter("invert");
  }

  colorAdjust() {
    const components = {
      /*advanced: { type: "checkbox", title: "", label: "advanced" }, */
      red: {
        type: "slider", title: getTid("tollium:components.imgedit.filters.red"),
        min: 0, max: 100, step: 1, value: 100,
        width: "1pr"
      },
      green: {
        type: "slider", title: getTid("tollium:components.imgedit.filters.green"),
        min: 0, max: 100, step: 1, value: 100,
        width: "1pr"
      },
      blue: {
        type: "slider", title: getTid("tollium:components.imgedit.filters.blue"),
        min: 0, max: 100, step: 1, value: 100,
        width: "1pr"
      }
    };
    this.runFilterDialog(getTid("tollium:components.imgedit.filters.coloradjust"), components, values => {
      const redfraction = parseInt(values.red) / 100,
        greenfraction = parseInt(values.green) / 100,
        bluefraction = parseInt(values.blue) / 100;

      // Run the filter
      this.runFilter("adjustColors", redfraction, greenfraction, bluefraction);
    });
  }

  brightnessContrast() {
    //ADDME: Currently using linear brightness/contrast adjustment (which Photoshop calls 'legacy'), maybe switch to
    //       non-linear adjustment using histogram curves?
    const components = {
      brightness: {
        type: "slider", title: getTid("tollium:components.imgedit.filters.brightness"),
        min: -100, max: 100, step: 1, value: 0,
        width: "1pr"
      },
      contrast: {
        type: "slider", title: getTid("tollium:components.imgedit.filters.contrast"),
        min: -50, max: 100, step: 1, value: 0,
        width: "1pr"
      }
    };
    this.runFilterDialog(getTid("tollium:components.imgedit.filters.brightnesscontrast"), components, values => {
      // Brightness has range -1..0..1, with -1 resulting in black and 1 resulting in white
      // We'll map the -100..0..100 input range to -0.5..0..0.5
      const brightness = parseInt(values.brightness) / 200;
      // Contrast has range 0..1..127, with 0 resulting in gray
      // We'll map the -50..0..100 input range to about ~0.05..1..~21 using ((x/100)+1)^4.4 (which maps -100 to 0, 0 to 1
      // and 200 to ~126).
      const contrast = Math.pow(((parseInt(values.contrast) / 100) + 1), 4.4);

      // Run the filter
      this.runFilter("brightnessContrast", brightness, contrast);
    });
  }

  autocontrast() {
    //this.runFilter("equalizeHistogram");
    const components = {
      level: {
        type: "slider", title: getTid("tollium:components.imgedit.filters.level"),
        min: 1, max: 50, step: 1, value: 5,
        width: "1pr"
      }
    };
    this.runFilterDialog(getTid("tollium:components.imgedit.filters.autocontrast"), components, values => {
      const level = parseInt(values.level);
      this.runFilter("autoContrast", level);
    });
  }

  sharpen() {
    this.runFilter("convolve", [
      0, -1, 0,
      -1, 5, -1,
      0, -1, 0
    ]);
  }

  blur() {
    const components = {
      radius: {
        type: "slider", title: getTid("tollium:components.imgedit.filters.radius"),
        min: 1, max: 100, step: 1, value: 1,
        width: "1pr"
      }
    };
    this.runFilterDialog(getTid("tollium:components.imgedit.filters.blur"), components, values => {
      const radius = parseInt(values.radius);
      this.runFilter("gaussianBlur", radius);
    });
  }

  /*ADDME: Uncomment these to activate face recognition filter
  findFaces() {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = this.surface.canvas.width;
    canvas.height = this.surface.canvas.height;
    context.drawImage(this.surface.canvas, 0, 0);

    const starttime = Date.now();
    const options = {
      "canvas": CCV.grayscale(canvas),
      "cascade": faceCascade,
      "interval": 5,
      "min_neighbors": 1
      //, "async": true
      //, "worker": 1
    };
    const result = CCV.detect_objects(options);
    console.info("detection-time", Math.round(Date.now() - starttime));
    console.info("num-faces", result.length.toString());
    for (let i = 0; i < result.length; i++)
      console.info("face #" + i + ": " + result[i].width + "x" + result[i].height + " @" + result[i].x + "." + result[i].y);
    / *
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(230,87,0,0.8)';
    // Draw detected area
    for (var i = 0; i < result.length; i++) {
      ctx.beginPath();
      ctx.arc((result[i].x + result[i].width * 0.5) * scale, (result[i].y + result[i].height * 0.5) * scale,
          (result[i].width + result[i].height) * 0.25 * scale * 1.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    * /
  } */

  getPixels(canvas: HTMLCanvasElement) {
    return canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
  }

  setPixels(canvas: HTMLCanvasElement, pixels: ImageData) {
    canvas.getContext("2d")!.putImageData(pixels, 0, 0);
  }

  runFilter(filter: string, ...args: unknown[]) {
    if (!this.surface.setBusy(true))
      return; // Already busy

    this.filterTime = Date.now();

    // When previewing, the previewdata property will contain the unfiltered data
    args.unshift(this.previewData || this.getPixels(this.tmpCanvas!));
    const output = this.tmpCanvas!.getContext("2d")!.createImageData(this.tmpCanvas!.width, this.tmpCanvas!.height);

    console.log("Starting filter", filter, "with arguments", args, "and output", output);
    this.worker!.postMessage({ name: filter, args: args, output: output });
  }

  onFilterResult(data: FilterMessage) {
    if (data) {
      switch (data.type) {
        case "result":
          if (this.options.setProgress) {
            this.options.setProgress(0, 0);
          } else if (this.progress) {
            this.progress.remove();
            this.progress = null;
          }

          requestAnimationFrame(() => {
            this.filterData = data.result.data;
            this.setPixels(this.tmpCanvas!, data.result);

            console.log("Got filter result in " + (Date.now() - this.filterTime) + "ms");
            this.surface.setBusy(false);
          });

          break;
        case "progress":
          if (this.options.setProgress) {
            this.options.setProgress(data.progress, 100);
          } else {
            if (!this.progress) {
              this.progress = <progress style={{ width: "50%", height: "20px", position: "absolute", top: "50%", left: "25%", marginTop: "-10px", zIndex: 1 }} max="100" value="0" />;
              this.filterBox!.append(this.progress!);
            }
            this.progress!.value = data.progress;
          }
          break;
        case "debug":
          console.info(data.debug);
          break;
      }
    }
  }

  // @param title Dialog title
  // @param components Filter-specific components, { name: spec, name: spec } object (each object is rendered on its own line
  //                   within the dialog body, 'spec' is a createScreen-compatible component description)
  // @param runfilter The function that actually runs the filter, which is supplied a { name: value, name: value } object
  //                  with the getValue() value for each component from components
  runFilterDialog(title: string, components: $todd.ComponentsForMessages, runfilter: (values: FilterValues) => void) {
    if (!this.options.createScreen)
      return;

    const curData = this.filterData;
    const curPixels = this.getPixels(this.tmpCanvas!);
    let previewed = false;

    // This will automatically run the dialog
    new FilterDialogController({
      title,
      components,
      createScreen: this.options.createScreen,
      onButton: result => {
        // Apply the filter if previewing, or if the 'ok' button is pressed and the filter is not yet previewed
        if (result.button === "preview" || (result.button === "ok" && !previewed)) {
          previewed = result.button === "preview";

          // Use the initial canvas for running the filter (prevent re-applying the filter on multiple previews)
          this.previewData = curPixels;

          // Run the filter
          runfilter(result.values);
          // Reset the filterdata and canvas if the 'cancel' button is pressed and the filter has been previewed
        } else if (result.button === "cancel" && previewed) {
          this.filterData = curData;
          this.setPixels(this.tmpCanvas!, curPixels);
        }
        // Clear the preview initial canvas
        if (result.button !== "preview") {
          this.previewData = null;
        }
      }
    });
    // Make modal layer fully transparent, so the actual image is visible
    if (this.options.setModalLayerOpacity)
      this.options.setModalLayerOpacity(0);
  }
}

export type { PhotoFilters };

type FilterDialogControllerOptions = {
  title: string;
  components: $todd.ComponentsForMessages;
  createScreen: CreateScreenCallback;
  onButton: (result: { button: "preview" | "ok"; values: FilterValues } | { button: "cancel" }) => void;
};

class FilterDialogController {
  options: FilterDialogControllerOptions;
  dialog: Frame | null = null;

  constructor(options: FilterDialogControllerOptions) {
    this.options = options;
    this.options.components = { ...this.options.components };
    this._createDialog();
  }

  private _createDialog() {
    const dialog = {
      frame: {
        bodynode: 'root',
        specials: ['previewaction', 'okaction', 'cancelaction'],
        title: this.options.title,
        defaultbutton: "okbutton",
        allowclose: true
      },
      root: {
        type: 'panel', lines: [
          { layout: "block", items: [{ item: "body" }], width: "1pr", height: "1pr" },
          { layout: "block", items: [{ item: "footer" }] }
        ]
      },
      body: {
        type: 'panel',
        lines: [] as Array<{ title: string; items: Array<{ item: string }> }>,
        spacers: { top: true, bottom: true, left: true, right: true },
        width: "1pr", height: "1pr"
      },
      footer: {
        type: 'panel',
        lines: [
          {
            items: [
              { item: "previewbutton" },
              { item: "spacer" },
              { item: "okbutton" },
              { item: "cancelbutton" }
            ]
          }
        ],
        spacers: { top: true, bottom: true, left: true, right: true },
        isfooter: true,
        width: '1pr'
      },
      previewaction: { type: 'action', hashandler: true, unmasked_events: ['execute'] }, //ADDME can we lose the hashandler requirement? perhaps even unmasked_events ?
      previewbutton: { type: 'button', title: getTid("tollium:components.imgedit.filters.preview"), action: 'previewaction' },
      spacer: { type: 'text', width: "1pr", value: "" },
      okaction: { type: 'action', hashandler: true, unmasked_events: ['execute'] }, //ADDME can we lose the hashandler requirement? perhaps even unmasked_events ?
      okbutton: { type: 'button', title: getTid("~ok"), action: 'okaction' },
      cancelaction: { type: 'action', hashandler: true, unmasked_events: ['execute'] }, //ADDME can we lose the hashandler requirement? perhaps even unmasked_events ?
      cancelbutton: { type: 'button', title: getTid("~cancel"), action: 'cancelaction' },
      ...this.options.components
    };

    if (this.options.components)
      Object.keys(this.options.components).forEach(key => {
        dialog.body.lines.push({ title: this.options.components![key].title, items: [{ item: key }] });
      });

    this.dialog = this.options.createScreen(dialog);

    this.dialog.setMessageHandler("previewaction", "execute", (_data: unknown, callback: () => void) => this._onFilterPreviewButton(callback));
    this.dialog.setMessageHandler("okaction", "execute", (_data: unknown, callback: () => void) => this._onFilterOkButton(callback));
    this.dialog.setMessageHandler("cancelaction", "execute", (_data: unknown, callback: () => void) => this._onFilterCancelButton(callback));
    this.dialog.setMessageHandler("frame", "close", (_data: unknown, callback: () => void) => this._onFilterCancelButton(callback));
  }

  _closeDialog() {
    // Close editor dialog if still present
    if (this.dialog)
      this.dialog.terminateScreen();
    this.dialog = null;
  }

  _getComponentValues() {
    const values: FilterValues = {};

    if (!this.dialog)
      return values;

    Object.keys(this.options.components).forEach(key => {
      values[key] = this.dialog!.getComponent(key).getValue() as string;
    });
    return values;
  }

  _onFilterPreviewButton(callback: () => void) {
    callback();
    this.options.onButton({ button: "preview", values: this._getComponentValues() });
  }

  _onFilterOkButton(callback: () => void) {
    callback();
    this.options.onButton({ button: "ok", values: this._getComponentValues() });
    this._closeDialog();
  }

  _onFilterCancelButton(callback: () => void) {
    callback();
    this.options.onButton({ button: "cancel" });
    this._closeDialog();
  }
}

export function addFiltersButton(toolbar: Toolbar, surface: ImageSurface, options?: PhotoFiltersOptions) {
  const filters = new PhotoFilters(surface, options);

  const button = new ToolbarButton(toolbar, {
    label: getTid("tollium:components.imgedit.editor.filters"),
    icon: toddImages.createImage("tollium:misc/levers", 24, 24, "b"),
    onExecute: () => filters.startFiltering(toolbar)
  });
  toolbar.addButton(button);

  return { button: button, comp: filters };
}
