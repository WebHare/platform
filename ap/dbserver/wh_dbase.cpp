#include <ap/libwebhare/allincludes.h>


#include "wh_dbase.h"
#include <iostream>

#include <blex/logfile.h>
#include <blex/path.h>
#include <blex/utils.h>
#include "dbase_backend.h"
#include "dbase_janitor.h"

//#define DISABLE_SECURITY  //Disable ALL security checking

using namespace Database;

template <bool (WebHareTransBack::*function)(Database::BackendTransaction&, Database::Record)>
  bool BindReadAccess(Database::BackendTransaction *trans,Database::TableDef const &,Database::Record rec)
{
#ifdef DISABLE_SECURITY
        return true;
#endif
        WHContext whtrans(trans->transcontextkeeper);
        WebHareTransBack &transb=*whtrans;
        return (transb.*function)(*trans,rec);  //ADDME: Would be nice to have ->* overloaded
}
template <void (WebHareTransBack::*function)(Database::BackendTransaction&, Database::Actions action, Database::Record oldrecord, Database::Record newrecord)>
  void BindWriteAccess(Database::BackendTransaction *trans,Database::TableDef const &,Database::Actions action, Database::Record oldrec, Database::Record newrec)
{
#ifdef DISABLE_SECURITY
        return;
#endif

        WHContext whtrans(trans->transcontextkeeper);
        WebHareTransBack &transb=*whtrans;
        (transb.*function)(*trans,action,oldrec,newrec);
}

template <int32_t (WebHareTransBack::*function)(Database::BackendTransaction&, Database::Record)>
  unsigned BindS32Function(void *store,unsigned maxsize, Database::BackendTransaction *trans,Database::Record rec)
{
        if (maxsize<sizeof(int32_t))
            return 0;
        WHContext whtrans(trans->transcontextkeeper);
        WebHareTransBack &transb=*whtrans;
        Blex::puts32lsb(static_cast<uint8_t*>(store),(transb.*function)(*trans,rec));
        return sizeof(int32_t);
}

template <bool (WebHareTransBack::*function)(Database::BackendTransaction&, Database::Record)>
  unsigned BindBooleanFunction(void *store,unsigned maxsize, Database::BackendTransaction *trans,Database::Record rec)
{
        if (maxsize<1)
            return 0;
        WHContext whtrans(trans->transcontextkeeper);
        WebHareTransBack &transb=*whtrans;
        Blex::putu8(static_cast<uint8_t*>(store),(transb.*function)(*trans,rec));
        return 1;
}

//----------------------------------------------------------------------------
//
// Misc functions
//
//

WebHareTransBack::WebHareTransBack()
{
        ClearFolderSiteCache();
}

/* FIXME and ADDME
   - Prevent creation of unattached folders/files (or should constraints already
     do this) by having their parent==0, and avoid any access checks */
void WebHareTransBack::RegisterAccess(Database::Plugins *plug)
{
        using Database::Plugins;
        Plugins::RAPtr fs_objects_webhare(NULL,
                                          BindWriteAccess<&WebHareTransBack::SYS_FS_ObjectsWriteAccess>,std::string("SYSTEM.FS_OBJECTS"));
        plug->RegisterAccessPlugin("WEBHARE", fs_objects_webhare);

        //Publisher tables
        Plugins::RAPtr sites_webhare(NULL,BindWriteAccess<&WebHareTransBack::PUB_SitesWriteAccess>,std::string("SYSTEM.SITES"));
        plug->RegisterAccessPlugin("WEBHARE",sites_webhare);
}

