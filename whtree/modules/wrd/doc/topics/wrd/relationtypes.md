# WRD relation types

WRD supports four basic entity types: objects, attachments, links and domains.
All basic types support adding additional attributes and can have an explicit
lifetime: creationdate (when the object is considered to start existing)
and a limitdate (when the object no longer exists)

By default %WRDType::CreateEntity will set the creationdate to the
current time and limitdate to %MAX_DATETIME but you can override these values
at creation or change them later. An entity is considered to 'exist' if its
creationdate <= the current time and the current time < limitdate.

%WRDType::RunQuery and %WRDType::Search will not show non-existent entities
unless a specific historymode option is set.

An entity whose limitdate is in the past is considered 'closed'. It is not
removed from the database by WRD - applications will generally automatically or
manually eventually delete the closed entities.

## Objects
An object is an entity with an independent existence. It is generally used
to model persons, organizations and tangible 'real world' things.

## Attachments
An attachment models a 'Has A' relationship and is connected to another
entity (which is considered its 'left side entity'). For example, 'requested a
brochure' would often be modelled by an attachment.

An attachment entity type can only connect to a predefined entity type. Eg,
if define an attachment to connect to a Person, it can't connect later to eg. a
Car (unless these types inherit from each other)

If an attachments left side entity is deleted (as opposed to being closed), the
attachment itself is also deleted.

Attachments were previously known as 'classifications'. Some old WRD applications
may still use this term.

### Persons and organizations
`WRD_PERSON` and `WRD_ORGANIZATION` are standard types which are always present in
a WRD schema. `WRD_PERSON` has a lot of standard fields (eg `WRD_GENDER`, `WRD_LASTNAME`)
to properly supply data for generated fields such as `WRD_FULLNAME` and `WRD_SALUTE_FORMAL`.

`WRD_ORGANIZATION` has only one extra standard field (`WRD_ORGNAME`) for the name
of the organization field.

Both person and organization types derive from the `WRD_RELATION` type which
defines a readonly `WRD_TITLE` field and can be used in circumstances in which
you need to refer to either an organization or a person (eg as an account type
for logins). Any fields added to the `WRD_RELATION` type will appear in both
`WRD_PERSON` and `WRD_ORGANIZATION`.

The `WRD_TITLE` defined by `WRD_RELATION` is set to the `WRD_FULLNAME` for persons
and to `WRD_ORGNAME` for organizations. To modify the `WRD_TITLE` of these types
you need to modify either the `WRD_ORGNAME` (for organizations) or the fields
that make up the full name field (`WRD_GENDER`, `WRD_CALLINGNAME`, `WRD_LASTNAME` etc)

## Links
A link is similar to an attachment, but connects two other entities. An 'is
employee of' is an example of a link (with a person on its left side, and an
organization on its right side.)

A link can only connect predefined entity types, but its left and right sides
do not need to be of the same type. If either connected entity is deleted, the
link is deleted too.

## Domains
A domain is similar to an object but usually used for user-managed 'short'
selection lists. Domains implicitly have a 'wrd_title' and 'wrd_ordering' attribute.

Domain values can be organized in a tree structure by using their 'left side entity'
to point to their parent value - but this will cause deletion of a parent value
to also cascade to all its children.

# Selecting relation types

## Array attributes versus attachments
It's not always immediately obvious whether to model something as an array
attribute or an attachment. Array attributes are simpler to manage and to build
Tollium interfaces for but are not as flexible as an attachment.

You should choose an attachment if:
- the elements need to have an independent life time from their parent (creationdate and limitdate)
- you need to be able to refer directly to an element
- you generally don't access the elements together with their parent elements,
  or access all of the attributes or elements at the same time
- you need to be able to directly query for specific elements by their values
- you want to mark one or more attributes as unique.

You should choose an array if:
- the elements need to be ordered
- you often need the complete array when quering the data, not just a few rows or attributes
