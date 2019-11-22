# Setting up versioning/content approval

## Preparation
- Remove automatic index creation such as done by `<folderindex indexfile="copy_of_file" fullpath="/design/document.rtd"/>`. Automatic
  index creation is not compatible with versioning - it would be a backdoor to make new URLs appear without approval.
- Content approval requires removing backdoors that allow content from external sources to appear. Consider:
  - disabling link types, especially content links
  - avoiding embedded objects that pull content from elsewhere

## The actual conversion
- Run `wh manageversioning` to switch a site to versioning

## Deleting a versioned site
Removing versioned content is intentionally made hard to prevent an accidental cascade from deleting history. To delete a
site, find its id and:

```
wh sql 'delete from system.fs_versionevents where fs_site=<SITEID>'
wh sql 'delete from system.fs_objects where id=<SITEID>'
```
