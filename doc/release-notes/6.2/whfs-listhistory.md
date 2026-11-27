## Breaking changes

### `listHistory()` no longer returns autosaves by default
`WHFSObject.listHistory()` in `@webhare/whfs` now leaves out the `autosave` and `abandoned-autosave` entries unless
you pass `{ includeAutosaves: true }`, like HareScript's `ListObjectHistory` already did. If your code looks for
autosaves in the history, or relies on the position of an entry in the returned array, add this option.

## WHFS
- `@webhare/whfs` now exports the `HistoryEntry` and `HistoryEntryType` types for the entries returned by
  `WHFSObject.listHistory()`, and `ListHistoryOptions` for its options.
