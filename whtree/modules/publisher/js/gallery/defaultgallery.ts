/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

/* import setupGallery from '@mod-publisher/js/gallery/defaultgallery'; */

import "./defaultgallery.scss";
import GalleryControllerBase from './gallerycontroller';
import openModalGallery from './defaultmodal';

export default function setupGallery(node, options) {
  options = { onclick: openModalGallery, ...options };
  return new GalleryControllerBase(node, options);
}
