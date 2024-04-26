import * as dompack from "@webhare/dompack";
import { ImageEditElement, type ImageEditMetadataEvent } from "@webhare/image-edit";
import { fetchAsFile } from "@webhare/test-frontend";

window.addEventListener("wh-image-edit-metadata", (event: ImageEditMetadataEvent) => {
  dompack.qR("#statusbar").textContent = JSON.stringify(event.detail);
});

customElements.define("wh-image-edit", ImageEditElement);

dompack.register("#loadlandscape", node => node.addEventListener("click", async () => {
  const img = await fetchAsFile('/tollium_todd.res/webhare_testsuite/tollium/landscape_4.jpg');
  dompack.qR<ImageEditElement>("#imgedit").loadImage(img);
}));

dompack.register("#save", node => node.addEventListener("click", async () => {
  const saved = await dompack.qR<ImageEditElement>("wh-image-edit").saveImage();
  dompack.qR("#savedimages").prepend(<div class="savedimage">
    <div>focalPoint: <span class="focalPoint">{JSON.stringify(saved.settings.focalPoint)}</span></div>
    <div><img class="image" src={URL.createObjectURL(saved.blob)} style="max-height:120px" /></div>
  </div>);
}));
