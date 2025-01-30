import type { ImageSurface } from "./surface";

export class SurfaceTool {
  surface: ImageSurface;

  constructor(surface: ImageSurface) {
    this.surface = surface;
  }

  refreshSurface() {
    this.surface.fireEvent("refresh");
  }
}
