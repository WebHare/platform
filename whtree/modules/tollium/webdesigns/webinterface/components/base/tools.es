import * as dompack from 'dompack';
import * as domfocus from "dompack/browserfix/focus";
import $todd from "@mod-tollium/web/ui/js/support";

export function getBorderWidth(borders)
{
  return (borders && borders.left ? $todd.settings.border_left : 0) + (borders && borders.right ? $todd.settings.border_right : 0)
}
export function getBorderHeight(borders)
{
  return (borders && borders.top ? $todd.settings.border_top : 0) + (borders && borders.bottom ? $todd.settings.border_bottom : 0)
}
export function getSpacerWidth(spacers)
{
  return (spacers && spacers.left ? $todd.settings.spacer_left : 0) + (spacers && spacers.right ? $todd.settings.spacer_right : 0)
}
export function getSpacerHeight(spacers)
{
  return (spacers && spacers.top ? $todd.settings.spacer_top : 0) + (spacers && spacers.bottom ? $todd.settings.spacer_bottom : 0)
}

export function copyValueToClipboard(node)
{
  let alreadyfocused = node == domfocus.getCurrentlyFocusedElement();
  node.select();
  if(!alreadyfocused)
    dompack.focus(node);

  document.execCommand("copy");

  if(alreadyfocused) //flash if already focused
  {
    node.selectionStart=0;
    node.selectionEnd=0
    window.setTimeout( () => node.select(), 100);
  }
}
