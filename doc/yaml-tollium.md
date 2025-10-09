# Tollium and YAML
We are adding support to build Tollium components in YAML files. The primary focus is on being able to specify all critical
properties at the *member* level of a siteprofile or wrdschema - enough to construct a safe to use component.

How this plays out in siteprofiles:

- components set up members with optional constraints.
    ```yaml
    types:
      myType:
        members:
          str:
            type: string
          blubImg:
            type: file
            constraints:
              accept:
                - bitmap
    ```

- these constraints are then used when creating a component from the member by `suggestTolliumComponent` (tested by mod::webhare_testsuite/tests/tollium/api/test_constraints.ts)

- components can also directly declare their component:
    ```yaml
    ...
      whUser:
        type: string
        tid: ~username
        component:
          "http://www.webhare.net/xmlns/system/components#selectuser":
            inputKind: wrdGuid
    ```

- these code paths come together in metatabs.ts `determineComponent`.

- `describeMetaTabs` gathers this information and it finally ends up in `this->metatabsconfig` of editbase.whlib. This is tested by mod::webhare_testsuite/tests/publisher/siteprofile/test_metatabsdata.ts

YAML components are *not* intialized through StaticInit, but through dynamic component creation and then invoking SetYamlProps. This implies that pre- and postinit for this component will already have
been invoked. If you see a components derived from TolliumFragmentBase not setting their title the most common fix will be something like

```
  UPDATE MACRO SetTitle(STRING newtitle)
  {
    ^first_visible_component->title := newtitle;
    TolliumFragmentBase::SetTitle(newtitle);
  }
```