void WebHareTransBack::RegisterInternalColumns(Database::Plugins*plug)
{
        using Database::Plugins;

        plug->RegisterInternalPlugin("WEBROOT",
                 Plugins::ICPtr(PUB_SiteGetWebRoot,std::string("SYSTEM.SITES")));

        Plugins::ICPtr folder_highestparent(BindS32Function<&WebHareTransBack::SYS_FS_FolderHighestParent>,std::string("SYSTEM.FS_OBJECTS"));
        plug->RegisterInternalPlugin("HIGHESTPARENT",folder_highestparent);


        plug->RegisterInternalPlugin("FULLPATH",
                 Plugins::ICPtr(SYS_FS_GetFullPath,std::string("SYSTEM.FS_OBJECTS")));
        plug->RegisterInternalPlugin("WHFSPATH",
                 Plugins::ICPtr(SYS_FS_GetWHFSPath,std::string("SYSTEM.FS_OBJECTS")));
        plug->RegisterInternalPlugin("URL",
                 Plugins::ICPtr(SYS_FS_GetUrl,std::string("SYSTEM.FS_OBJECTS")));
        plug->RegisterInternalPlugin("INDEXURL",
                 Plugins::ICPtr(SYS_FS_GetIndexUrl,std::string("SYSTEM.FS_OBJECTS")));

        //borland freaks out if I do this without a temp object
        Plugins::ICPtr files_publish (BindBooleanFunction<&WebHareTransBack::SYS_FS_FilePublish>, std::string("SYSTEM.FS_OBJECTS"));
        plug->RegisterInternalPlugin("PUBLISH",files_publish);
        Plugins::ICPtr fsobj_isactive(BindBooleanFunction<&WebHareTransBack::SYS_FS_IsActive>, std::string("SYSTEM.FS_OBJECTS"));
        plug->RegisterInternalPlugin("ISACTIVE",fsobj_isactive);

        Plugins::ICPtr fs_objects_parentinsidesite(BindS32Function<&WebHareTransBack::SYS_FS_Objects_GetParentInsideSite>,std::string("SYSTEM.FS_OBJECTS"));
        plug->RegisterInternalPlugin("PARENT_INSIDE_SITE",fs_objects_parentinsidesite);
}

void WebHareTransBack::RegisterMetaContext(Database::Plugins *plug)
{
        plug->RegisterMetadataContextRegistrator(WHCore::RegisterContext);
        plug->RegisterMetadataContextUpdater(WHCore::FillWHCoreContext);
}

namespace
{
template < class A >
 inline A CheckZero(bool &is_ok, A value)
{
        if (!value)
          is_ok = false;
        return value;
}
} // End of anonymous namespace

