/* This library should be used for all global settings/tunables in WebHare, so we find relevant constants more easily.
   This library should do no calculation that we can't const-optimize at some point
   All settings should be prefixed with whconstant_
*/

// The basemodule list MUST be in their final dependency ordering. webhare_testsuite is not criticial and not considered a core module
export const whconstant_builtinmodules = ["platform", "system", "wrd", "consilio", "publisher", "tollium", "socialite"];

//An oauth token is valid until ${whconstant_oauthtoken_validuntil} ${whconstant_oauthoken_days} days later
export const whconstant_oauthtoken_validuntil = 5 * 60 * 60 * 1000;
export const whconstant_oauthoken_days = 30;

//Folder/site id of the Repository site
export const whconstant_whfsid_repository = 1;

//Folder/site id of Lost & Found, a Repository site folder
export const whconstant_whfsid_lostandfound = 6;

//Folder id for webhare-private/
export const whconstant_whfsid_private = 10;

//Folder id for webhare-private/system/whfs-versions
export const whconstant_whfsid_versions = 11;

//Folder id for webhare-private/wrd
export const whconstant_whfsid_wrdstore = 13;

//Folder id storing autosaves
export const whconstant_whfsid_autosaves = 14;

//Folder id for webhare-private/system/whfs-drafts
export const whconstant_whfsid_drafts = 15;

//Folder/site id of the WebHare Backend site
export const whconstant_whfsid_webharebackend = 16;

//Folder id for webhare-private/system/
export const whconstant_whfsid_private_system = 19;

//Folder id for webhare-private/system/registerslots
export const whconstant_whfsid_registerslots = 20;

//Folder id for webhare-private/system/rootsettings - used to store properties associated wtih the WebHare Publisher root (id 0)
export const whconstant_whfsid_private_rootsettings = 21;

//Folder id for webhare-tests (created by testframework on first run)
export const whconstant_whfsid_webhare_tests = 22;

//Folder id for webhare-private/system/shorturl
export const whconstant_whfsid_shorturl = 23;

//Folder id for webhare-private/system/whfs
export const whconstant_whfsid_whfs = 24;

//Folder id for webhare-private/system/whfs/snapshots
export const whconstant_whfsid_whfs_snapshots = 25;

//Default key expiry warning (days)
export const whconstant_default_warnexpirydays = 30;

//Default key expiry warning (days) for automatically renewed keys
export const whconstant_autorenewed_warnexpirydays = 21;

//Default index page for webserver. Must be lowercase!
export const whconstant_webserver_indexbasename = "index";

//All possible index pages for webservers. indexbasename + all supported extensions
export const whconstant_webserver_indexpages = [whconstant_webserver_indexbasename + ".html", whconstant_webserver_indexbasename + ".shtml"];

//Webserver type of an interface webserver
export const whconstant_webservertype_interface = 1;

//'Webserver' type of a webserver group
export const whconstant_webservertype_group = 6;

//base port offset for LB trusted port
export const whconstant_webserver_trustedportoffset = 5;

//base port offset for HS trusted port
export const whconstant_webserver_hstrustedportoffset = 3;

/// fs_types.id of whfstype http://www.webhare.net/xmlns/publisher/normafolder
export const whconstant_whfstype_normalfolder = 0;

/// fs_types.id of whfstype http://www.webhare.net/xmlns/publisher/systemfolder
export const whconstant_whfstype_systemfolder = 2;

/// fs_types.id of whfstype http://www.webhare.net/xmlns/publisher/externallink
export const whconstant_whfstype_externallink = 18;

/// fs_types.id of whfstype http://www.webhare.net/xmlns/publisher/internallink
export const whconstant_whfstype_internallink = 19;

/// fs_types.id of whfstype http://www.webhare.net/xmlns/publisher/contentlink
export const whconstant_whfstype_contentlink = 20;

/// fs_types.id of whfstype http://www.webhare.net/xmlns/publisher/shtmlfile
export const whconstant_whfstype_shtmlfile = 25;

/// fs_types.id of whfstype http://www.webhare.net/xmlns/publisher/dynamicfoldercontents
export const whconstant_whfstype_dynamicfoldercontents = 35;

/// fs_history.type recycle action
export const whconstant_historytype_recycled = 0;

/// fs_history.type save action (it's not named "save as draft" as some files might never be actually published (eg widgets, included content)
export const whconstant_historytype_saved = 1;

/// fs_history.type revert action
export const whconstant_historytype_reverted = 3;

/// fs_history.type created action
export const whconstant_historytype_created = 4;

/// fs_history.type approved (update public/publish file) action
export const whconstant_historytype_approved = 5;


/// publisher.schedule start publish/republish event
export const whconstant_publisherschedule_publish = 1;

/// publisher.schedule stop publish event
export const whconstant_publisherschedule_unpublish = 2;

/// publisher.schedule move event
export const whconstant_publisherschedule_move = 3;

/// publisher.schedule deletion event
export const whconstant_publisherschedule_delete = 4;

/// publisher.schedule set indexdoc event
export const whconstant_publisherschedule_setindexdoc = 5;

/// publisher.schedule replace event
export const whconstant_publisherschedule_replace = 6;

//Scriptable types which are reflected to disk so the compiler can see them
export const whconstant_whfstypes_scriptsondisk = [
  7, //semidynamic
  16, //whlib
  25, //shtml
  28 //template
];

