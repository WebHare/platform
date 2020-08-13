# Embedded documentation
Tollium allows you to embed documentation in your application which will be presented
by an `<iframe>` on the right side of the application. You can open a documentation page
by directly invoking  %TolliumControllerBase::OpenAppDocumentation with the desired URL
and the documentation panel will open wit this URL.

You can additionally annoate `<heading>` elements with a `doclink=` attribute
containing the absolute URL of the documentation to open. If used, a Help icon
will appear which will open the requested documentation when clicked

## Dynamic documentation
To make maintaining documentation built this way easier, you can use relative
URLs in the doclink=  attribute and use %TolliumControllerBase::SetupDynamicDocumentation
to set a base URL for these links.

You need to do setup this URL before opening screens containing a `<heading>` with
a doclink.
