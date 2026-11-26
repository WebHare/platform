## Breaking changes
- `GetApplyTesterForObject` in HareScript now evaluates the siteprofile apply rules for a draft or version as if it
  were the file it's a draft or version of, as the TypeScript `getApplyTesterForObject` already did. Before, apply
  rules were matched against the draft's location in `/webhare-private/`. The object information the applytester
  returns (eg. the object id used as a webdesign's target) now also refers to the original file. If your module works
  around this, eg. by opening the applytester for the original file instead, check whether that workaround is still
  needed.
