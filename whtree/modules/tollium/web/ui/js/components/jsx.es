import * as toddImages from "@mod-tollium/js/icons";

/// JSX wrapper around toddImages.createImage
export function ToddImage({ image, width, height, color, ...props })
{
  return toddImages.createImage(image, parseInt(width), parseInt(height), color, props);
}
