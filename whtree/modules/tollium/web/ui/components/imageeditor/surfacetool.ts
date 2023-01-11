/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

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
