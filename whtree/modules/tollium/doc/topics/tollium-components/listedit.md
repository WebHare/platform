# Array and listedit

## Arrayedit
Minimal setup:

```xml
  <arrayedit name="products" roweditscreen="#editproduct" orderable="true" height="1pr">
    <column name="amount" type="integer" align="right" width="10x" />
  </arrayedit>
```

Basic rowedit screen:
```xml
  <screen name="editspecification" implementation="rowedit">
    <compositions>
      <record name="row" />
    </compositions>
    <body>
      <textedit composition="row" cellname="amount" />
    </body>
    <footer>
      <defaultformbuttons buttons="ok cancel" />
    </footer>
  </screen>
```

