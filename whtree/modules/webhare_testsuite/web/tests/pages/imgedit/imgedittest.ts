import * as dompack from "@webhare/dompack";

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { ImageEditor } from "@mod-tollium/web/ui/components/imageeditor";
dompack.register("#imgedit", node => {
  new ImageEditor(node);
});
