/* import setupGallery from '@mod-publisher/js/gallery/defaultgallery'; */

import "./defaultgallery.scss";
import GalleryControllerBase from './gallerycontroller.es';
import openModalGallery from './defaultmodal.es';

export default function setupGallery(node, options)
{
  options = { onclick: openModalGallery, ...options };
  return new GalleryControllerBase(node, options);
}