//Scriptable types which can be stored in the publisher, and should be sysop-only editable
export const whconstant_whfstypes_scriptable = [
  ...whconstant_whfstypes_scriptsondisk,
  27, //siteprl - we'll keep this here just to be safe
  38 //shtml with design file
];

//types which we do not accept as a file/folder template. if unsure, block until use case
export const whconstant_whfstypes_invalidtemplate = [
  ...whconstant_whfstypes_scriptable, //all scriptables are too dangerous
  1, //external folder (does not make sense to duplicate)
  2, //system folder (does not make sense to duplicate, it would be invisible after duplication)
  18, 19, 20, //int, ext, contentlinks (unsure)
  24, //contentlisting
  26, //witty (unsure)
  29, //conversion profile (deprecated)
  34, //webfields file (deprecated)
  35 //dynamic folder contents (does not make sense to duplicate)
];

//ip address reported by the consilio fetcher
export const whconstant_consilio_fetcher_trusted_ip = "100::cccc:ffff";

//base port offset for opensearch
export const whconstant_consilio_osportoffset = 6;

//name of the publisher whfs catalog
export const whconstant_consilio_catalog_whfs = "consilio:whfs";

//name for site (frontend) content sources
export const whconstant_consilio_contentprovider_site = "consilio:site";

//our 2 index types
export const whconstant_consilio_catalogtype_managed = 0;
export const whconstant_consilio_catalogtype_unmanaged = 1;

//separates modulename from indexname
export const whconstant_consilio_module_sep = "__";

//timeout after which we don't trust sendapplicationmessage tokens for direct editor app
export const whconstant_trust_sendapplicationmessage = 5 * 60 * 1000;

//Publisher truncation point for autogenerated names
export const whconstant_publisher_autonamelength = 64;

//Fallback icons
export const whconstant_publisher_foldericonfallback = "tollium:folders/normal";
export const whconstant_publisher_fileiconfallback = "tollium:files/application_x-webhare-general";

//valid settings for RTD margins
export const whconstant_tollium_rtd_margins = ["none", "compact", "wide"];

//name of the wrd testschema
export const whconstant_wrd_testschema = "wrd:testschema";

//valid editdefaults= values
export const whconstant_forms_valideditdefaults = [
  "name", "title", "hidetitle", "required", "noenabled", "novisible",
  "groupclasses", "label", "placeholder", "prefix", "suffix", "infotext"
];

//valid editdefaults= values for handlers
export const whconstant_forms_validhandlereditdefaults = ["condition"];

/* valid user-supplied debug tokens
   - apr is currently enabled for practical reasons but ideally we'd have users explicitly activate profiling through Debug or through an invite
   - nsc needs to be here to allow skipping captchas. we're still doing a dtapstage check at use
*/
export const whconstant_whdebug_publicflags = ["apr", "nsc"];

//default compatibility
export const whconstant_default_compatibility = "es2022,safari16.2";

//standard failed task reschedule time
export const whconstant_default_failreschedule = 15 * 60 * 1000;

// these schemanames are part of webhare's or the database's implementation and don't need explicit dbschemas
export const whconstant_builtin_schemas = ["system_rights", "information_schema", "pg_catalog", "pg_toast", "webhare_internal"];

//common namespaces
export const whconstant_xmlns_moduledef = "http://www.webhare.net/xmlns/system/moduledefinition";
export const whconstant_xmlns_publisher = "http://www.webhare.net/xmlns/publisher/siteprofile";
export const whconstant_xmlns_systemcommon = "http://www.webhare.net/xmlns/system/common";
export const whconstant_xmlns_tolliumappinfo = "http://www.webhare.net/xmlns/tollium/appinfo";
export const whconstant_xmlns_tolliumcommon = "http://www.webhare.net/xmlns/tollium/common";
export const whconstant_xmlns_screens = "http://www.webhare.net/xmlns/tollium/screens";

// Autoloaded libraries
export const whconstant_harescript_autoloaded_libraries = [
  "wh::system.whlib",
  "wh::internal/hsservices.whlib",
  "mod::system/lib/internal/harescript/preload.whlib"
];

// Version tag for the tika cache entries
export const whconstants_consilio_tikacache_versiontag = "2";

// Extension list (compatible with GetExtensionFromPath) for code that requires ts-node to run, not runscript
export const whconstant_typescript_extensions = [".ts", ".tsx"];

// Extension list (compatible with GetExtensionFromPath) for code that needs ts-node or node to run, not runscript
export const whconstant_javascript_extensions = [...whconstant_typescript_extensions, ".js", ".es"];

export const whconstant_consilio_default_suffix_mask = "-*";

//confighelpers.whlib
//an interface server generally running on http://127.0.0.1:13678/
export const whwebserverconfig_rescueportoffset = 0;
export const whwebserverconfig_trustedportid = -2;
export const whwebserverconfig_trustedportid_ipv6 = -3;
export const whwebserverconfig_hstrustedportid = -6;
export const whwebserverconfig_rescueportid = -4;
export const whwebserverconfig_rescuewebserverid = -5;

export const whwebserverconfig_virtualportid = 0;

export const whwebserverconfig_proxywebserverid = -1000; //catches any usage of webhare as a proxy

export const whwebserverconfig_redirecthostoffset = -2000; //all redirecting hosts that mirror a real webserver, are offset by this index

export const whconstant_defaultwidgetgroup = "http://www.webhare.net/xmlns/publisher/generalwidgets";
