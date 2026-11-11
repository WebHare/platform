## Finding where WHFS types are used
`wh whfs find-instances <type>` finds the files and folders that use a WHFS type: objects of that type, objects with
instance data of that type and objects embedding it (eg. a widget inside rich text). The type can also be a mask
(eg. `'mymodule:*'`), optionally limited to some kinds of types with `--kind file|folder|widget|instance`.

- `--where` filters on the instance data (`$`) and the object (`obj`) with a JavaScript expression, eg.
  `wh whfs find-instances platform:filetypes.form --where '$.maxsignups > 0'`
- `--select` shows members of the instance data, `--start-folder` limits the search to one or more folders
- `--count` shows per type how many objects use it, eg. `wh whfs find-instances --count 'mymodule:*' --kind widget`
- `--republish` schedules the found objects, and any objects referring to them, for republishing
- Objects in the recycle bin and in the versions and drafts storage are ignored unless you add `--all`

`findwidgets.whscr` in the publisher module has been removed. Use `wh whfs find-instances --count '<mask>' --kind widget`
to count uses, the default output (or `--ids`) instead of `--showuse`, and `--republish` to republish them. Unlike
`findwidgets.whscr`, objects in the recycle bin and in the versions and drafts storage are skipped unless you add `--all`.
