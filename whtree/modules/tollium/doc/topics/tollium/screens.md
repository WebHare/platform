# Screens
Tollium applications consist of one or more screens. These screens are defined in screens XML files and one
file may contain multiple screens as long as they all have a unique `name`. For example:

```xml
<screens xmlns="http://www.webhare.net/xmlns/tollium/screens"
         library="screenfile.whlib"
         gid="tolliumapps.myapp.screenfile">

  <screen name="topscreen" gid=".topscreen" allowresize="true">
    <body>
    </body>
  </screen>
</screens>
```

will give you a resizable but otherwise empty screen, a good starting point for
a new application.

You also need to deliver HareScript code to implement setup and actions for
the new screen. This files should be pointed to by the `library=` parameter

```harescript
PUBLIC STATIC OBJECTTYPE TopScreen EXTEND TolliumScreenBase
<
>;
```
