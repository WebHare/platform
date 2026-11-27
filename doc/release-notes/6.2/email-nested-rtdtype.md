## Breaking changes

### Email widgets pass the `rtdtype` of a nested rich text document on
When an email widget renders a rich text document with `this->context->GetRTDBody` and passes an `rtdtype`, the widgets
inside that document now get that type as their `rtdtype`. Before, they got the type of the containing document, as
they still do when no `rtdtype` is passed. An `rtdtype` that doesn't exist now throws when the document is rendered,
as it already did in the RTE preview. Check email widgets that look at `this->rtdtype`.
