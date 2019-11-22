# Mail confirmation handler

If you want the user to confirm the entered e-mail address before further processing the form results, you can use the mail confirmation handler.

## Allow the handler

You'll have to explicitly enable the mail confirmation handler by allowing it in your site profile. To be able to give appropriate feedback, you'll also have to allow dependencies based on the form's submission type.

```xml
<apply>
  <to type="file" filetype="http://www.webhare.net/xmlns/publisher/formwebtool" />
  <allowformhandler type="http://www.webhare.net/xmlns/publisher/forms#mailconfirmationhandler" />
  <formintegration allowsubmittype="true" />
</apply>
```

## Add the handler

You can now add the 'Confirm email address' form handler to your form. The settings are identical to the 'Email response to visitor' settings, but you cannot add the results to the email. You can however use merge fields to add data from the form to the email message.

Make sure to at least add the actual confirmation link to the email message by adding a 'Confirmation link' component. You can add a link label, or have the raw link inserted for copying to the browser.

## Add feedback text

After the user has opened the confirmation link, only the 'Thank you page' will be shown. By setting `allowsubmittype` to `true`, you can use dependencies to show feedback before and after the user's email address has been confirmed.

Add a visibility dependency for 'Submission type' with value 'New' to show the text if the email address has not yet been confirmed or with value 'Confirm' to show the text after the email address has been confirmed.

## Prevent duplicate submissions

The mail confirmation handler can also be used to check for duplicate submissions by checking if a result with the given email address already exists. This can be activated by checking the 'Check for duplicate email addresses' option in the handler's settings.

You can show a message if a user opens the confirmation link for a second submission with the same email address, by adding a text with a visibility dependency for 'Submission type' with value 'Duplicate email address'.

NOTE: Email addresses are checked against stored results, so they can be used again after the old results have expired, so if the form results aren't stored at all (by setting the retention period to 0 days), email addresses cannot be checked.

NOTE: If a custom form uses %WebToolFormBase::SetIDField for the email field with the `overwriteexisting` option set, submitting the form again with the same email address will overwrite the existing result, so the email address will not be checked.
