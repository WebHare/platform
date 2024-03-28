import * as dompack from "@webhare/dompack";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ImageEditor = require("@mod-tollium/web/ui/components/imageeditor/index.tsx");
dompack.register("#imgedit", node => {
  new ImageEditor(node);
});
