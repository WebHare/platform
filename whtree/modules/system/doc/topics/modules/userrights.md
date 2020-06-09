# Users and rights

Rights can optionally be bound to an objecttype.

Rights are hierarchical with the hierarchie defined by their "implied by" property.
All rights in the userrights application are directly or indirectly implied by
the Sysop (system:sysop) right.

For most modules one simple right directly implied by `system:sysop` (conventionally named 'speruser') will be sufficient.
The following example shows how to define such a right in the moduledefinition:

```xml
  <rights>
    <right name="superuser" tid="module.superuser">
      <impliedby right="system:sysop" />
    </right>
  </rights>
```

