export class SurfaceTool
{
  constructor(surface)
  {
    this.surface = surface;
  }

  refreshSurface()
  {
    this.surface.fireEvent("refresh");
  }
}