void WHCore::FillWHCoreContext(Database::Metadata const &metadata, Blex::ContextKeeper &keeper)
{
        ContextMod context(keeper);
        bool is_ok = true;
        memset(&*context, 0, sizeof(*context));

        Database::ObjectId system_schemaid = metadata.GetRootObject().GetObjectId("SYSTEM");
        Database::ObjectId system_rights_schemaid = metadata.GetRootObject().GetObjectId("SYSTEM_RIGHTS");
        if(!system_schemaid || !system_rights_schemaid)
        {
                context->is_valid=false;
                return;
        }

        Database::ObjectDef const *system_schema = metadata.GetObjectDef(system_schemaid);
        Database::ObjectDef const *system_rights_schema = metadata.GetObjectDef(system_rights_schemaid);

        Database::TableDef const *tabledef;
        tabledef = CheckZero(is_ok, metadata.GetTableDef(system_schema->GetObjectId("WEBSERVERS")));
        if (tabledef)
        {
                context->TWebServers_TableId =          tabledef->object_id;
                context->TWebServers_Id =               CheckZero(is_ok, tabledef->GetColumnId("ID"));
                context->TWebServers_BaseUrl =          CheckZero(is_ok, tabledef->GetColumnId("BASEURL"));
        }

        tabledef = CheckZero(is_ok, metadata.GetTableDef(system_schema->GetObjectId("FS_OBJECTS")));
        if (tabledef)
        {
                context->TFS_Objects_TableId =          tabledef->object_id;
                context->TFS_Objects_Id =               CheckZero(is_ok, tabledef->GetColumnId("ID"));
                context->TFS_Objects_IsFolder =         CheckZero(is_ok, tabledef->GetColumnId("ISFOLDER"));
                context->TFS_Objects_Parent =           CheckZero(is_ok, tabledef->GetColumnId("PARENT"));
                context->TFS_Objects_Name =             CheckZero(is_ok, tabledef->GetColumnId("NAME"));
                context->TFS_Objects_Type =             CheckZero(is_ok, tabledef->GetColumnId("TYPE"));
                context->TFS_Objects_IndexDoc =         CheckZero(is_ok, tabledef->GetColumnId("INDEXDOC"));
                context->TFS_Objects_Published =        CheckZero(is_ok, tabledef->GetColumnId("PUBLISHED"));
                context->TFS_Objects_Data =             CheckZero(is_ok, tabledef->GetColumnId("DATA"));
                context->TFS_Objects_ModificationDate = CheckZero(is_ok, tabledef->GetColumnId("MODIFICATIONDATE"));
                context->TFS_Objects_ExternalLink =     CheckZero(is_ok, tabledef->GetColumnId("EXTERNALLINK"));
                context->TFS_Objects_FileLink =         CheckZero(is_ok, tabledef->GetColumnId("FILELINK"));
        }

        tabledef = CheckZero(is_ok, metadata.GetTableDef(system_schema->GetObjectId("ROLEGRANTS")));
        if (tabledef)
        {
                context->TRoleGrants =                  tabledef->object_id;
                context->TRoleGrants_Grantee =          CheckZero(is_ok, tabledef->GetColumnId("GRANTEE"));
                context->TRoleGrants_Role =             CheckZero(is_ok, tabledef->GetColumnId("ROLE"));
        }

        tabledef = CheckZero(is_ok, metadata.GetTableDef(system_schema->GetObjectId("SITES")));
        if (tabledef)
        {
                context->TSites_TableId =               tabledef->object_id;
                context->TSites_Id =                    CheckZero(is_ok, tabledef->GetColumnId("ID"));
                context->TSites_Name =                  CheckZero(is_ok, tabledef->GetColumnId("NAME"));
                context->TSites_OutputWeb =             CheckZero(is_ok, tabledef->GetColumnId("OUTPUTWEB"));
                context->TSites_OutputFolder =          CheckZero(is_ok, tabledef->GetColumnId("OUTPUTFOLDER"));
        }

        tabledef = CheckZero(is_ok, metadata.GetTableDef(system_rights_schema->GetObjectId("GLOBAL_RIGHTS")));
        if (tabledef)
        {
                context->TGlobalRights =                tabledef->object_id;
                context->TGlobalRights_Grantee =        CheckZero(is_ok, tabledef->GetColumnId("GRANTEE"));
                context->TGlobalRights_Right =          CheckZero(is_ok, tabledef->GetColumnId("RIGHT"));
        }

        tabledef = CheckZero(is_ok, metadata.GetTableDef(system_schema->GetObjectId("FS_TYPES")));
        if (tabledef)
        {
                context->TFSTypes_TableId =             tabledef->object_id;
                context->TFSTypes_Id =                  CheckZero(is_ok, tabledef->GetColumnId("ID"));
                context->TFSTypes_IsPublishedAsSubdir = CheckZero(is_ok, tabledef->GetColumnId("ISPUBLISHEDASSUBDIR"));
        }

        context->is_valid = is_ok;
//        if (!is_ok)
//            throw Database::Exception(Database::ErrorMetadataBad,"Error looking up wh-core table and column names");
}

void WHCore::RegisterContext(Blex::ContextRegistrator &reg)
{
        ContextMod::Register(reg);
}

void WHDBase_SetupDatabasePlugins(Database::Plugins *plugins, Blex::ContextRegistrator *trans_registrator)
{
        WHContext::Register(*trans_registrator);
        WebHareTransBack::RegisterMetaContext(plugins);
        WebHareTransBack::RegisterInternalColumns(plugins);
        WebHareTransBack::RegisterAccess(plugins);
}

//----------------------------------------------------------------------------
//
// PUBLISHER module functions
//
//

void WebHareTransBack::SYS_FS_FileWriteAccess(Database::BackendTransaction &trans, Database::Actions action,Database::Record currentrecord,Database::Record newrecord)
{
        WHCore::Context whcorecontext(GetWHCoreContext(trans));

        if (action==ActionUpdate)
        {
                //if the only modified column is Published, AND it is only a to 'will publish' change, let it through
                Database::ColumnId onlytouch[1] = {whcorecontext->TFS_Objects_Published};
                if (HasOnlyModified(currentrecord,newrecord,1,onlytouch))
                {
                        int32_t oldpublish = currentrecord.GetCell(whcorecontext->TFS_Objects_Published).Integer();
                        int32_t newpublish = newrecord.GetCell(whcorecontext->TFS_Objects_Published).Integer();

                        if (WHCore::GetFlagsFromPublished(oldpublish) == WHCore::GetFlagsFromPublished(newpublish)
                            && WHCore::IsPublishPublished(oldpublish)
                            && WHCore::IsPublishPublished(newpublish)
                            && WHCore::GetStatusFromPublished(newpublish) >= 1
                            && WHCore::GetStatusFromPublished(newpublish) <= 100)
                            return; //it's okay!
                }
        }

        ClearFolderSiteCache(); //After a file update, isactive may have changed
}

