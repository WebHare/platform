#ifndef blex_webhare_shared_whcore_hs
#define blex_webhare_shared_whcore_hs

#include <harescript/vm/hsvm_context.h>
#include <harescript/vm/hsvm_processmgr.h>
#include <ap/libwebhare/wh_filesystem.h>
#include <blex/zstream.h>
#include "whcore.h"

namespace WHCore
{

class ScriptEnvironment;
class AdhocCache;

/** ID of the WebHare script context during conversions */
const unsigned ScriptContextId = 256;
const unsigned ScriptGroupContextId = 546;

class AdhocCache : public Blex::NotificationEventReceiver
{
        typedef Blex::DateTime ExpireDate;
        typedef std::string HashTag;
        typedef std::string EventMask;
        typedef std::string LibraryURI;
        typedef std::pair< LibraryURI, HashTag > CacheKey;

        struct CacheEntry;
        struct Library;
        struct CacheData;

        typedef std::map< HashTag, CacheEntry > LibraryEntries;
        typedef std::map< LibraryURI, Library > Libraries;
        typedef std::set< std::pair< ExpireDate, CacheKey > > Expiries;
        typedef std::map< EventMask, std::set< CacheKey > > EventMaskInvalidations;
        typedef std::vector< EventMask > EventMasks;

        struct CacheEntry
        {
                // Contents are exported out of the lock for copying, so MUST be readonly
                std::shared_ptr< HareScript::MarshalPacket const > data;
                ExpireDate expires;
                uint32_t hits;
                EventMasks eventmasks;
        };

        struct Library
        {
                /// Map of CacheKey -> CacheEntry
                LibraryEntries entries;
        };

        struct CacheData
        {
                /// Map of library uri -> library record
                Libraries libraries;

                /// Set of expire dates and keys
                Expiries expiries;

                /// Map of event mask -> list of keys of entries
                EventMaskInvalidations eventmasks;

                uint32_t requests;
                uint32_t hits;

                uint32_t max_entries;
                uint32_t min_entries_per_library;
        };

        typedef Blex::InterlockedData< CacheData, Blex::Mutex > LockedCacheData;
        LockedCacheData lockedcachedata;

        void CullEntries(LockedCacheData::WriteRef &lock);

        /** Remove an entry, make sure that the library & hash are not a reference to a library, entry or expiry entries,
            those will be removed within this function
        */
        bool RemoveEntry(LockedCacheData::WriteRef &lock, LibraryURI const &library, HashTag const &hash);
        void ReceiveNotificationEvent(std::string const &event, uint8_t const */*hsvmdata*/, unsigned /*hsvmdatalen*/);

    public:
        AdhocCache(Connection &conn);
        ~AdhocCache();

        bool GetEntry(HareScript::VirtualMachine *vm, HSVM_VariableId cachetag, LibraryURI const &library, Blex::DateTime const &librarymodtime, HSVM_VariableId result, HashTag *store_hash);
        void SetEntry(HareScript::VirtualMachine *vm, HSVM_VariableId cachetag, LibraryURI const &library, Blex::DateTime const &librarymodtime, HSVM_VariableId date, Blex::DateTime expiry, std::vector< std::string > const &eventmasks);
        void GetStats(HareScript::VirtualMachine *vm, HSVM_VariableId id_set);
        void InvalidateAll();
        void TwistKnobs(int32_t max_entries, int32_t min_entries_per_library);
};

/** SHTML webserver callbacks */
class BLEXLIB_PUBLIC SHTMLWebserverCallbacks
{
        public:
        virtual ~SHTMLWebserverCallbacks()=0;

        virtual void ConfigureWebServer(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void LogWebserverError(HSVM *hsvm)=0;
        virtual void SessionList(HSVM *hsvm, HSVM_VariableId id_set)=0;

        virtual void GetHTTPEventListenerCounts(HSVM *vm, HSVM_VariableId id_set)=0;
        virtual void ClearHTTPEventMessages(HSVM *vm)=0;
        virtual void FlushCache(HSVM *vm)=0;
};

/** SHTML per connection callbacks */
class BLEXLIB_PUBLIC SHTMLCallbacks
{
        public:
        virtual ~SHTMLCallbacks()=0;

