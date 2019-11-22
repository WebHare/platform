#include <ap/libwebhare/allincludes.h>


#include "wh_dbase.h"

using namespace Database;

//-----------------------------------------------------------------------------
// Helper functions
//-----------------------------------------------------------------------------
CachedFSObject * WebHareTransBack::GetHighestFolder(Database::BackendTransaction &trans, CachedFSObject *curfolder)
{
        WHContext whtrans(trans.transcontextkeeper);
        if (!whtrans->rootfoldersvalid)
            whtrans->FillSiteCache(trans);

        //Find the highest parent (the root folder);
        unsigned depth=1;
        while (curfolder)
        {
                if (whtrans->rootfolders.count(curfolder->id))
                    return curfolder;

                int32_t parentid = curfolder->parentid;
                if (!parentid || ++depth > WHCore::MaxFolderDepth)
                    return NULL;

                curfolder=LoadFSObject(trans, parentid);
        }
        return NULL;
}

int32_t WebHareTransBack::SYS_FS_FolderHighestParentCF(Database::BackendTransaction &trans, CachedFSObject *curfolder)
{
        CachedFSObject *highestfolder = GetHighestFolder(trans, curfolder);
        return highestfolder ? highestfolder->id : 0;
}

// Get the depth of a folder (root=level 1)
unsigned WebHareTransBack::PUB_GetFolderDepth(Database::BackendTransaction &trans, CachedFSObject const &folder)
{
        //Find the highest parent (the root folder);
        unsigned depth=1;
        CachedFSObject const *curfolder = &folder;

        //Scan upwards
        while(curfolder)
        {
                int32_t parentid = curfolder->parentid;
                if (!parentid || ++depth > WHCore::MaxFolderDepth)
                    return depth;

                curfolder=LoadFSObject(trans, parentid);
        }
        return 0;
}

bool WebHareTransBack::SYS_FS_IsActive(Database::BackendTransaction &trans, Database::Record rec)
{
        CachedFSObject *curfolder = LoadFSObjectDirect(trans, rec);
        while(curfolder)
        {
                if(curfolder->id == 10)
                    return false;
                if(curfolder->parentid == 0)
                    break;
                curfolder = LoadFSObject(trans, curfolder->parentid);
        }
        return true;
}

int32_t WebHareTransBack::SYS_FS_FolderHighestParent(Database::BackendTransaction &trans, Record rec)
{
        CachedFSObject *curfolder = LoadFSObjectDirect(trans, rec);
        if (curfolder)
            return SYS_FS_FolderHighestParentCF(trans, curfolder);
        else
            return 0;
}

std::pair<int32_t,int32_t> WebHareTransBack::PUB_FindFolder_Name(Database::BackendTransaction &trans, int32_t folderid, char const *folderbegin, char const *folderend)
{
        WHCore::Context whcorecontext(GetWHCoreContext(trans));

        Scanner scanner(trans, Database::ShowNormalSkipAccess, false);
        scanner.AddTable(whcorecontext->TFS_Objects_TableId);
        scanner.AddIntegerSearch(0,whcorecontext->TFS_Objects_Parent,folderid,SearchEqual);
        scanner.AddStringSearch(0,whcorecontext->TFS_Objects_Name,folderend-folderbegin,folderbegin,SearchEqual,false);
        scanner.AddBooleanSearch(0,whcorecontext->TFS_Objects_IsFolder,true);

        if (!scanner.NextRow())
            return std::make_pair(0,0);

        return std::make_pair(scanner.GetRowPart(0).GetCell(whcorecontext->TFS_Objects_Id).Integer(),
                              scanner.GetRowPart(0).GetCell(whcorecontext->TFS_Objects_Type).Integer());
}

//ADDME: LoadFSObject and LoadSite are quite similair, merge common code!

CachedFSObject * WebHareTransBack::LoadFSObject(Database::BackendTransaction &trans, int32_t id)
{
        //If we have the folder in cache, just return it!
        FolderCache::iterator itr = foldercache.find(id);
        if (itr != foldercache.end())
            return &itr->second;

        if (id == 0)
        {
                CachedFSObject newfsobject;

                newfsobject.id = id;
                newfsobject.name_start = 0;
                newfsobject.name_len = 0;
                newfsobject.parentid = 0;
                newfsobject.type = (WHCore::FolderTypes::FolderType)0;
                newfsobject.indexdoc = 0;
                newfsobject.isfolder = true;

                //All done, so add the data to the cache
                return &foldercache.insert(std::make_pair(id, newfsobject)).first->second;
        }

        WHCore::Context whcorecontext(GetWHCoreContext(trans));

        //Lookup the folder in question
        Database::Scanner folderscan(trans, Database::ShowNormalSkipAccess, false);
        folderscan.AddTable(whcorecontext->TFS_Objects_TableId);
        folderscan.AddIntegerSearch(0, whcorecontext->TFS_Objects_Id, id, Database::SearchEqual);
        folderscan.SetLimit(1);
        if (!folderscan.NextRow())
            return NULL; //integrity failure

        return InsertFSObjectIntoCache(trans, id, folderscan.GetRowPart(0));
}

