# Polls

## Setup
- have a folder /library/polls in the site where users can create the poll files
- allow users to create poll widgets as widget file or provide your own poll widget which renders the pollfile

# Usage
- through a Publisher pollwidget (which renders using pollobj->Render())
- through a custom pollwidget (also using pollobj->Render()),
  but you can add your own wrappers.

To make the default poll widget (or usage of the default polls template) work,
import the polls API:

## In your JS/ES code:
```javascript
import PollWebtool from "@mod-publisher/js/webtools/poll";
dompack.register('.wh-poll', node => new PollWebtool(node));
```

## In your CSS/SCSS:
```scss
@import "~@webhare-publisher/webtools/pollstyles";

@at-root
{
  @include wh-poll-flex;
  @include wh-poll-results-percentage;
}
```

Allowing the user to make polls:

```xml
  <!-- Bibliotheek / peilingen -->
  <apply>
    <to type="all" pathmask="/bibliotheek/peilingen/*" />
    <denyfiletype typedef="*" />
    <denyfoldertype typedef="*" />
    <allowfoldertype typedef="http://www.webhare.net/xmlns/publisher/normalfolder" />
    <allowfiletype typedef="http://www.webhare.net/xmlns/publisher/pollwebtool" />
  </apply>
```

Allowing the user to make poll widget files:

```xml
  <apply>
    <to type="all" parenttype="http://www.weekvanhetgeld.nl/siteprl/widgetsfolder"/>

    <!-- DEFAULT POLL WIDGET -->
    <allowfiletype typedef="http://www.webhare.net/xmlns/publisher/pollwidget"/>

    <!-- CUSTOM POLL WIDGET -->
    <allowfiletype typedef="http://www.weekvanhetgeld.nl/widget/poll"/>
  </apply>
```


## Poll settings

Some settings are only available for developers.
These can be set through a siteprofile.
Usually you want to settings to be applies globally, so all polls on your site use these settings:
(although you could target paths such as /library/polls or target specific polls)

```xml
  <apply>
    <to type="all"/>

    <!-- allow voting after a day (1440 minutes) -->
    <pollsettings allowvotingagainafter="2880"></pollsettings>
  </apply>
```

# Styling

## Classes used for layout/content

- wh-poll

## Classes used for state

- wh-poll--voted
- wh-poll--justvoted
- wh-poll--submitting (waiting for response from the server)
- wh-poll--showresults

# Creating a custom poll widget

Use cases
- you want your own widget wrapper (and don't want to add your widget class or wrapper using Javascript)
- you want to add behavious (options such as 'hide on mobile' or themecolor)

- Rendering:
  - Option A) Have the widget instance the poll object and let it render itself

```harescript
PUBLIC OBJECTTYPE PollWidget EXTEND WidgetBase
<
  UPDATE PUBLIC MACRO Render()
  {
    OBJECT pollobj := OpenPoll(this->data.poll);
    IF(NOT ObjectExists(pollobj))
      RETURN;

    this->EmbedComponent([ poll := PTR pollobj->Render(this) ]);
  }
>;
```

  - Option B) Have the widget instance the poll object, request the witty data and use your own template

```harescript
PUBLIC OBJECTTYPE PollWidget EXTEND WidgetBase
<
  UPDATE PUBLIC MACRO Render()
  {
    OBJECT pollobj := OpenPoll(this->data.poll);
    IF(NOT ObjectExists(pollobj))
      RETURN;

    RECORD wittyfields := pollobj->GetWittyFields(context);
    INSERT CELL debugdata := PTR DumpValue(wittyfields, "htmltree") INTO wittyfields;
    this->EmbedComponent(wittyfields);
  }
>;
```

## Caveats
- not supported for direct embedding into RTD's yet, because we don't have an file id there to prevent a copy of the poll
(due to duplicating the whole document or specific widget) sharing the same options as the original
- options in the database can become orphaned. This may happend when:
  - extracting of an archive resulting in overwriting the poll file
  - using a custom poll editor which doesn't enforce the 'not allowed to delete an option which has votes' rule
