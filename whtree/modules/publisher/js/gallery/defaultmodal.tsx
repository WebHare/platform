/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import ModalGalleryBase from '@mod-publisher/js/gallery/modalgallery';

import "./defaultmodal.scss";
import * as dompack from 'dompack';
import { loadImage } from "@webhare/dompack";

/*
  photos: [{ image:   required [object with WrapCachedImage data lowres image ]
           , image2:  required [object with WrapCachedImage data hires image ]
           , title:   optional image title
           , video:   optional [jsonencoded string used for standard publisher video component ]
           }
          , ...etc
          ]
  title: optional overlay title
*/

export class DefaultModalGallery extends ModalGalleryBase {
  constructor(gallery, select) {
    super(gallery, select);

    this.countnode = <h2 class="wh-gallery-modal__counter" />;
    this.slidescontainer = <div class="wh-gallery-modal__slides" />;//

    this.overlay = <div class="wh-gallery-modal">
      {this.countnode}
      <div class="wh-gallery-modal__close" onClick={() => this.hideOverlay()}><i class="fal fa-times"></i></div>
      <h2 class="wh-gallery-modal__title">{this.title}</h2>
      {this.slidescontainer}
    </div>;

    this.previousnode = <div class="wh-gallery-modal__previous" onClick={() => this.previousImage()}><i class="fal fa-angle-left"></i></div>;
    this.overlay.appendChild(this.previousnode);

    this.nextnode = <div class="wh-gallery-modal__next" onClick={() => this.nextImage()}><i class="fal fa-angle-right"></i></div>;
    this.overlay.appendChild(this.nextnode);

    this.showOverlayNode(this.overlay);

    // this.photos = photos;
    //FIXME title? where to safely get it? or assume it's safe to take document.title    this.title = title ? title : "";

    this.resizefn = this.setImageSize.bind(this);
  }

  showImage(idx, options) {
    const state = this.getSelectionState();
    this.countnode.textContent = (state.current + 1) + " / " + state.total;

    if (this.completioncallback) {
      clearTimeout(this.completiontimer);
      this.completioncallback();
    }

    this.overlay.classList.toggle("wh-gallery-modal--firstslide", state.first);
    this.overlay.classList.toggle("wh-gallery-modal--lastslide", state.last);

    this.nextimage = this.createImage(idx, options.last !== null);

    const viewport = this.getWindowSize();
    this.nextimage.style.transform = "translate3d(" + (idx > options.last ? viewport.x : -viewport.x) + "px,0,0)";
    this.slidescontainer.appendChild(this.nextimage);
    this.setImageSize({ type: "newimage" });
    this.nextimage.clientWidth;//force css update
    this.nextimage.style.transform = "translate3d(0,0,0)";
    if (this.currentimage) {
      this.currentimage.style.transform = "translate3d(" + (idx > options.last ? -viewport.x : viewport.x) + "px,0,0)";
      this.currentimage.classList.remove("wh-gallery-modal__image--selected");
    }

    this.completioncallback = () => {
      this.completioncallback = null;
      this.activeidx = idx;
      if (this.currentimage)
        this.slidescontainer.removeChild(this.currentimage);
      this.currentimage = this.nextimage;
      this.currentimage.classList.add("wh-gallery-modal__image--selected");

      this.busy = false;
    };
    this.completiontimer = setTimeout(this.completioncallback, 500);
  }

  getWindowSize() {
    this.viewport = {
      x: window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth,
      y: window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight
    };
    return this.viewport;
  }

  async preloadImage(wrappernode, imginfo, transition) {
    const preloadedimage = await loadImage(imginfo.src);
    if (preloadedimage && wrappernode) {
      preloadedimage.width = imginfo.width;
      preloadedimage.height = imginfo.height;

      wrappernode.classList.remove("wh-gallery-modal__image--loading");
      if (transition)
        preloadedimage.style.opacity = "0";
      wrappernode.appendChild(preloadedimage);
      wrappernode.clientWidth;// force css update
      if (transition)
        preloadedimage.style.opacity = "1";

      const resizenode = wrappernode.querySelector(".wh-gallery-modal__imagesizer");
      if (resizenode)
        dompack.empty(resizenode);//remove loading indicator
    }
  }

  createImage(idx, transition) {
    const imginfo = this.gallery.getSlide(idx);
    const imagenode =
      <div class="wh-gallery-modal__image wh-gallery-modal__image--loading"
        style={{
          maxWidth: imginfo.width + "px",
          maxHeight: imginfo.height + "px",
          backgroundColor: imginfo.dominantcolor
        }}>
        <div class="wh-gallery-modal__imagesizer" style={{ paddingTop: ((1 / imginfo.aspect) * 100) + "%" }}>
          <span class="far fa-circle-notch fa-spin" />
        </div>
        {imginfo.title
          ? <div class="title">{imginfo.title}</div>
          : null
        }
      </div>;

    //TODO video support ? but our gallery doesn't pass though videos yet. it should?
    // if( this.photos[idx].video )
    // {
    //   imagenode.appendChild(<div class="video-playbtn" />);

    //   imagenode.addEventListener("click", ev => {
    //     if( imagenode.querySelector(".wh-video") )
    //       return;

    //     imagenode.appendChild(<div class="wh-video" data-video={this.photos[idx].video} data-video-options="{&#34;autoplay&#34;:1}" />);
    //     dompack.registerMissed(imagenode);
    //   });
    // }

    this.preloadImage(imagenode, imginfo, transition);

    return imagenode;
  }

  setImageSize(ev) {
    if (!this.viewport || (ev && ev.type === "resize"))
      this.getWindowSize();

    const spacing = { x: 100, y: 140 };

    for (const node of this.overlay.querySelectorAll(".wh-gallery-modal__image")) {
      let w = node.style.maxWidth.replace(/[^0-9]/g, "");
      let h = node.style.maxHeight.replace(/[^0-9]/g, "");
      const aspect = h / w;
      if (w > this.viewport.x - spacing.x) {
        w = this.viewport.x - spacing.x;
        h = ~~(w * aspect);
      }
      if (h > this.viewport.y - spacing.y) {
        h = this.viewport.y - spacing.y;
        w = ~~(h / aspect);
      }
      node.style.width = w + "px";
      node.style.marginLeft = -w / 2 + "px";
      node.style.marginTop = -h / 2 + "px";
    }
  }

  showOverlay(idx) {
    if (!idx)
      idx = 0;
    else if (idx < 0)
      idx = 0;
    else if (idx >= this.photos.length)
      idx = this.photos.length - 1;

    this.activeidx = idx;

    document.body.appendChild(this.overlay);

    document.documentElement.classList.add("hidescroll");

    this.currentimage = this.createImage(this.activeidx);
    this.slidescontainer.appendChild(this.currentimage);


    window.addEventListener("resize", this.resizefn);
  }

  hideOverlay(ev) {
    window.removeEventListener("resize", this.resizefn);

    document.documentElement.classList.remove("hidescroll");

    this.overlay?.remove();
  }
}

export default function openModalGallery(gallery, select) {
  return new DefaultModalGallery(gallery, select);
}
