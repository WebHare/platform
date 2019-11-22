# FORUM INTEGRATION

Please note: only per-page comments are currently supported.

Before you set up the forum integration, make sure you've completed the [forms integration](topic:forms)

## Prerequisites

We strongly recommend setting up a [captcha](topic:forms/captcha.md) to protect your forum from spam.

Siteprofile changes:
```xml
  <apply>
    <to type="file" />
    <forumplugin type="comments" usecaptcha="1" />
  </apply>
```

Other forumplugin attributes:
- postsperpage: max. nr. of post visible on page
- newestfirst: Change ordering, default newestfirst
- mailpostingsto: Send email of each post to given email address

example:
```xml
  <forumplugin type="comments" postsperpage="100" newestfirst="false" usecaptcha="true" mailpostingsto="example@example.org"/>
```


Add the proper JavaScript libraries:
```javascript
import * as dompack from 'dompack';
import ForumCommentsWebtool from "@mod-publisher/js/webtools/forumcomments";

dompack.register('.wh-forumcomments', node => new ForumCommentsWebtool(node));
```

Add to your design library:
```harescript
LOADLIB "mod::publisher/lib/webtools/forum.whlib";

PUBLIC OBJECTTYPE MyWebdesign ...
< ...
  UPDATE PUBLIC RECORD FUNCTION GetPageconfig()
  {
    OBJECT anyforumplugin := GetForumPluginForWebdesign(this);
    ...
    RETURN [ ...
           , commentsblock := ObjectExists(anyforumplugin)
                                ? PTR anyforumplugin->EmbedComments()
                                : DEFAULT MACRO PTR
           ];
  }
>;
```

And add to your Witty:
```witty
  [contents]
  [commentsblock]
```

Now, setup your recaptcha (or remove all references to it) in Modules > Socialite > Configuration and write somse CSS styling!

## Events
When the comments are loaded into the DOM, a `wh:forum-commentsloaded` event is fired on the `.wh-forumcomments` element
