# WHFS and History

The history for WHFS objects is primarily linked to the Save and Publish
operations in the document editor.

Each site has a snapshot folder `/webhare-private/system/whfs/snapshots/<siteid>`.
(history for any objects outside a site will be stored as siteid '0'). This is
where we store a copy of the file whenever its saved or published. We store them
as a full copy so `GetInstanceData()` works on its id.

A site's recyclebin lives in `/webhare-private/system/whfs-versions/<siteid>`.

## History events

All history events are stored system.fs_history:
- id: primary key (32 bit - exceeding 2^31 seems unlikely as you would also approach 2^31 related fs_objects for the actual archive)
- when: date&time
- user: refers to system.authobjects
- userdata: Stores the GetUserDataForLogging result
- fs_object: original object
- currentname: fs_object.name when event was made
- currentparent: fs_object.parent when event was made
- version: The version number created by this event

fs_history.fs_object is a non-null cascading reference, so if the original file goes, its history has to go too. For this
reason deleted files have to live in a recycle bin folder and should not be actually deleted until their history needs to
expire.

### Creation
CreateFile and CreateFolder (and related APIs) will add an event for every object outside /webhare-private/ (unless explicitly
requested using the `addtohistory` option).

When a new document is created in the Publisher it receives the following version metadata:
- version: 0.1
- editor: userrecord creating this version

and a 'created' version event is generated.

### Draft/Publish workflow
The document editor implements the draft/publish workflow. The editor manages a subset of the meta- and instance data of a file,
we will refer to this as managed fields. The editor doesn't currently manage fields such as the file title and SEO descriptions -
these are considered the unmanaged fields.

The document editor creates an autosave in the `whconstant_whfsid_autosaves` folder (a full copy linked through `filelink` to
the original source) when you start editing a document to record the current changes. This autosave is then periodically updated.

A public draft is created when a published file has pending content changes - ie the Save button for a published
file creates a draft but does not update the source. You cannot create a public draft for an unpublished document.

When you save a draft the current autosave is moved to the `whconstant_whfsid_drafts` folder. All clonable unmanaged data is
recopied from the source. The draft's minor version number is increased and the editor is set to the user saving
this draft. A version event of type 'saved' is generated and the snapshot is set to the draft id. Any earlier drafts are
moved to the `whconstant_whfsid_whfs_snapshots` folder. (there should only be one draft per source in the drafts folder and
it should only exist as long as there are unpublished changes. the existence of the draft is cached in the 'Draft' published flag)

When you publish a draft its managed fields are copied to the source. The source's major version is updated (and
the minor reset to 0) - eg the last draft might be `0.6` and the first published version will then have version `1.0`.
The existing draft is moved to the `whconstant_whfsid_whfs_snapshots` folder. A version event of type 'publish' is generated
with the snapshot pointing to the same draft (so there may be two version events referring to the same snapshot).

The source's version metadata 'editor' field is updated to reflect the draft's editor, and the publish user and time are set
to the current user. These 'published user/time' will not be updated if the file is later unpublished and republished - they're
supposed to reflect the user that approved the file's content.

Reverting a draft moves it to the snapshots folder and creates a 'revert' event pointing to the snapshot. A revert keeps
its version number and a new draft generated from the source will have an incremented minor version.

## Background information
- We use the `/webhare-private/system/whfs-XXX/<siteid>/` structure with fixed IDs for the whfs- folders so it only takes
  one `parent=xx and filelink=yy` query to find it.

### SQL
```sql
-- List top 10 files with the most history entries
select fs_object,count(*) from system.fs_history group by fs_object order by count(*) desc limit 10;
```
