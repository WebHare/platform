# Building emails
%PrepareMailWitty allows you to simply create rich templates emails (it is a replacement for the older MakeEmailComposer API, which is deprecated and may be removed in the future)

A simple mail template could look like:
```html
<!DOCTYPE html>
<html>
  <head>
    <title>An email about the number [yournumber]</title>
  </head>
  <body>
    <p>Dear [firstname],</p>
    <p>your number is: [yournumber]</p>
  </body>
</html>
```

Which can be used like this:

```harescript
// Set up a mailing
OBJECT mailcomposer := PrepareMailWitty("mod::mymodule/data/mail.html.witty");

// Set up the mail merge fields
mailcomposer->mergerecord := [ firstname := "Joe"
                             , yournumber := 42
                             ];

// Set up the recipient
mailcomposer->mailto := ["joe@example.net"];

// Queue the mail (assumes you already have opened owkr)
mailcomposer->QueueMailInWork();

// Commit the transaction to actually queue the mail
```

Note that the `<title>` will be used as the subject line for the email
if no explicit subject is given to the mail composer.

## Templates
PrepareMailWitty can wrap the email in a template by specifying a witty resource as the 'mailtemplate' option. A mailtemplate looks like this:

```witty
<!DOCTYPE html>
<html>
  <body>
    <div>Standard header</div>
    <slot name="mailbody"></slot>
    <div>Standard footer</div>
  </body>
</html>
```

The `slot[name=mailbody]` element is replaced with the original email. Stylesheets, mailsubjects and `wh-mailcomposer-*` metatags are also merged into the original email.

## Embedded assets
You can embed assets (eg images) into your email template. You should either
link to relative paths (eg `<img src="../img/header.png">`) or absolute resource
paths (`<img src="mod::mymodule/web/img/header.png">`). Relative paths are
interpreted relative to the witty's location.

## Meta attributes
It's possible to set up some defaults in the email template using `<meta>` tags,
eg the following sets up a 'from' and 'bcc' address for all mails sent using
this template:

```html
  <head>
    <meta name="wh-mailcomposer-from" value="info@example.net" />
    <meta name="wh-mailcomposer-bcc" value="copies@example.net" />
  </head>
```

Any settings specifically made to the mail composer object (eg setting 'mailto')
will override the settings in thet meta tags.

You can also specify data attributes such as `data-maxservertype` on any of the meta
nodes to ensure specific rules apply only on some servers. Eg:

```html
  <meta name="wh-mailcomposer-to" value="support@example.org" />
  <meta name="wh-mailcomposer-to" value="support@beta.webhare.net" data-maxservertype="development"/>
```
Will send mail to support@example.org, except on development servers.

If a meta tag is specified multiple times only the last one takes effect after
server constraints have been considered.

The following meta tags are supported:

### wh-mailcomposer-applytemplate
Apply the specified template. The value is the (relative) path to the template resource.

### wh-mailcomposer-from
Sets the 'from' address. If unset, the default from address for this WebHare
installation is used

### wh-mailcomposer-replyto
Sets the 'replyto' address.

### wh-mailcomposer-to
The 'to' address. Multiple addresses are supported (see %TokenizeEmailAddresses)

### wh-mailcomposer-cc
The 'cc' address. Multiple addresses are supported (see %TokenizeEmailAddresses)

### wh-mailcomposer-bcc
The 'bcc' address. Multiple addresses are supported (see %TokenizeEmailAddresses)

## Tollium preview
Once you've switched to using PrepareMailWitty it's easy to add a debug/test option in your Tollium applications. Although this is not required it will be useful when building and testing mail templates.

To ensure your preview and live versions don't diverge too much, you should wrap your PrepareMailWitty call in a function that's shared by both. For example:

```harescript
STRING echeckbasemailpath := "site::repository/mydata/mailtemplates/echeck/";

PUBLIC OBJECT FUNCTION GetEcheckNotFoundMaill(STRING mail, RECORD options)
{
  options := ValidateOptions([ url := "https://www.example.net/"
                             , programmetitle := "[programmetitle]"
                             ], options);
  OBJECT composer := PrepareMailWitty(`${echeckbasemailpath}formnotfound.html.witty`);
  composer->mailto := [ STRING(mail) ];
  composer->mergerecord := options;
  RETURN composer;
}
```

Then, it's a simple matter of invoking the emailtest dialog in a tollium action:
```harescript
LOADLIB "mod::system/lib/dialogs.whlib";

MACRO DoPreviewNotFound()
{
  RunEmailTestDialog(this, GetEcheckNotFoundMaill("user@example.net", DEFAULT RECORD));
}
```
A dialog will open which will automatically refresh itself if you update the underlying witty files, similar to this:

## Configuring mailtemplates
Forms, WRD Auth, webshops and custom applications can have their emails wrapped
in a (selectable) mailtemplate. These templates are setup using the `<mailtemplate>`
tag in a siteprofile's apply rule, for example:

```xml
  <apply>
    <to type="all" />
    <mailtemplate path="templates/mailtemplate.html.witty" />
  </apply>
```

You can define multiple mailtemplates. The first one found is considerd to be
the default template.

## Other features
- PrepareMailWitty supports the wh-mailcomposer metatags to specify from, to, cc and bcc values, and to apply templates
- Embed RTD documents (EmbedRTD)
- Relative image paths are resolved relative from the emailresource, and embedded in the final mail
- Resource image paths (eg `<img src="mod::mymodule/...">`) are supported and will be embedded
- Emails are [restructured for compatibility](%RestructureEmailForCompatibility) by writing out `<style>` information to `style=` attributes, setting `target="_blank"` to links, reapplying styles to `<a>` tags, etc.
- AddAttachment(Relative), AddAlternative
- Use a component from a witty instead of the entire witty by adding :component to the witty path
