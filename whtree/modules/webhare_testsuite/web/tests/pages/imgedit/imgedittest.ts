import * as dompack from "@webhare/dompack";
import { ImageEditElement, type ImageEditMetadataEvent } from "@webhare/image-edit";

window.addEventListener("wh-image-edit-metadata", (event: ImageEditMetadataEvent) => {
  dompack.qR("#statusbar").textContent = JSON.stringify(event.detail);
});

customElements.define("wh-image-edit", ImageEditElement);
