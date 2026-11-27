## Breaking changes

### WHFS exports no longer contain dates and a header by default
`wh whfs export`, `storeWHFSExport` and `createWHFSExportZip` no longer write the header comment (WebHare version,
server and export date) and the `created` and `modified` dates of each object, so exporting unchanged content again
gives identical files, eg. for exports you keep in git. The import never used them. If you read them from an export,
pass `--with-info` (`includeInfo: true`) to get them back.

## WHFS
- The new `wh whfs import <folder> <target>` imports a folder written by `wh whfs export` into WHFS. `--dry-run` shows
  what would be created, updated and removed, `--overwrite` overwrites existing objects, `--sub-path <path>` imports
  only a part of the source and `--prune` removes (recycles) what isn't in the source. Nothing is imported if there are
  errors.
- If the source of an import is an exported folder itself (eg. `out/myfolder` after `wh whfs export /site/myfolder/ out/`)
  its contents are imported into the target folder, and its type, properties and instances replace those of the target
  folder, also without `--overwrite`. The target folder keeps its own name. Importing `out/` still adds `myfolder` to
  the target folder.
- `--sub-path` (`subPath`) doesn't import or update anything outside that path. If the folders above it don't exist yet
  in the target folder they're created as plain folders, without their type and properties from the source. Import
  those folders with `--overwrite` later to complete them.
- `--overwrite` doesn't remove instances that an existing object has but the source doesn't.
- `--prune` only removes objects from folders the source fully describes (those it has a `^folder.whfs.yml` for): the
  whole target folder when importing an exported folder itself, and otherwise only inside the exported folders. Anything
  next to them in the target folder is left alone.
- `wh whfs export --sub-path <path>` (`subPath`) exports only part of a folder, at the same location and with the same
  relative links as a full export.
- `storeWHFSExport` and `createWHFSExportZip` accept `filterInstance`, to change or leave out instance data per
  object.
- An export to a directory doesn't remove the files an earlier export left there. Export into an empty directory, or
  objects that were deleted since then come back when you import it.
- `importIntoWHFS` accepts `dryRun`, `subPath`, `modified` (the date to set on every imported object) and
  `filterInstance`, and returns the `actions` it took.
- The new `pruneWHFSImport` removes what isn't in the source of an import, using the `pruneScope` that `importIntoWHFS`
  returns. It's a separate call so you can decide whether to prune if the import reported errors. `keep` protects
  objects from it.
- Importing a folder that has metadata no longer lowercases its name.
