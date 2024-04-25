import * as dompack from "@webhare/dompack";

import { ImageEditor } from "@mod-tollium/web/ui/components/imageeditor";

dompack.register("#imgedit", node => {
  new ImageEditor(node);
});
