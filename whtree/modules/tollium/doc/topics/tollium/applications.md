# Building an application

This guide assumes you already have setup a module for your work

Step 1: add an <application> to your moduledefinition's <portal> node

```
<portal>
  <application name="mynewapp" screen="tolliumapps/mynewapp/main.xml#main">
    <accesscheck>
      <requireright right="system:sysop" />
    </accesscheck>
  </application>
</portal>
```

This registers a simple application which can be accessed by adding `?app=<modulename>:<newapname>` to the URL (eg ?app=mymodule:myapp).

The application will not appear in the WebHare menu until you add a 'group' and a 'title' or 'tid' attribute

## Contexts

The Tollium contexts offer quick access to objects you generally need throughout
your Tollium application, such as the controller, a WRD Schema, and optionally
your own 'api' or 'app' object.

The contexts object is available on the controller, every screen, and every
component. (components simply forward you to the screen's contexts, but this
allows a lot of APIs to stop caring whether you pass them a screen, controller
or contexts).

The following contexts are available by default:
- `contexts->controller`: The current controller
- `contexts->screen`: The screen associated with this context
- `contexts->user`: The current Tollium user object (eg. for GetRegistryKey)

Note that requesting an unset context will throw an exception. If you need to
check if a context is available, you will need to explicity check with `IsSet()`.
We assume that if you access a context, you will need it.
