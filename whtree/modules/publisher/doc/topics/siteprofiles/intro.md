Site profiles are used to add extra types and fields to the Publisher, or to extend the WebHare Publisher Application (CMS) application.

Site profiles are XML files and typically have `.siteprl.xml` extension. A site
profile is generally selected by selecting a webdesign for a Publisher site
which links the associated site profile with all the sites (as if all `<apply>`
rules and `<sitesettings>` rules where implicitly limited to the sites which
have seleceted the site profile).

A site profile can also be globally activated by a module (using a `<siteprofile>`
node in the `<publisher>` of a moduledefinition). This profile will then apply
to all sites.

Always keep in mind that types defined in siteprofiles (contenttypes, foldertypes,
widgets, rdtypes, etc) are global and not sitespecific. You should generally
not copy-paste such definitions without renaming them.
