# Publisher tweaks
Modifying the behavior of the Publisher application

## Upload type mapping
Modifies the WebHare file types chosen for uploaded files.

Type mapping also affects files uploaded through Webdav or by extracting a ZIP file.

Example that force all text files with a `*.bib` extension to be mapped to a custom bib file type:

```xml
  <apply>
    <to type="folder" />
    <uploadtypemapping filenamemask="*.bib" mimetypemask="text/plain"
                       filetype="http://mysite.example.com/xmlns/bibfile" />
  </apply>
```
