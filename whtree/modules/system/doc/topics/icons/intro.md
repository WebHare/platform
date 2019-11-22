Icons are used in large buttonbars, smaller toolbars, lists and, rarely, panels. This means there are 6 often used size/color combinations:
- 16x16 pixels for list, panel, small toolbars
- 24x24 pixels for the large buttonbar on top of most applications
- "White" (#f0f0f0) non-filled icons without supporting colors for use on a dark (#4a4a4a) background)
- "Black" (#4a4a4a) icons for -use in lists and- on white backgrounds. These often use "black" for base shape.
- "Color" (To be implemented) -> for icons in lists and on white backgrounds, these have a background  fill and/or  support colors. "WebHare blue" is often used (#52aefe) for details

## Naming convention

SVG files can be optimized for color and size, and this is reflected in the name. 

Examples:

* filename.svg - used for all sizes and colors
* filename.16x16.svg - used for 16x16 pixels in all colors
* filename.b.svg - used for all sizes in black (white background)
* filename.24x24.w.svg  - used for 24x24 pixel in white (on a dark background)


WebHare will always try to display a requested icon, even if the ideal size or color is not available. For missing sizes the image is scaled. For missing specific color files all items in “black” or “white” will be inverted (#4a4a4a is set to #f0f0f0 and vice versa). Preferably a .b or .w is used for inverting since these contain no other colors.

## IXO (Icon XML) files
You can use .IXO xml files to create icons by referring to SVG files or other IXO files. This allows you to work with backgrounds and overlays.

```
<icon xmlns="http://www.webhare.net/xmlns/tollium/icons">
  ...
</icon>
```

## Available layers
```
<backgroundlayer/>
<layer/>  
```
A regular layer creates a 1px larger cutout in the underlying normal layer. A backgroundlayer does not get this cutout.


## Layer properties
```
src="~URL" <!-- URL to image, for example "tollium:backgrounds/file" -->
size="##px" <!-- size in pixels, usually 16 or24. Layer only displayed for this icon size. -->
color="w|b|c" <!-- color version of icon: white, black, color version. Layer is only displayed when this color version is asked for. -->

translatex="#px" <!-- depricated ? -->
translatey="#px" <!-- depricated ? -->
```

## Example IXO
```
<icon xmlns="http://www.webhare.net/xmlns/tollium/icons">
  <backgroundlayer src="tollium:backgrounds/file" color="c"/> <!-- Is 'b' ATOW but should be "c" as soon as available! -->
  <layer src="tollium:objects/file"/>
  <layer src="tollium:overlays/filetypes/rtd"/>
</icon>
```
This backgroundlayers is only shown when a color version is asked for, for example in lists. The backgroundlayers consists of white/very light gray gradient that is mostly needed when the line is selected. Since it is a backgroundlayer, the layer drawn above it (file icon) does not cause a cutout. The top layer (rtd overlay) does cause a cutout in the file icon.


## Best practices for drawing
* Create a 16x16 and 24x24 version when needed - for most icons that use horizontal or vertical lines or squares this is needed to align pixels. 
* Draw a pixel-sharp icon on a 2x pixel canvas; IE 32x32 for 16x16 and 48x48 for 24x24 - this allows you to create icons that look even better on retina.
* Do not use both #4a4a4a and #f0f0f0 colors in the same SVG file.
* Test view the images on a non-retina screen.


Ideally every icon should be optimised for both sizes and colors, which usually means creating at least 2 SVG’s - one for each size.

## Best practices for naming and choosing
* When creating an icon that can be reused, always create a neutral name; for example "eye", not "view", "plus" not "add".
* Place these icons in the 'objects' folder.
* To create content-specific icons, create an IXO that refers to an object, IE a "view.ixo" to refer to "objects/eye".