///////////////////////////////////////////////////////////////////////////////
//
//  FOLDER check functions
//
bool WebHareTransBack::PUB_FoldersContainsSite(Database::BackendTransaction &trans, Database::Record folderrec)
{
        //An unconnected folder cannot contain a site
        int32_t highestparentid = SYS_FS_FolderHighestParent(trans, folderrec);
        if (highestparentid == 0)
            return 0;

        WHCore::Context whpubcontext(GetWHCoreContext(trans));

        //Get the site record we're using
        Database::Scanner sitescan(trans, ShowNormalSkipAccess, false);
        sitescan.AddTable(whpubcontext->TSites_TableId);
        sitescan.AddIntegerSearch(0, whpubcontext->TSites_Id,highestparentid,Database::SearchEqual);
        sitescan.SetLimit(1);
        if (!sitescan.NextRow())
            return false;

        //Are we on a webserver at all?
        int32_t webserverid = sitescan.GetRowPart(0).GetCell(whpubcontext->TSites_OutputWeb).Integer();
        if (!webserverid)
            return 0;

        //Get our fullpath (which we have to match!)
        char fullpath[MaxColumnSize*2];
        Blex::StringPair ouroutput = sitescan.GetRowPart(0).GetCell(whpubcontext->TSites_OutputFolder).StringPair();

        std::copy(ouroutput.begin,ouroutput.end,fullpath);
        unsigned fullpathsize = ouroutput.size();
        if (fullpathsize != 0 && fullpath[fullpathsize - 1] == '/') //strip final slash!
            --fullpathsize;

        //append folder's fullpath
        fullpathsize += SYS_FS_GetFullPath(&fullpath[fullpathsize], MaxColumnSize, &trans, folderrec);

        Scanner scan(trans, ShowNormal, false);
        scan.AddTable(whpubcontext->TSites_TableId);
        scan.AddIntegerSearch(0, whpubcontext->TSites_OutputWeb, webserverid, Database::SearchEqual);
        scan.AddIntegerSearch(0, whpubcontext->TSites_Id, highestparentid, Database::SearchUnEqual);
        while (scan.NextRow())
        {
                Blex::StringPair siteoutput = scan.GetRowPart(0).GetCell(whpubcontext->TSites_OutputFolder).StringPair();

                /* The site is contained if siteoutput is a subdirectory of fullpath */
                if (siteoutput.size() >= fullpathsize
                    && Blex::StrCaseCompare<const char*>(fullpath,
                                                   fullpath+fullpathsize,
                                                   siteoutput.begin,
                                                   siteoutput.begin+fullpathsize) == 0)
                     return true; //Contains a site!
        }

        return false;
}

void WebHareTransBack::SYS_FS_ObjectsWriteAccess(Database::BackendTransaction &trans, Actions action,Record currentrecord,Record newrecord)
{
        WHCore::Context whcorecontext(GetWHCoreContext(trans));

        int32_t parentid = currentrecord.GetCell(whcorecontext->TFS_Objects_Parent).Integer();
        int32_t newparent = newrecord.GetCell(whcorecontext->TFS_Objects_Parent).Integer();
        bool is_move = action == ActionUpdate && parentid != newparent;

        //check parent acceptibility (ADDME overlaps with some checks in SYS_FS_FolderWriteAccess)
        if(action == ActionInsert || is_move)
        {
                CachedFSObject *folderinfo = LoadFSObject(trans, newparent);
                if (!folderinfo)
                        throw Exception(ErrorWriteAccessDenied,"Not allowed to insert objects into this folder (unable to load folder #" + Blex::AnyToString(newparent) + ")");

                if (folderinfo->type == WHCore::FolderTypes::Foreign)
                        throw Exception(ErrorWriteAccessDenied,"Not allowed to insert objects into this folder (folder #" + Blex::AnyToString(newparent) + " is foreign)");;
        }

        bool is_folder = newrecord.GetCell(whcorecontext->TFS_Objects_IsFolder).Boolean();

        if (is_folder)
            SYS_FS_FolderWriteAccess(trans, action, currentrecord, newrecord);
        else
            SYS_FS_FileWriteAccess(trans, action, currentrecord, newrecord);
}

