## Images in rich text documents keep their file name
An image embedded in a rich text document used to lose its file name when the document was stored: the name was replaced
by the image's content id (the `cid:` its `<img>` refers to). The file name is now stored with the image, in WHFS and in WRD,
and survives export and import.

- In TypeScript, `fileName` of an embedded image's `ResourceDescriptor` is the file name it was stored with, or `null` if
  it has none. It used to be the content id. Images stored before this change have no file name
- In HareScript, the `filename` of a record in a rich document's `embedded` array is the file name if the image has one,
  and still the content id otherwise. Code that needs the content id must use `contentid`
- Image URLs for rich text documents now end in the image's file name, eg. `kikker.jpg`. For images without a file name
  TypeScript renders `image.<extension>`, where it used to render the content id. URLs that are already published keep
  working
- Content ids of new images are derived from the image's contents (`img-<hash>.<extension>`) instead of being random.
  Importing the same document twice, or on two servers, gives the same result
- Exports made earlier (`wh whfs export`, WRD exports) have the content id as an image's `fileName`. Importing those
  stores that content id as the file name

Images uploaded in the rich text editor don't keep their file name yet.