CachedFSObject * WebHareTransBack::LoadFSObjectDirect(Database::BackendTransaction &trans, Database::Record rec)
{
        WHCore::Context whcorecontext(GetWHCoreContext(trans));

        int32_t id = rec.GetCell(whcorecontext->TFS_Objects_Id).Integer();
        FolderCache::iterator itr = foldercache.find(id);
        if (itr != foldercache.end())
            return &itr->second;

        return InsertFSObjectIntoCache(trans, id, rec);
}

CachedFSObject* WebHareTransBack::InsertFSObjectIntoCache(Database::BackendTransaction &trans, int32_t id, Database::Record rec)
{
        WHCore::Context whcorecontext(GetWHCoreContext(trans));

        CachedFSObject newfsobject;
        Database::Cell foldername = rec.GetCell(whcorecontext->TFS_Objects_Name);

        newfsobject.id = id;
        newfsobject.name_start = foldersitecachenames.size();
        newfsobject.name_len = foldername.Size();
        newfsobject.parentid = rec.GetCell(whcorecontext->TFS_Objects_Parent).Integer();
        newfsobject.type = (WHCore::FolderTypes::FolderType)rec.GetCell(whcorecontext->TFS_Objects_Type).Integer();
        newfsobject.indexdoc = rec.GetCell(whcorecontext->TFS_Objects_IndexDoc).Integer();
        newfsobject.isfolder = rec.GetCell(whcorecontext->TFS_Objects_IsFolder).Boolean();

        //All done, so add the data to the cache
        foldersitecachenames.insert(foldersitecachenames.end(),foldername.Begin(),foldername.End());
        return &foldercache.insert(std::make_pair(id, newfsobject)).first->second;
}

CachedFSType* WebHareTransBack::LoadType(Database::BackendTransaction &trans, int32_t id)
{
        //If we have the folder in cache, just return it!
        TypeCache::iterator itr = typecache.find(id);
        if (itr != typecache.end())
            return &itr->second;

        WHCore::Context whpubcontext(GetWHCoreContext(trans));

        //Lookup the site in question
        Database::Scanner sitescan(trans, Database::ShowNormalSkipAccess, false);
        sitescan.AddTable(whpubcontext->TFSTypes_TableId);
        sitescan.AddIntegerSearch(0, whpubcontext->TFSTypes_Id, id, Database::SearchEqual);
        sitescan.SetLimit(1);
        if (!sitescan.NextRow())
            return NULL; //integrity failure

        return InsertTypeIntoCache(trans, id, sitescan.GetRowPart(0));
}

CachedSite* WebHareTransBack::LoadSite(Database::BackendTransaction &trans, int32_t id)
{
        //If we have the folder in cache, just return it!
        SiteCache::iterator itr = sitecache.find(id);
        if (itr != sitecache.end())
            return &itr->second;

        WHCore::Context whpubcontext(GetWHCoreContext(trans));

        //Lookup the site in question
        Database::Scanner sitescan(trans, Database::ShowNormalSkipAccess, false);
        sitescan.AddTable(whpubcontext->TSites_TableId);
        sitescan.AddIntegerSearch(0, whpubcontext->TSites_Id, id, Database::SearchEqual);
        sitescan.SetLimit(1);
        if (!sitescan.NextRow())
            return NULL; //integrity failure

        return InsertSiteIntoCache(trans, id, sitescan.GetRowPart(0));
}

CachedSite* WebHareTransBack::LoadSiteDirect(Database::BackendTransaction &trans, Database::Record rec)
{
        WHCore::Context whpubcontext(GetWHCoreContext(trans));

        int32_t id = rec.GetCell(whpubcontext->TSites_Id).Integer();
        SiteCache::iterator itr = sitecache.find(id);
        if (itr != sitecache.end())
            return &itr->second;

        return InsertSiteIntoCache(trans, id, rec);
}

struct CachedSiteWrap
{
        CachedSite site;
        int32_t outputweb;
        std::string outputfolder;
};

