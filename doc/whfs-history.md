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
file creates a draft but does not update the source. Since WH5.9 you can also create public drafts for an unpublished document
or unpublishable documents.

When you save a draft the current autosave is moved to the `whconstant_whfsid_drafts` folder. All content types that are managed
in the editor are stored with the autosave (with the 'workflow' attribute). (Before WH5.9: all clonable data would copied)

The draft's minor version number is increased and the editor is set to the user saving
this draft. A version event of type 'saved' is generated and the snapshot is set to the draft id. Any earlier drafts are
moved to the `whconstant_whfsid_whfs_snapshots` folder. (there should only be one draft per source in the drafts folder and
it should only exist as long as there are unpublished changes. the existence of the draft is cached in the 'Draft' published flag)

When you publish a draft its managed fields are copied to the source. The source's major version is updated (and
the minor reset to 0) - eg the last draft might be `0.6` and the first published version will then have version `1.0`.
The existing draft is moved to the `whconstant_whfsid_whfs_snapshots` folder. A version event of type 'publish' is generated
with the snapshot pointing to the same draft (so there may be two version events referring to the same snapshot).

Reverting a draft moves it to the snapshots folder and creates a 'revert' event pointing to the snapshot. A revert keeps
its version number and a new draft generated from the source will have an incremented minor version.

### File named and workflow
Principles behind the 'name' field and its effect on the UI/WHFS:
- A newly created RTD suggests its name based on the title (and if empty, a 'new document' like title).
- As long as the user hasn't published the RTD, we want the name/title in WHFS to follow what the RTD is suggesting
- 'New file/folder from template' and 'Duplicate' should act a lot like 'New file/folder' when in doubt. They should not suggest the original's filename but
  re-suggest based on the title

In practice:
- Saving (draft) a publishable but unpublished document will immediately apply its name and title to WHFS
  - This also ensures that a scheduled task publishing an unpublished draft does not need to rename at that moment.
  - We will probably need UI to warn you about scheduling publication for an already published file (especially with a draft open)
- Publishing a document will apply the name and title to WHFS


## Background information
- We use the `/webhare-private/system/whfs-XXX/<siteid>/` structure with fixed IDs for the whfs- folders so it only takes
  one `parent=xx and filelink=yy` query to find it.

### SQL
```sql
-- List top 10 files with the most history entries
select fs_object,count(*) from system.fs_history group by fs_object order by count(*) desc limit 10;
```

## CI tests
- `mod::webhare_testsuite/tests/publisher/tollium/testfilemgr-newobject.whscr` - tests objectprops create/duplicate (but not workflow-based editors)
- `mod::webhare_testsuite/tests/publisher/rtd/test-rtdedit-savepublish.whscr` - tests editdocument save/publish workflow
- `mod::webhare_testsuite/tests/publisher/versions/test-newitem-versions.whscr` - focuses on new documents and automatic name generation based on title
- `mod::webhare_testsuite/tests/system/whfs/test-whfs-history-v4.whscr` - tests workflow APIs at a lower level
