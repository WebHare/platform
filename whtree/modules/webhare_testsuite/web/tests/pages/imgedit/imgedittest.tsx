import * as dompack from "@webhare/dompack";
import { ImgTransformElement, type ImgTransformMetadataEvent } from "@webhare/imgtransform";
import { fetchAsFile } from "@webhare/test-frontend";
import "./imgedittest.css";

function getActiveTab() {
  return dompack.qS(".tab:target") ?? dompack.qR(".tab:first-child");
}

window.addEventListener("wh-imgtransform:metadata", (event: ImgTransformMetadataEvent) => {
  const tab = (event.target as HTMLElement).closest(".tab")!;
  dompack.qR(tab, ".statusbar").textContent = JSON.stringify(event.detail);
});

customElements.define("wh-imgtransform", ImgTransformElement);

dompack.register("#loadlandscape", node => node.addEventListener("click", async () => {
  const imgedit = dompack.qR<ImgTransformElement>(getActiveTab(), "wh-imgtransform");
  const img = await fetchAsFile('/tollium_todd.res/webhare_testsuite/tollium/landscape_4.jpg');
  imgedit.loadImage(img);
}));

dompack.register("#loadportrait", node => node.addEventListener("click", async () => {
  const imgedit = dompack.qR<ImgTransformElement>(getActiveTab(), "wh-imgtransform");
  const img = await fetchAsFile('/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg');
  imgedit.loadImage(img);
}));

dompack.register("#save", node => node.addEventListener("click", async () => {
  const imgedit = dompack.qR<ImgTransformElement>(getActiveTab(), "wh-imgtransform");
  const saved = await imgedit.saveImage();
  dompack.qR("#savedimages").prepend(<div class="savedimage">
    <div>focalPoint: <span class="focalPoint">{JSON.stringify(saved.settings.focalPoint)}</span></div>
    <div><img class="image" src={URL.createObjectURL(saved.blob)} style="max-height:120px" /></div>
  </div>);
}));
