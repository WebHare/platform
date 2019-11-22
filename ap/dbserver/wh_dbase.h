#ifndef blex_webhare_dbase_webhare_wh_dbase
#define blex_webhare_dbase_webhare_wh_dbase

class MainDatabase;
class HareTemplateOutput;
class WebHareTransBack;
class Logfile;

#include <blex/threads.h>
#include <ap/libwebhare/whcore.h>
#include <ap/dbserver/dbase_transaction.h>
#include <ap/dbserver/dbase_backend.h>
#include <ap/dbserver/dbase_rpcserver.h>

namespace WHCore
{

struct ContextData
{
        bool is_valid;

        Database::TableId  TWebServers_TableId;
        Database::ColumnId TWebServers_Id;
        Database::ColumnId TWebServers_BaseUrl;

        Database::TableId  TFS_Objects_TableId;
        Database::ColumnId TFS_Objects_Id;
        Database::ColumnId TFS_Objects_IsFolder;
        Database::ColumnId TFS_Objects_Parent;
        Database::ColumnId TFS_Objects_Name;
        Database::ColumnId TFS_Objects_Type;
        Database::ColumnId TFS_Objects_IndexDoc;
        Database::ColumnId TFS_Objects_Published;
        Database::ColumnId TFS_Objects_Data;
        Database::ColumnId TFS_Objects_ModificationDate;
        Database::ColumnId TFS_Objects_ExternalLink;
        Database::ColumnId TFS_Objects_FileLink;

        Database::TableId  TRoleGrants;
        Database::ColumnId TRoleGrants_Grantee;
        Database::ColumnId TRoleGrants_Role;

        Database::TableId  TGlobalRights;
        Database::ColumnId TGlobalRights_Grantee;
        Database::ColumnId TGlobalRights_Right;
        Database::ColumnId TGlobalRights_Object;

        Database::TableId  TSites_TableId;
        Database::ColumnId TSites_Id;
        Database::ColumnId TSites_Name;
        Database::ColumnId TSites_OutputWeb;
        Database::ColumnId TSites_OutputFolder;

        Database::TableId  TFSTypes_TableId;
        Database::ColumnId TFSTypes_Id;
        Database::ColumnId TFSTypes_IsPublishedAsSubdir;
};

static const unsigned ContextId = 768;

typedef Blex::Context< ContextData, ContextId,void > ContextMod;
typedef ContextMod::ConstContext Context;

void FillWHCoreContext(Database::Metadata const &metadata, Blex::ContextKeeper &keeper);
void RegisterContext(Blex::ContextRegistrator &reg);

} // End of namespace WHCore

struct CachedFSObject
{
        CachedFSObject()
        {
                highestparent=0;
        }

        int32_t id;
        unsigned name_start;
        unsigned name_len;
        int32_t parentid;
        ///Parent site (0 if not yet cached/not highest folder)
        int32_t highestparent;
        ///Folder index document
        int32_t indexdoc;
        bool isfolder;
        WHCore::FolderTypes::FolderType type;
};

struct CachedFSType
{
        CachedFSType()
        {
                id=0;
                ispublishedassubdir=false;
        }

        int32_t id;
        bool ispublishedassubdir;

};

struct CachedSite
{
        CachedSite()
        {
                webroot_len=0;
        }

        int32_t id;
        unsigned webroot_start;
        unsigned webroot_len;
};

inline WHCore::Context GetWHCoreContext(Database::BackendTransaction &trans) { return WHCore::Context(trans.GetMetadata().keeper); }

class WebHareTransBack
{
    public:
        WebHareTransBack();

        static void RegisterInternalColumns(Database::Plugins *plug);
        static void RegisterAccess(Database::Plugins *plug);
        static void RegisterMetaContext(Database::Plugins *plug);

        std::pair<int32_t,int32_t> PUB_FindFolder_Name    (Database::BackendTransaction &trans, int32_t folderid, char const *filebegin, char const *fileend);

    private:
        void SYS_FS_ObjectsWriteAccess  (Database::BackendTransaction &trans, Database::Actions action, Database::Record oldrecord, Database::Record newrecord);

        //----------------- PUBLISHER MODULE ----------------------------------
        /** Get the current user's access level to a folder */
        bool IsForeignFolder(Database::BackendTransaction &trans, int32_t root_folderid, char const *namebegin, char const *nameend);

        void PUB_FoldersUnacceptableParent(Database::BackendTransaction &trans, CachedFSObject *folder);
        void PUB_FoldersUnAcceptable(Database::BackendTransaction &trans, Database::Record rec);
        bool PUB_FolderIsAncestor(Database::BackendTransaction &trans, CachedFSObject const &folder, int32_t findfolder);

        /** Get the depth of a folder (root=level1) */
        unsigned PUB_GetFolderDepth(Database::BackendTransaction &trans, CachedFSObject const &folder);

