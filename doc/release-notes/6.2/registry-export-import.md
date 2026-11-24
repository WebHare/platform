## Breaking changes

### `wh registry list` no longer shows values
`wh registry list` now shows the name, type and description of the matching registry keys instead of their values, and
accepts more than one mask. Scripts that read the `value` property from `wh registry list --json` should use
`wh registry export --json` instead, which returns an object mapping the key names to their values.

## Exporting and importing registry keys
- `wh registry export <mask...>` exports the matching registry keys as YAML, or JSON with `--json`
- `wh registry import <file>` imports such an export, `-` reads it from standard input. It fails without changing
  anything if a key doesn't exist in the registry, unless you pass `--skip-unknown`. Keys whose value didn't change
  are left alone
- Values that contain a blob are skipped by the export and refused by the import. The import also refuses a whole
  number for a float key, as it would be stored as an integer. Inside a record or array this is only detected if the
  current float isn't a whole number itself
