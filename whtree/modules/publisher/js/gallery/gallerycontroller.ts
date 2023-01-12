/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

/* import GalleryControllerBase from '@mod-publisher/js/gallery/gallerycontroller'; */

import * as dompack from 'dompack';

//TODO can we split the fullscreen overlay rendering frmo

//The gallery controller launches fullscreen mode whenever an image is clicked and should offer nicer keyboard controllers
export default class GalleryControllerBase {
  constructor(node, options) {
    this.node = node;
    this.options = { ...options };

    this.node.addEventListener("click", evt => this._onClick(evt));
  }

  _onClick(evt) {
    dompack.stop(evt);

    if (this._activecontroller) {
      this._activecontroller.close();
      this._activecontroller = null;
    }

    if (!this.options.onclick)
      return;

    let selectedimage = evt.target.closest('figure');
    let selectidx = this._getSlides().indexOf(selectedimage);
    if (!selectedimage || selectidx < 0)
      return;

    this.options.onclick(this, selectidx);
  }

  _getSlides() {
    return dompack.qSA(this.node, '.wh-gallery__image');
  }

  getNumSlides() {
    return this._getSlides().length;
  }

  getSlide(idx) {
    let slides = this._getSlides();
    if (idx < 0 || idx >= slides.length)
      return null;

    let photo = slides[idx];
    let largeimage = photo.querySelector("a[href]");
    let image = photo.querySelector("img");
    let caption = photo.querySelector("figcaption");
    let width = parseInt(largeimage.dataset.imageWidth);
    let height = parseInt(largeimage.dataset.imageHeight);
    return {
      aspect: width / height
      , width
      , height
      , src: largeimage.href
      , dominantcolor: image.dataset.dominantcolor
      , title: image.alt
      , description: caption ? caption.textContent : ""
    };
  }
}