        virtual void GetRequestBody(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void Header(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void Variable(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void AllVariables(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void AllHeaders(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void Sendfile(HSVM *hsvm)=0;
        virtual void AddHeader(HSVM *hsvm)=0;
        virtual void RequestUrl(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void ClientRequestUrl(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void RequestMethod(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void ClientLocalWebserver(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void ClientLocalBinding(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void ClientLocalIp(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void ClientRemoteIp(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void ClientLocalPort(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void ClientRemotePort(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void ClientLocalAddress(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void SessionList(HSVM *hsvm, HSVM_VariableId id_set)=0;

        virtual void AuthenticateWebSession(HSVM *hsvm)=0;
        virtual void AuthenticateWebhareUser(HSVM *hsvm)=0;
        virtual void AcceptBasicAuthCredentials(HSVM *hsvm)=0;
        virtual void CloseWebSession(HSVM *hsvm)=0;
        virtual void CreateWebSession(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void UpdateWebSession(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void FlushWebResponse(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void ResetWebResponse(HSVM *hsvm)=0;
        virtual void GetAuthenticatingSessionId(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void GetClientUsername(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void GetErrorInfo(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void GetWebSessionData(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void GetWebSessionUser(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void GetWebSessionType(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void StoreWebSessionData(HSVM *hsvm)=0;
        virtual void RevokeWebSessionAuthentication(HSVM *hsvm)=0;
        virtual void LogWebserverError(HSVM *hsvm)=0;

        virtual void GetWebhareAccessRuleId(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void GetWebhareAccessRules(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void GetAuthenticatedWebhareUser(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void GetAuthenticatedWebhareUserEntityId(HSVM *hsvm, HSVM_VariableId id_set)=0;

       virtual void DetachScriptFromRequest(HSVM *hsvm)=0;
        virtual void GetSRHErrors(HSVM *hsvm, HSVM_VariableId id_set)=0;
        virtual void SetupWebsocketInput(HSVM *vm, HSVM_VariableId id_set)=0;
};

/** The actual context object for WebHare harescript files */
class BLEXLIB_PUBLIC ScriptContextData
{
    public:
        ScriptContextData(ScriptEnvironment *env);
        ~ScriptContextData();

        /** Get the WebHare connection structures */
        Connection const& GetWebHare() const { return webhare; }

        void UpdateAuthenticationRecord(HSVM *vm);

        std::string adhoclibrary;
        Blex::DateTime adhoclibrarymodtime;

        WHFileSystem::RecompileResult RecompileLibary(HareScript::ErrorHandler &handler, std::string const &uri, bool force);
        std::string GetLibaryPath(std::string const &uri);

        AdhocCache & GetAdhocCache();

        bool ConfigureRemoteLogs(std::vector< LogConfig > const &config, std::vector< bool > *result)
        {
                return webhare.ConfigureRemoteLogs(config, result);
        }

        void RemoteLog(std::string const &logname, std::string const &logline)
        {
                webhare.RemoteLog(logname, logline);
        }

        bool FlushRemoteLog(std::string const &logname)
        {
                return webhare.FlushRemoteLog(logname);
        }

        void GetSystemConfig(std::shared_ptr< Blex::PodVector< uint8_t > const > *data)
        {
                webhare.GetSystemConfig(data);
        }

        void SetSystemConfig(uint8_t const *data, unsigned datalen)
        {
                webhare.SetSystemConfig(data, datalen);
        }

    private:
        ///Location of our webhare connection
        Connection &webhare;

        friend class ScriptEnvironment;
        ScriptEnvironment &env; //<parent environment
};

class ScriptGroupContextData
{
        public:
        ScriptGroupContextData();
        ~ScriptGroupContextData();

        /// Where to direct SHTML calls, if anywhere
        std::unique_ptr<SHTMLCallbacks> shtml;
};

/** Create an environment suitable for running WebHare harescripts */
class BLEXLIB_PUBLIC ScriptEnvironment
{
        public:
        /** Construct a parent WebHare HareScript environment
            @param whconn Associated WebHare connection
            @param environmentname Name of the compilation environment (used to detect library mixups)
            @param priorityclass Priority class for our compilations*/
        ScriptEnvironment(Connection &whconn, CompilationPriority::Class priorityclass, bool allow_direct_compilations, bool allow_std_sharing);
        ~ScriptEnvironment();

        /** Create a group */
        HareScript::VMGroup *CreateVMGroup(bool highpriority);

        HSVM* ConstructWHVM(HareScript::VMGroup *group);

        HareScript::Environment & GetEnvironment() { return environment; }

        // Returns the filesystem, necessary to invoke remote compilation actions.
        inline WHFileSystem & GetFileSystem() { return filesystem; }

        AdhocCache & GetAdhocCache() { return adhoccache; }

        private:

        Connection &whconn;

        ///Context registrator for the file loading/compilation process
        WHFileSystem filesystem;
        HareScript::GlobalBlobManager blobmgr;
        HareScript::Environment environment;
        AdhocCache adhoccache;

        void Init();

        void OnNewVM(HSVM *vm);

        friend class ScriptContextData; //FIXME: ugly, remove this friend
};

/** Class that handles the integration of the jobmgr with the global IPC link
    and the events mechanisms, for destruction ordering purposes
*/
class JobManagerIntegrator
{
    private:
        ManagerConnection::AutoJobMgrRegistrar mcregistrar;

    public:
        JobManagerIntegrator(ScriptEnvironment &env, Connection &conn, HareScript::JobManager *jobmgr);
        ~JobManagerIntegrator();
};


/** Register our functions to the environment */
int WHCore_ModuleEntryPoint(HSVM_RegData *regdata, void *context_ptr);

Database::TransFrontend* GetTransFromTableId(HareScript::VirtualMachine *vm, int32_t vm_tableid);

void BLEXLIB_PUBLIC LogHarescriptError(Connection &conn, std::string const &source, std::string const &groupid, std::string const &externalsessiondata, HareScript::ErrorHandler const &errorhandler, std::map< std::string, std::string > const &params);

} //end namespace WHCore

#endif
