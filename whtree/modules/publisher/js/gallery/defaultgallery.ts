/* import setupGallery from '@mod-publisher/js/gallery/defaultgallery'; */

import "./defaultgallery.scss";
import GalleryControllerBase from './gallerycontroller';
import openModalGallery from './defaultmodal';

export default function setupGallery(node: HTMLElement, options?: { onclick?: (controller: GalleryControllerBase, idx: number) => void }) {
  options = { onclick: openModalGallery, ...options };
  return new GalleryControllerBase(node, options);
}
