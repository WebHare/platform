/// @ts-nocheck -- Bulk rename to enable TypeScript validation

/* import ModalGalleryBase from '@mod-publisher/js/gallery/fullscreencontroller'; */
import * as dompack from 'dompack';
import KeyboardHandler from "dompack/extra/keyboard";
import * as swipe from 'dompack/browserfix/swipelistener';

//The gallery controller launches modal mode whenever an image is clicked and should offer nicer keyboard controllers
export default class ModalGalleryBase {
  constructor(gallery, select) {
    this.gallery = gallery;
    this._selectedidx = select;
  }

  //derived classes should invoke showOverlayNode with their fullscreen node
  showOverlayNode(node) {
    this._currentoverlay = node;

    this.showImage(this._selectedidx, { last: null });

    node.tabIndex = 0;
    document.body.appendChild(node);

    node.focus();
    new KeyboardHandler(node, {
      "Escape": evt => this._onEscape(evt),
      "Tab": evt => dompack.stop(evt),
      "Shift+Tab": evt => dompack.stop(evt),
      "ArrowLeft": evt => this._onArrow(evt, -1),
      "ArrowRight": evt => this._onArrow(evt, +1)
    });

    swipe.enable(node);
    node.addEventListener("dompack:swipe", ev => {
      if (ev.detail.direction === "e")
        this.previousImage();
      else if (ev.detail.direction === "w")
        this.nextImage();
    });
  }

  _onEscape(evt) {
    dompack.stop(evt);
    this.close();
  }

  _onArrow(evt, idx) {
    dompack.stop(evt);
    if (idx > 0)
      this.nextImage();
    else
      this.previousImage();
  }

  close() {
    if (document.hasFocus() && document.activeElement === this._currentoverlay) {
      const slides = this.gallery._getSlides();
      console.log(slides[this._selectedidx]);
      if (this._selectedidx < slides.length)
        slides[this._selectedidx].querySelector('a').focus();
    }

    if (this._currentoverlay)
      this._currentoverlay.parentNode.removeChild(this._currentoverlay);

    this._currentoverlay = null;
  }

  previousImage() {
    this.gotoImage(this._selectedidx - 1);
  }

  nextImage() {
    this.gotoImage(this._selectedidx + 1);
  }

  gotoImage(idx) {
    if (this._selectedidx === idx || idx < 0 || idx >= this.gallery.getNumSlides())
      return;

    const last = this._selectedidx;
    this._selectedidx = idx;
    this.showImage(idx, { last });
  }

  getSelectionState() {
    const photos = this.gallery.getNumSlides();
    const retval = {
      total: photos,
      current: this._selectedidx,
      first: this._selectedidx === 0,
      last: this._selectedidx === photos - 1
    };
    return retval;
  }
}
