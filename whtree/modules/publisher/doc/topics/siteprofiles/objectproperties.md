# Extending the Publisher

## Object properties
Modules can add extra properties to files and folders by setting up a content
type holding the data. Content types can be associated with any file or folder
in the Publisher (or any other object in the WHFS). Objects can have more than
one content type and corresponding data associated with them, but every object
can have only one instance of every content type.

Contenttypes have a namespace (commonly an URL) which should be globally
unique. These URLs do not have to point to an existing web page or have
anything to do with the site where content will be hosted - that just helps
to ensure that the chosen namespaces are unique.

The types are defined in a siteprofile, eg:

```xml
  <contenttype namespace="http://www.example.net/xmlns/mymetadata">
    <member name="addchat" type="boolean" />
    <member name="chatbotname" type="string" />
  </contenttype>
```

To extend the properties editor, declare a `<tabsextension>` which gives
the UI to set the defined members:

```xml
  <tabsextension xmlns="http://www.webhare.net/xmlns/tollium/screens" name="mysettings">
    <newtab title="Extra settings">
      <checkbox composition="contentdata" cellname="chatbotname" title="Chatbot's name" />
      <checkbox composition="contentdata" cellname="addchat" title="" label="Add chat ?" />
    </newtab>
  </tabsextension>
```

The `<tabsextension>` can also use `<insert>` with one of the following positions:
`name`, `title`, `description`, `keywords`, `publicationsettings`, `tasksettings` or `settings`

And add this tabsextension to the object properties screen to the proper
filetypes using an apply rule:

```xml
  <apply>
    <to type="file" />
    <extendproperties extension="#mysettings" contenttype="http://www.example.net/xmlns/mymetadata" />
  </apply>
```

## Adding code to object properties
In general, property editor extensions do not need to use HareScript - Tollium's
components and compositions are generally powerful enough. But in some cases
you may want to add HareScript code to implement additional behaviours and actions for
an object property extension, for example to execute code after changing an object's properties

You can add code by setting an `implementation` and `library` for the `<tabsextension>`:

```xml
  <tabsextension xmlns="http://www.webhare.net/xmlns/tollium/screens" name="mysettings"
                 implementation="lib" library="myextension.whlib">
    ...
  </tabsextension>
```

And in `myextension.whlib`, implement an object named after your extension
deriving from %TolliumTabsExtensionBase, for example:

```harescript
LOADLIB "mod::system/lib/database.whlib";

PUBLIC STATIC OBJECTTYPE sitesettings EXTEND TolliumTabsExtensionBase
<
  UPDATE PUBLIC MACRO SubmitExtension(OBJECT work)
  {
    IF (^chatbotname->name LIKE "*/*")
      work->AddErrorFor(^chatbotname, "Chatbot name may not contain a slash");
  }
>;
```

Extensions can also use `this->contexts->objectpropsapi` to access the %ObjectPropsAPI
for the current object, eg `this->contexts->objectpropsapi->targetid` to get
the ID of the object whose properties are being edited (0 if we're creating a new object).
