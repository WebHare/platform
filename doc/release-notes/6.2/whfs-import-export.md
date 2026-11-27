## Breaking changes

### WHFS exports no longer contain dates and a header by default
`wh whfs export`, `storeWHFSExport` and `createWHFSExportZip` no longer write the header comment (WebHare version,
server and export date) and the `created` and `modified` dates of each object, so exporting unchanged content again
gives identical files, eg. for exports you keep in git. The import never used them. If you read them from an export,
pass `--with-info` (`includeInfo: true`) to get them back.

## WHFS
- `wh whfs export --sub-path <path>` (`subPath`) exports only part of a folder, at the same location and with the same
  relative links as a full export.
- `storeWHFSExport` and `createWHFSExportZip` accept `filterInstance`, to change or leave out instance data per
  object.
- An export to a directory doesn't remove the files an earlier export left there. Export into an empty directory, or
  objects that were deleted since then come back when you import it.
- Importing a folder that has metadata no longer lowercases its name.
