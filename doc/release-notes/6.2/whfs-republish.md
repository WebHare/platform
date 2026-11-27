## Republishing from TypeScript
`@webhare/whfs` can now republish folders and wait for publication to finish:

- `folder.republish(options)` republishes the files in a folder. Pass `recursive: true` to include its subfolders. By
  default it only republishes files whose output depends on the web design and files whose last publication failed.
  Pass `which: "all"` to republish every published file, or `which: "failed"` to only retry failed files.
- `republishWHFSObjects(objects, options)` does the same for a list of files and folders (or their ids). Files in the
  list are always republished.
- `waitForPublication(objects, { deadline, signal })` waits until the publication of these files and folders (including
  subfolders) has finished, and returns whether it completed and which files failed. Call it after committing the work
  that republished them.

Republishing takes effect when the work is committed. Republishing the WHFS root, which republishes all sites, requires
`allowRoot: true`, and only has an effect with `recursive: true`.
