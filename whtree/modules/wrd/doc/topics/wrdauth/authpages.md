# Authentication pages
WRDAuth offers a set of standard pages and flows to deal with common tasks such as forgot password and email changes.

<!-- TODO: give a simple example of such a router. we don't support it standalone yet, but at least webshop has one
           we also need to refer to a general how-do-i router documentation then (somwhere with dynamic exceution)
 -->
WRDAuth sends out email at various points, these will use the [default mail template](x-whcode:default-mail-template)

To get links to the authrouter subpages, invoke `GetWRDAuthRouterWittyData` on the WRDAuth plugin with the url of your
account page.
