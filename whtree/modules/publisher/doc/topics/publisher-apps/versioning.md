# Versioning and content approval

Versioning and approval in WebHare is based on a 'four eyes' principle - it enforces that all content that appears on a URL
has been approved by someone else who offered the content. It also requires approval for actions that 'change' the URL of
objects, eg moving or depublishing files, and tracks the history and actions taken.

## Preparation
- Remove automatic index creation such as done by `<folderindex indexfile="copy_of_file" fullpath="/design/document.rtd"/>`. Automatic
  index creation is not compatible with versioning - it would be a backdoor to make new URLs appear without approval.
- Content approval requires removing backdoors that allow content from external sources to appear. Consider:
  - disabling link types, especially content links
  - avoiding embedded objects that pull content from elsewhere

You'll need to set up a versioning policy object and a review app in your moduledefinition

```xml
  <publisher>
    <versioningpolicy name="site" objectname="lib/internal/versioningpolicy.whlib#SitePolicy" />
  </publisher>

  <portal>
    <application name="versioning" group="system:cms" tid="module.versioningapp" startmacro="lib/internal/versioningpolicy.whlib#StartVersioningApp" icon="tollium:applications/versioning">
      <accesscheck>
        <requireright right="system:sysop" />
      </accesscheck>
    </application>
  </portal>
```

An example policy object and app launcher could be

```harescript
LOADLIB "module::publisher/versioning.whlib";

PUBLIC STATIC OBJECTTYPE SitePolicy EXTEND VersioningPolicyBase
<
  UPDATE PUBLIC RECORD FUNCTION GetReviewAppConfig(RECORD data)
  {
    RECORD rec := VersioningPolicyBase::GetReviewAppConfig(data);
    OBJECT site := OpenSiteByName(data.sitename);
    RETURN ValidateOptions(rec,
        [ canreview :=          data.controller->tolliumuser->HasRightOn("system:fs_fullaccess", site->id)
        ]);
  }

  UPDATE PUBLIC RECORD FUNCTION GetSubmitRequestData(OBJECT parentscreen, OBJECT policy, OBJECT file, RECORD options)
  {
    RECORD result := VersioningPolicyBase::GetSubmitRequestData(parentscreen, policy, file, options);
    IF(RecordExists(result))
      result.expirydate := AddMonthsToDate(12, GetCurrentDatetime());
    RETURN result;
  }
>;


PUBLIC MACRO StartVersioningApp(OBJECT controller, RECORD data)
{
  RunVersioningApplication("<sitename>", controller, data);
}
```

## The actual conversion
- Make sure the site is published on its final URL! Enabling versioning blocks changes to the base URL where the site is published
- Run `wh manageversioning` to switch a site to versioning

## Deleting a versioned site
Removing versioned content is intentionally made hard to prevent an accidental cascade from deleting history. To delete a
site, find its id and:

```bash
wh sql 'delete from system.fs_versionevents where fs_site=<SITEID>'
wh sql 'delete from system.fs_objects where id=<SITEID>'
```
