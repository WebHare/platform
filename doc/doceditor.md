# Document editor

There are three sources of hooks into the document editor:
- editProps (or extendProperties). Tabs/sections added to metadata. Stored in (workflowed) whfsTypes. There can be multiple extendProps in a documenteditor
- The main content. set using setContentEditor. There can be only one. Manages main content and toolbars. Examples are richtext, form and plaintext editors. In general
  the main content editor matches its type (eg platform:filetypes.richdocument is edited by the richdocument editor) but custom filetypes may reuse existing (built-in) editors
- Apply rules. These can define a `fsObjectPolicy` which overrides the behavior of objects in the document editor.

An FSObjectPolicy is an interface that a fsObjectPolicy object can partially implement. An object should only implement those interfaces it actually overrides so we can avoid unnecessary calls

These policies are intended to support, now or in the future:
- object level read/write access checks overwrites. The publisher may invoke this for objectProps so this must be done by TS APIs to avoid out-of-date errors in the publisher
- publication defaults: start and stop publishing times if not yet set. This callback will be invoked by the document editor with the current draft/autosave ID

It is intended to have FSObjectPolicy deprecate manually setting document-level editapi properties such as onprechecksave, onconfirmsaveandpublish, oncanview, onview, oncanpreview, onpreview, onpreviewlink and internallinkroots.
