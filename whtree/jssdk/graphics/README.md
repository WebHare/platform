# WebHare graphics

Server-side image resizing using WebHare's image-cache processing rules and QR-code generation.

- `createdResizedSharpImage(resource, method)` accepts a `ResourceDescriptor` and
  `ResizeMethod` and returns a `Promise<Sharp>` for further processing.
- `resizeImage(resource, method)` accepts the same arguments and returns a
  `Promise<File>`, with a MIME type and filename extension matching the output.
- `createQRCode(text, options?)` returns a `Promise<File>` containing a PNG QR
  code, with optional size, colors, error correction, and logo settings.

If `method.format` is omitted or `"keep"`, the source format is preserved where
supported (BMP is converted to PNG and TIFF to JPEG). The resource must contain
image metadata, for example by loading it with `{ getImageMetadata: true }`.

JPEG output blends transparency, including canvas padding, onto white. Output
formats that support transparency retain it.