void WebHareTransBack::PUB_FoldersUnacceptableParent(Database::BackendTransaction &trans, CachedFSObject *folder)
{
        if (folder->type == WHCore::FolderTypes::Foreign)
            throw Exception(ErrorWriteAccessDenied,"Cannot create folders inside foreign folders");

        if (PUB_GetFolderDepth(trans, *folder) >= WHCore::MaxFolderDepth)
            throw Exception(ErrorConstraint,"Folders too deep");
}

void WebHareTransBack::PUB_FoldersUnAcceptable(Database::BackendTransaction &trans, Database::Record rec)
{
        WHCore::Context whcorecontext(GetWHCoreContext(trans));
        int32_t parentid = rec.GetCell(whcorecontext->TFS_Objects_Parent).Integer();

        if (parentid!=0)
        {
                Blex::StringPair namepair = rec.GetCell(whcorecontext->TFS_Objects_Name).StringPair();
                if (!WHCore::ValidName(namepair.begin,namepair.end,false))
                    throw Exception(ErrorConstraint,"Invalid folder name");
        }
}

bool WebHareTransBack::PUB_FolderIsAncestor(Database::BackendTransaction &trans, CachedFSObject const &folder, int32_t findfolder)
{
        //Find the highest parent (the root folder);
        unsigned depth=1;
        CachedFSObject const *curfolder = &folder;

        //Scan upwards
        while(true)
        {
                int32_t parentid=curfolder->parentid;
                if (!parentid)
                    return false;
                if (++depth > WHCore::MaxFolderDepth || parentid == findfolder)
                    return true;

                curfolder = LoadFSObject(trans, parentid);
                if (!curfolder)
                {
                        DEBUGPRINT("PUB_FolderIsAncestor: PUB_GetFolderById failed");
                        return false;
                }
        }
}

