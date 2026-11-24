## Breaking changes

### File name of images in rich text documents
`fileName` of an embedded image's `ResourceDescriptor` in TypeScript is now the file name it was stored with, or `null`
if it has none. It used to be the content id. In HareScript, the `filename` of a record in a rich document's `embedded`
array is the file name if the image has one, and still the content id otherwise. Code that needs the content id must use
`contentid` (HareScript) or the key of `CompoundDocument.embedded` (TypeScript).

## Images in rich text documents keep their file name
An image embedded in a rich text document used to lose its file name when the document was stored: the name was
replaced by the image's content id (the `cid:` its `<img>` refers to). The file name is now stored with the image, in
WHFS and in WRD, and survives export and import. See also
[the breaking change](#file-name-of-images-in-rich-text-documents) in what `fileName` returns.

- Images stored before this change have no file name
- Image URLs for rich text documents now end in the image's file name, eg. `kikker.jpg`. For images without a file name
  TypeScript renders `image.<extension>`, where it used to render the content id. URLs that are already published keep
  working
- Content ids of images in documents that TypeScript builds or imports are derived from the image's contents
  (`img-<hash>.<extension>`) instead of being random. Importing the same document twice, or on two servers, gives the
  same result. Images added in the rich text editor still get a random content id
- Exports made earlier (`wh whfs export`, WRD exports) have the content id as an image's `fileName`. Importing those
  stores that content id as the file name
- The rich text editor keeps the file names of images that are already in a document. Images added in the editor don't
  get a file name yet
