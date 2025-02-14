import { ToolbarPanel, type ToolbarPanelOptions } from "@mod-tollium/web/ui/components/toolbar/toolbars";

export class ImageToolbarPanel extends ToolbarPanel {
  imageEditTool: string;

  constructor(tool: string, options?: ToolbarPanelOptions) {
    super(options);
    this.imageEditTool = tool;
  }
}