void WebHareTransBack::SYS_FS_FolderWriteAccess(Database::BackendTransaction &trans, Actions action,Record currentrecord,Record newrecord)
{
        WHCore::Context whcorecontext(GetWHCoreContext(trans));

        int32_t folderid = currentrecord.GetCell(whcorecontext->TFS_Objects_Id).Integer();
        int32_t parentid = currentrecord.GetCell(whcorecontext->TFS_Objects_Parent).Integer();
        int32_t newparentid = newrecord.GetCell(whcorecontext->TFS_Objects_Parent).Integer();

/*
        //FIXME: Use proper rights on the publisher to prevent removal of these folders or have outputanalyzer fix them up?!
        //Insert 2. new.id < 256 AND NOT IsWebHareAccount
        //Delete 1. old.id < 256 AND NOT IsWebHareAccount
        if (action != ActionUpdate
            && folderid < FolderIdMinimumUser
            && !trans.IsRoleEnabled(Database::MetaRole_SYSTEM))
            throw Exception(ErrorWriteAccessDenied,"Only WebHare may add or remove system folders");
*/

        if (action == ActionDelete)
        {
                //FIXME: ContainsForeignOrSites(old.id)
                if (PUB_FoldersContainsSite(trans, currentrecord))
                    throw Exception(ErrorConstraint,"Cannot delete a folder containing a site");

                ClearFolderSiteCache(); //To prevent problems when re-using the IDs...
                return;
        }

        //Insert,Update 1. UnAcceptable
        PUB_FoldersUnAcceptable(trans, newrecord);

        if (action == ActionInsert)
        {
  /*              if (parentid == 0)
                {
                        //5. NOT RECORDEXISTS(SELECT FROM SITES WHERE ROOT=new.id)
                        Database::Scanner search(trans, ShowNormalSkipAccess, false);
                        search.AddTable(whpubcontext->TSites_TableId);
                        search.AddIntegerSearch(0, whpubcontext->TSites_Root, folderid, Database::SearchEqual);
                        search.SetLimit(1);
                        if (search.CountRows() == 0)
                            throw Exception(ErrorConstraint,"New root folder does not refer to a site");

//                        created_siteroots.push_back(folderid);
                        return; //no more checks necesasry for the parent
                }
    */
                //4. UnacceptableParent(new.parent))
                CachedFSObject *cachedfolder = LoadFSObject(trans, parentid);
                if (!cachedfolder)
                     throw Exception(ErrorConstraint,"New root folder does not exist");
                PUB_FoldersUnacceptableParent(trans, cachedfolder);
                return;
        }

        /* 4. (old.parent = new.parent AND old.name = new.name)
              OR (old.containssite = 0 AND old.type=0) */
        if (!rootfoldersvalid)
            FillSiteCache(trans);

        bool siteroot = rootfolders.count(folderid) != 0;
        if (!siteroot
            && (parentid != newparentid //move?
                || !IsCellEqual(currentrecord.GetCell(whcorecontext->TFS_Objects_Name), newrecord.GetCell(whcorecontext->TFS_Objects_Name), TText))) //rename?
        {
                // FIXME: Contains foreign folders or sites ()
                if (PUB_FoldersContainsSite(trans, currentrecord))
                    throw Exception(ErrorConstraint,"Cannot move or rename a folder containing a site");
        }

        /* 5. old.parent != new.parent
              AND (old.parent = 0
                   OR new.parent = 0
                   OR old.parent.parentsite = new.parent.parentsite
                   OR UnacceptableParent(new.parent)
                   OR IsAncestor(new.parent,old.id)) */
        if (parentid != newparentid)
        {
                CachedFSObject *newparentfolder = LoadFSObject(trans, newparentid);
/*                if (!newparentfolder || parentid == 0)
                    throw Exception(ErrorConstraint,"A site root folder may not be moved");*/

/*                int32_t current_parent_site = PUB_FolderParentSite(currentrecord);
                if (!current_parent_site || PUB_FolderParentSiteCF(newfolder) != current_parent_site)
                    throw Exception(ErrorConstraint,"A folder may not be moved between sites");*/

                PUB_FoldersUnacceptableParent(trans, newparentfolder);
                if (PUB_FolderIsAncestor(trans, *newparentfolder,folderid))
                    throw Exception(ErrorConstraint,"Attempted circulair folder links");
        }

        ClearFolderSiteCache(); //After a folder update, access rules may have changed
}

//*/
///////////////////////////////////////////////////////////////////////////////
//
//  SITES check functions
//
bool WebHareTransBack::IsForeignFolder(Database::BackendTransaction &trans, int32_t folderid, char const *namebegin, char const *nameend)
{
        while (namebegin != nameend && folderid!=0)
        {
                //Find the next slash
                 const char *nextslash=std::find(namebegin,nameend,'/');

                //Did we find an actual directory segment? (this allows 'dir//dir' to work)
                if (namebegin!=nextslash)
                {
                        //Look for the folder [namebegin, nextslash[ inside the current folder
                        std::pair<int32_t,int32_t> folderinfo = PUB_FindFolder_Name(trans, folderid,namebegin,nextslash);
                        if (folderinfo.second == WHCore::FolderTypes::Foreign)
                            return true;
                        folderid=folderinfo.first;
                }

                //Move the search-iterator past the slash
                namebegin=nextslash;
                if (namebegin!=nameend)
                    ++namebegin;
        }

        return false;
}