       /** Retrieve a folder's highest parent (the root folder) */
        int32_t SYS_FS_FolderHighestParent(Database::BackendTransaction &trans, Database::Record folderrec);
        /** Retrieve a folder's highest parent (the root folder) using cached folders*/
        int32_t SYS_FS_FolderHighestParentCF(Database::BackendTransaction &trans, CachedFSObject *CachedFSObject);
        /** Figure out if a file will be published */
        bool SYS_FS_FilePublish(Database::BackendTransaction &trans, Database::Record folderrec);
        bool SYS_FS_IsActive   (Database::BackendTransaction &trans, Database::Record folderrec);
        /** Retrieve the parent of a folder, or 0 if the folder is a siteroot*/
        int32_t SYS_FS_Objects_GetParentInsideSite(Database::BackendTransaction &trans, Database::Record rec);
        /** Retrieve the parent of a folder, or 0 if the folder is a siteroot, using cached folders*/
        int32_t SYS_FS_Objects_GetParentInsideSiteCF(Database::BackendTransaction &trans, CachedFSObject const *fsobject);

        /** Does a folder contain a site? */
        bool PUB_FoldersContainsSite(Database::BackendTransaction &trans, Database::Record folderrec);

        void FolderGetUrl(Database::BackendTransaction &trans, CachedFSObject *folder);

        static unsigned PUB_SiteGetWebRoot            (void *store,unsigned maxsize, Database::BackendTransaction *trans,Database::Record rec);

        static unsigned SYS_FS_GetFullPath            (void *store,unsigned maxsize, Database::BackendTransaction *trans,Database::Record rec);
        static unsigned SYS_FS_GetWHFSPath            (void *store,unsigned maxsize, Database::BackendTransaction *trans,Database::Record rec);
        static unsigned SYS_FS_GetUrl                 (void *store,unsigned maxsize, Database::BackendTransaction *trans,Database::Record rec);
        static unsigned SYS_FS_GetIndexUrl            (void *store,unsigned maxsize, Database::BackendTransaction *trans,Database::Record rec);

        void SYS_FS_FileWriteAccess       (Database::BackendTransaction &trans, Database::Actions action, Database::Record oldrecord, Database::Record newrecord);
        void SYS_FS_FolderWriteAccess     (Database::BackendTransaction &trans, Database::Actions action, Database::Record oldrecord, Database::Record newrecord);

        void PUB_SitesWriteAccess        (Database::BackendTransaction &trans, Database::Actions action, Database::Record oldrecord, Database::Record newrecord);

        CachedFSObject * GetHighestFolder(Database::BackendTransaction &trans, CachedFSObject *curfolder);

        typedef std::map<int32_t, CachedFSObject> FolderCache;
        typedef std::map<int32_t, CachedFSType> TypeCache;
        typedef std::map<int32_t, CachedSite> SiteCache;

        CachedFSObject* InsertFSObjectIntoCache(Database::BackendTransaction &trans, int32_t id, Database::Record rec);
        CachedFSType* InsertTypeIntoCache(Database::BackendTransaction &trans, int32_t id, Database::Record rec);
        CachedSite* InsertSiteIntoCache(Database::BackendTransaction &trans, int32_t id, Database::Record rec);

        void AugmentCachedSiteWithWebserver(Database::BackendTransaction &trans, CachedSite *cachedsite, Blex::StringPair outputfolder, Database::Record webserverrec);

        unsigned SYS_GetFullPath(Database::BackendTransaction &trans, void *store,unsigned maxsize, CachedFSObject const *curfolder, bool whfspath);
        unsigned SYS_GetWHFSPath(Database::BackendTransaction &trans, void *store,unsigned maxsize, CachedFSObject const *curfolder, bool whfspath);

        /** Load a folder into the cache
            @param id Id of the folder to load
            @return Data about the loaded folder */
        CachedFSObject * LoadFSObject(Database::BackendTransaction &trans, int32_t id);
        CachedFSType* LoadType(Database::BackendTransaction &trans, int32_t id);
        CachedSite* LoadSite(Database::BackendTransaction &trans, int32_t id);

        /** Load a folder we already have a lock on into the cache
            @param id Id of the folder to load
            @param rec Folder record with the data to load
            @return Data about the loaded folder */
        CachedFSObject *LoadFSObjectDirect(Database::BackendTransaction &trans, Database::Record rec);
        CachedFSType* LoadTypeDirect(Database::BackendTransaction &trans, Database::Record rec);
        CachedSite *LoadSiteDirect(Database::BackendTransaction &trans, Database::Record rec);

        uint8_t const * GetFolderSiteName(unsigned name_start) { return &foldersitecachenames[name_start]; }

        void ClearFolderSiteCache();

        void FillSiteCache(Database::BackendTransaction &trans);

        FolderCache foldercache;
        TypeCache typecache;
        SiteCache sitecache;
        std::vector <uint8_t> foldersitecachenames;
        std::set< int32_t > rootfolders;
        bool rootfoldersvalid; ///< Indicates whether rootfolders contains ALL root folders.

        std::vector<uint8_t> scratchpad;
};

static const unsigned WHTransContextId = 760;

typedef Blex::Context<WebHareTransBack, WHTransContextId, void> WHContext;

#endif /*sentry*/
