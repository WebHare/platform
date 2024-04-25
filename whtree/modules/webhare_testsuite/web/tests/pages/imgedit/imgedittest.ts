import * as dompack from "@webhare/dompack";
import { ImageEditElement } from "@webhare/image-edit";

dompack.register("#imgedit", node => {
});

customElements.define("wh-image-edit", ImageEditElement);
