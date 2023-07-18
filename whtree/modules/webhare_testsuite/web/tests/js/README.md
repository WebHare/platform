# The JS folder

This directory, visible as https://my.webhare.dev/.webhare_testsuite/tests/js/ is fullyserved by the access rule

```
    <webrule path="root:/.webhare_testsuite/tests/js/"
             match="initial"
             allowallmethods="true"
             router="web/tests/js/testrouter.ts#handleJSRequest" />
```

so you shouldn't be able to see this directory directly. Eg https://my.webhare.dev/.webhare_testsuite/tests/js/testrouter.ts
should not reveal any code
