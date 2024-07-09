/* import GalleryControllerBase from '@mod-publisher/js/gallery/gallerycontroller'; */

import * as dompack from 'dompack';

//TODO can we split the fullscreen overlay rendering frmo

type GalleryControllerBaseOptions = {
  onclick?: (controller: GalleryControllerBase, idx: number) => void;
};

//The gallery controller launches fullscreen mode whenever an image is clicked and should offer nicer keyboard controllers
export default class GalleryControllerBase {
  _activecontroller: { close(): void } | null = null;
  node;
  options: GalleryControllerBaseOptions;

  constructor(node: HTMLElement, options?: GalleryControllerBaseOptions) {
    this.node = node;
    this.options = { ...options || {} };

    this.node.addEventListener("click", evt => this._onClick(evt));
  }

  _onClick(evt: Event) {
    dompack.stop(evt);

    if (this._activecontroller) {
      this._activecontroller.close();
      this._activecontroller = null;
    }

    if (!this.options.onclick)
      return;

    const selectedimage = (evt.target as HTMLElement | undefined)?.closest('figure');
    if (!selectedimage)
      return;
    const selectidx = this._getSlides().indexOf(selectedimage);
    if (selectidx < 0)
      return;

    this.options.onclick(this, selectidx);
  }

  _getSlides() {
    return dompack.qSA(this.node, '.wh-gallery__image');
  }

  getNumSlides() {
    return this._getSlides().length;
  }

  getSlide(idx: number) {
    const slides = this._getSlides();
    if (idx < 0 || idx >= slides.length)
      return null;

    const photo = slides[idx];
    const largeimage = photo.querySelector("a[href]")! as HTMLAnchorElement;
    const image = photo.querySelector("img")! as HTMLImageElement;
    const caption = photo.querySelector("figcaption");
    const width = parseInt(largeimage.dataset.imageWidth || "0");
    const height = parseInt(largeimage.dataset.imageHeight || "0");
    return {
      aspect: width / height,
      width,
      height,
      src: largeimage.href,
      dominantcolor: image.dataset.dominantcolor,
      title: image.alt,
      description: caption ? caption.textContent : ""
    };
  }
}