void WebHareTransBack::PUB_SitesWriteAccess(Database::BackendTransaction &trans, Actions action,Record currentrecord,Record newrecord)
{
        if (action == ActionDelete)
        {
                if (!trans.IsRoleEnabled(Database::MetaRole_SYSTEM))
                    throw Exception(ErrorWriteAccessDenied,"No permission to delete sites");

                ClearFolderSiteCache(); //FIXME: Should also clear on WebServer table update!
                return;
        }

        WHCore::Context whcorecontext(GetWHCoreContext(trans));

        if (action==ActionInsert && !trans.IsRoleEnabled(Database::MetaRole_SYSTEM))
            throw Exception(ErrorWriteAccessDenied,"No permission to insert sites");

        //If the output folder is changed, make sure it follows our constraints
        if (action == ActionInsert
            || !IsCellEqual(currentrecord.GetCell(whcorecontext->TSites_OutputFolder),newrecord.GetCell(whcorecontext->TSites_OutputFolder),Database::TText))
        {
                int32_t webserverid = newrecord.GetCell(whcorecontext->TSites_OutputWeb).Integer();
                if (webserverid != 0) //the site is being published
                {
                        std::string outfolder = newrecord.GetCell(whcorecontext->TSites_OutputFolder).String();

                        //The output folder must start and end with a slash
                        if (outfolder.empty() || outfolder[0]!='/' || outfolder[outfolder.size()-1]!='/')
                            throw Exception(ErrorWriteAccessDenied,"Site output folder must start and end with a slash");

                        //The output folder should NOT be collapsable (that would indicate 'messing around' !)
                        if (outfolder.size()>1)
                        {
                                outfolder.erase(outfolder.end()-1); //don't consider the last slash for collapsing
                                if (outfolder != Blex::CollapsePathString(outfolder))
                                    throw Exception(ErrorConstraint,"Site output folder may not contain redundant parts");
                        }

                }
        }

        //If the output destination(outputweb or outputfolder) is changed, make sure it is contained inside a foreign folder
        if (action == ActionInsert
            || !IsCellEqual(currentrecord.GetCell(whcorecontext->TSites_OutputWeb),newrecord.GetCell(whcorecontext->TSites_OutputWeb),Database::TInteger)
            || !IsCellEqual(currentrecord.GetCell(whcorecontext->TSites_OutputFolder),newrecord.GetCell(whcorecontext->TSites_OutputFolder),Database::TText))
        {
                //We may have to check whether the output folder is properly contained
                int32_t webserverid = newrecord.GetCell(whcorecontext->TSites_OutputWeb).Integer();
                if (webserverid != 0) //the site is being published
                {
                        //Who is sharing this webserver?

                        Blex::StringPair myoutput=newrecord.GetCell(whcorecontext->TSites_OutputFolder).StringPair();

                        Scanner scan(trans, ShowNormalSkipAccess, false);
                        scan.AddTable(whcorecontext->TSites_TableId);
                        //publisher_sites.outputweb = :webserverid
                        scan.AddIntegerSearch(0, whcorecontext->TSites_OutputWeb, webserverid, Database::SearchEqual);
                        //Update only: publisher_sites.id != :siteid
                        if (action==ActionUpdate)
                            scan.AddIntegerSearch(0, whcorecontext->TSites_Id, newrecord.GetCell(whcorecontext->TSites_Id).Integer(), Database::SearchUnEqual);

                        while (scan.NextRow())
                        {
                                //Where is this site publishing to?
                                Blex::StringPair siteoutput = scan.GetRowPart(0).GetCell(whcorecontext->TSites_OutputFolder).StringPair();

                                /* The site is contained if siteoutput is a subdirectory of fullpath */
                                if (myoutput.size() >= siteoutput.size()
                                    && Blex::StrCaseCompare<const char*>(myoutput.begin,
                                                                   myoutput.begin+siteoutput.size(),
                                                                   siteoutput.begin,
                                                                   siteoutput.begin+siteoutput.size()) == 0)
                                {
                                        DEBUGPRINT("New site is contained inside " << scan.GetRowPart(0).GetCell(whcorecontext->TSites_Name).String());
                                        if (myoutput.size() == siteoutput.size()) //exact match!!
                                            throw Exception(ErrorConstraint,"Site shares output folder with site " + scan.GetRowPart(0).GetCell(whcorecontext->TSites_Name).String());

                                        if (!IsForeignFolder(trans, scan.GetRowPart(0).GetCell(whcorecontext->TSites_Id).Integer(),myoutput.begin+siteoutput.size(),myoutput.end))
                                            throw Exception(ErrorConstraint,"Site must be placed on top of a foreign folder in site " + scan.GetRowPart(0).GetCell(whcorecontext->TSites_Name).String());
                                }
                        }
                }
        }

        ClearFolderSiteCache(); //FIXME: Should also clear on WebServer table update!
}
