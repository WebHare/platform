# Embedded documentation
Tollium allows you to embed documentation in your application which will be presented
by an `<iframe>` on the right side of the application. You can open a documentation page
by directly invoking  %TolliumControllerBase::OpenAppDocumentation with the desired URL
and the documentation panel will open with this URL.

You can additionally annoate `<heading>` elements with a `doclink=` attribute
containing the absolute URL of the documentation to open. If used, a Help icon
will appear which will open the requested documentation when clicked.

## Dynamic documentation
To make maintaining documentation built this way easier, you can use relative
URLs in the `doclink=` attribute and use %TolliumControllerBase::SetupDynamicDocumentation
to set a base URL for these links.

You need to do setup this URL before opening screens containing a `<heading>` with
a doclink.

## Tollium-styled documentation
Create a site using the 'WebHare interface' webdesign to use Tollium's theme
for documentation. You should create folders of type 'Tollium manual folder'
to hold the actual documentation.

You can point `SetupDynamicDocumentation` to a folder of this type using a `site::`
path. Set the `editdocumentation` in the setup call to allow the current user
to add and edit the documentation (you would generally use a `HasRight` check)

## Remote documentation
A `doclink=` of the form `module:path` refers to the `<documentation><embedded>` node of that module's definition. This
element is used to construct the documentation index by downloading `<rooturl>/<subpath>/whdocs-v1.json`.

The JSON file should have the following structure
- languages: array of objects:
  - code: string, eg 'en'
  - texts: array of objects:
    - topic: eg "objectprops/general"
    - link: documentation link relative to whdocs-v1.json
- editfallback: link to editor information, relative to whdocs-v1.json

Example:
```json
{ "languages":
  [ { "code": "en"
    , "topics": [ { "topic": "objectprops/general"
                  , "link": "objectprops-general/"
                  }
                , { "topic": "objectprops/seosettings"
                  , "link": "objectprops-seo/"
                  }
                ]
    }
  ]
, "editfallback": "docs-missing/"
}
```

The 'missingtopic' link is used when a user has editing rights to the documentation
but the requested the topic isn't present. The missing topic, language and referrer URL are added
to the URL. You would use this to inform editors on how to set up missing documentation.

Remote documentation is downloaded at startup and every 6 hours by the `tollium:updateremotedocumentation` task. You can
manually reschedule this task to force an immediately redownload of all documentation indices.

## WebHare platform documentation
The remote documentation for all builtin modules are hosted on https://docs.webhare.dev/embedded-documentation/.
This path is stored in the `system.services.webhare.docroot` registry key.