void WebHareTransBack::FillSiteCache(Database::BackendTransaction &trans)
{
        WHCore::Context whpubcontext(GetWHCoreContext(trans));
        WHCore::Context whcorecontext(GetWHCoreContext(trans));

        typedef std::multimap< int32_t, CachedSiteWrap > NewSites;
        NewSites newsites;

        //Lookup the site in question
        Database::Scanner sitescan(trans, Database::ShowNormalSkipAccess, false);
        sitescan.AddTable(whpubcontext->TSites_TableId);
        while (sitescan.NextRow())
        {
                Record rec = sitescan.GetRowPart(0);

                int32_t id = rec.GetCell(whpubcontext->TSites_Id).Integer();
                if (!sitecache.count(id))
                {
                        CachedSiteWrap newsite;

                        newsite.site.id = id;
                        newsite.outputweb = rec.GetCell(whcorecontext->TSites_OutputWeb).Integer();
                        newsite.outputfolder = rec.GetCell(whcorecontext->TSites_OutputFolder).String();
                        rootfolders.insert(id);

                        newsites.insert(std::make_pair(newsite.outputweb, newsite));
                }
        }

        Database::Scanner webscan(trans, Database::ShowNormalSkipAccess, false);
        webscan.AddTable(whcorecontext->TWebServers_TableId);
        while (webscan.NextRow())
        {
                int32_t id = webscan.GetRowPart(0).GetCell(whcorecontext->TWebServers_Id).Integer();
                std::pair< NewSites::iterator, NewSites::iterator > range = newsites.equal_range(id);

                for (NewSites::iterator it = range.first; it != range.second; ++it)
                {
                        Blex::StringPair outputfolder(it->second.outputfolder.begin(), it->second.outputfolder.end());

                        AugmentCachedSiteWithWebserver(trans, &it->second.site, outputfolder, webscan.GetRowPart(0));

                        sitecache.insert(std::make_pair(it->second.site.id, it->second.site));
                }
        }

        // Now, all root folders have been found.
        rootfoldersvalid = true;
}

void WebHareTransBack::AugmentCachedSiteWithWebserver(Database::BackendTransaction &trans, CachedSite *newsite, Blex::StringPair outputfolder, Database::Record webserverrec)
{
        WHCore::Context whcorecontext = GetWHCoreContext(trans);

        Cell baseurl = webserverrec.GetCell(whcorecontext->TWebServers_BaseUrl);
        std::vector<char> retval;

        //baseurl should already be properly coded. ourfolder however, needs URL encoding!
        retval.reserve(baseurl.Size() + outputfolder.size() + 5);
        retval.insert(retval.end(), baseurl.Begin(), baseurl.End());

        //strip the last slash, if it's there
        if (retval.size() && retval.back()=='/')
            retval.resize(retval.size()-1);

        //make sure the output folder will start with a slash (it should, so this code is a rare case!)
        if (!outputfolder.size() || *outputfolder.begin!='/')
            retval.push_back('/');

        //append the output folder, urlencoded
        Blex::EncodeUrl(outputfolder.begin,outputfolder.end,std::back_inserter(retval));

        //make sure the return value ends with a slash. size()>0 is guaranteed so no need to check that
        if (retval.back() != '/')
            retval.push_back('/');

        newsite->webroot_start=foldersitecachenames.size();
        newsite->webroot_len=retval.size();
        foldersitecachenames.insert(foldersitecachenames.end(),retval.begin(),retval.end());
}

CachedSite* WebHareTransBack::InsertSiteIntoCache(Database::BackendTransaction &trans, int32_t id, Database::Record rec)
{
        WHCore::Context whcorecontext = GetWHCoreContext(trans);

        CachedSite newsite;

        //Get the site's webserver
        int32_t webserverid = rec.GetCell(whcorecontext->TSites_OutputWeb).Integer();

        if(webserverid)
        {
                Database::Scanner scan(trans, Database::ShowNormalSkipAccess, false);
                scan.AddTable(whcorecontext->TWebServers_TableId);
                scan.AddIntegerSearch(0, whcorecontext->TWebServers_Id, webserverid, Database::SearchEqual);
                scan.SetLimit(1);
                if (scan.NextRow())
                {
                        Cell ourfolder = rec.GetCell(whcorecontext->TSites_OutputFolder);
                        AugmentCachedSiteWithWebserver(trans, &newsite, ourfolder.StringPair(), scan.GetRowPart(0));
                }
        }

        rootfolders.insert(id);

        //All done, so add the data to the cache
        return &sitecache.insert(std::make_pair(id, newsite)).first->second;
}

void WebHareTransBack::ClearFolderSiteCache()
{
        foldercache.clear();
        sitecache.clear();
        typecache.clear();
        foldersitecachenames.clear();
        rootfolders.clear();
        rootfoldersvalid = false;
}

CachedFSType* WebHareTransBack::InsertTypeIntoCache(Database::BackendTransaction &trans, int32_t id, Database::Record rec)
{
        WHCore::Context whcorecontext = GetWHCoreContext(trans);
        CachedFSType newtype;
        newtype.id = rec.GetCell(whcorecontext->TFSTypes_Id).Integer();
        newtype.ispublishedassubdir = rec.GetCell(whcorecontext->TFSTypes_IsPublishedAsSubdir).Boolean();

        //All done, so add the data to the cache
        return &typecache.insert(std::make_pair(id, newtype)).first->second;
}
