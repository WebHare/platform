#ifndef blex_webhare_webserver_shtml
#define blex_webhare_webserver_shtml

#include <ap/libwebhare/whcore_hs3.h>
#include <harescript/vm/hsvm_context.h>
#include "../libwebhare/webscon.h"
#include "session_users.h"

class Shtml;
class WebHareServer;
class ConnectionWorkTask;
const unsigned ShtmlWebContextId = 257;

//ADDME: SRHRunningApp can probably go away once we have a proper VM/errorhandler abstraction
class SRHRunningApp
{
    public:
        SRHRunningApp(Shtml *shtml);
        ~SRHRunningApp();

        // Send a signal that the app must terminate
        void SendTerminateSignal();

        Shtml *shtml;
        ///The VMGroup for a running app
        HareScript::VMGroupRef vmgroup;
        ///The VM for a running app
        HSVM *hsvm;
        /// Termination callback handle
        int termination_callback_handle;

        ///The time the app was started
        Blex::DateTime starttime;
        ///The last time the app was active
        Blex::DateTime lastactive;
        ///Address of the remote user of the app
        Blex::SocketAddress remoteaddr;
        ///User id of the remote user
        int32_t userid;
        ///User entity id of the remote user
        int32_t userentityid;
        ///User name of the remote user
        std::string username;
        ///Abortflag
        std::shared_ptr< unsigned > abortflag;
        ///session id
        std::string sessionid;
        ///Error handler
        HareScript::ErrorHandler errorhandler;
        ///is detached (running srh)
        bool is_detached;
};
typedef std::shared_ptr<SRHRunningApp> SRHRunningAppPtr;

/** A stream class holding a file to transmit, and a VM to own it until it has
    been sent */
struct Shtml_TransmittableFile : public Blex::Stream
{
        Shtml_TransmittableFile(std::shared_ptr<Blex::Stream> stream_to_send)
        : Stream(stream_to_send->DoSmallAccessesNeedBuffering())
        , stream_to_send(stream_to_send)
        {
        }

        ///Virtual machine owning the stream (to keep transactions open)
        SRHRunningAppPtr runningapp;
        ///Actual stream to send
        std::shared_ptr<Blex::Stream> stream_to_send;

        virtual std::size_t Read(void *buf,std::size_t maxbufsize);
        virtual std::size_t Write(void const *buf, std::size_t bufsize);
        virtual bool EndOfStream();
};

struct ShtmlWebContextData //per-request SHTML data, stored in the web connection (no VM around yet)
{
        ShtmlWebContextData(Shtml *shtml);
        ~ShtmlWebContextData();

        Shtml * const shtml;
        ///Currently running application
        SRHRunningAppPtr runningapp;
        ///User ID authenticated with this request
        int32_t userid;
        ///User entity ID authenticated with this request
        int32_t userentityid;
        ///ID of the session that authenticated this user
        std::string authenticating_session_id;


        /// Error states
        enum ErrorState
        {
                NoError, FirstError, DoubleError
        };

        /// Current error state
        ErrorState errorstate;

};

/** SHTML webserver callbacks */
class ShtmlWebserverContextData : public WHCore::SHTMLWebserverCallbacks
{
        Shtml *shtml;

        void ConfigureWebServer(HSVM *hsvm, HSVM_VariableId id_set);
        void FlushLogFiles(HSVM *hsvm);
        void LogWebserverError(HSVM *hsvm);
        void SessionList(HSVM *hsvm, HSVM_VariableId id_set);

        void GetHTTPEventListenerCounts(HSVM *vm, HSVM_VariableId id_set);
        void ClearHTTPEventMessages(HSVM *vm);
        void FlushCache(HSVM *vm);

        public:
        ShtmlWebserverContextData(Shtml *shtml);
        ~ShtmlWebserverContextData();
};

class BLEXLIB_PUBLIC ShtmlContextData : public WHCore::SHTMLCallbacks //per-request SHTML data, used to communicate with the VM (supports webserver environment), stored in HSVM context keepers
{
        public:
        ShtmlContextData(Shtml *shtml);
        ~ShtmlContextData();

        Shtml *const shtml;
        ///Last request for this shtml
        WebServer::RequestRef request;
        ///Access rule we're running this script for, if it's an auth script
        int32_t accessruleid;
        ///Errors for error pages
        HareScript::ErrorHandler hs_errors;
        ///Group id of script that generated hs_errors
        std::string error_groupid;
        ///Last seen Status header
        std::string statusheader;
        ///Program ID, if we're synchronous
        std::string srhprogid;
        ///Blob to send, if any
        std::shared_ptr<Blex::RandomStream> blob_to_send;
        ///Session IDs we took a reference to
        typedef std::set<std::string> ReferredSessions;
        ReferredSessions referred_sessions;

        // Is this script running synchrounously with the web connection? (so, not in the jobmgr)
        bool sync_script;
        /// Async interface for the web connection
        std::shared_ptr< WebServer::ConnectionAsyncInterface > webcon_async_itf;
        /// Is this a detached SRH?
        bool is_detached;
        /// Is this a websocket?
        bool is_websocket;

        class WebserverInputStream;
        std::unique_ptr< WebserverInputStream > inputstream;

        private:
        void GetRequestBody(HSVM *hsvm, HSVM_VariableId id_set);
        void Header(HSVM *hsvm, HSVM_VariableId id_set);
        void Variable(HSVM *hsvm, HSVM_VariableId id_set);
        void AllVariables(HSVM *hsvm, HSVM_VariableId id_set);
        void AllHeaders(HSVM *hsvm, HSVM_VariableId id_set);
        void Sendfile(HSVM *hsvm);
        void AddHeader(HSVM *hsvm);
        void RequestUrl(HSVM *hsvm, HSVM_VariableId id_set);
        void ClientRequestUrl(HSVM *hsvm, HSVM_VariableId id_set);
        void RequestMethod(HSVM *hsvm, HSVM_VariableId id_set);
        void ClientLocalWebserver(HSVM *hsvm, HSVM_VariableId id_set);
        void ClientLocalBinding(HSVM *hsvm, HSVM_VariableId id_set);
        void ClientLocalIp(HSVM *hsvm, HSVM_VariableId id_set);
        void ClientRemoteIp(HSVM *hsvm, HSVM_VariableId id_set);
        void ClientLocalPort(HSVM *hsvm, HSVM_VariableId id_set);
        void ClientRemotePort(HSVM *hsvm, HSVM_VariableId id_set);
        void ClientLocalAddress(HSVM *hsvm, HSVM_VariableId id_set);
        void SessionList(HSVM *hsvm, HSVM_VariableId id_set);

        void AuthenticateWebSession(HSVM *hsvm);
        void AuthenticateWebhareUser(HSVM *hsvm);
        void SetRequestUserName(HSVM *hsvm);
        void AcceptBasicAuthCredentials(HSVM *hsvm);
        void CloseWebSession(HSVM *hsvm);
        void CreateWebSession(HSVM *hsvm, HSVM_VariableId id_set);
        void UpdateWebSession(HSVM *hsvm, HSVM_VariableId id_set);
        void FlushWebResponse(HSVM *hsvm, HSVM_VariableId id_set);
        void ResetWebResponse(HSVM *hsvm);
        void GetAuthenticatingSessionId(HSVM *hsvm, HSVM_VariableId id_set);
        void GetClientUsername(HSVM *hsvm, HSVM_VariableId id_set);
        void GetErrorInfo(HSVM *hsvm, HSVM_VariableId id_set);
        void GetWebSessionData(HSVM *hsvm, HSVM_VariableId id_set);
        void GetWebSessionUser(HSVM *hsvm, HSVM_VariableId id_set);
        void GetWebSessionType(HSVM *hsvm, HSVM_VariableId id_set);
        void StoreWebSessionData(HSVM *hsvm);
        void RevokeWebSessionAuthentication(HSVM *hsvm);
        void LogWebserverError(HSVM *hsvm);

        void GetWebhareAccessRuleId(HSVM *hsvm, HSVM_VariableId id_set);
        void GetWebhareAccessRules(HSVM *hsvm, HSVM_VariableId id_set);
        void GetAuthenticatedWebhareUser(HSVM *hsvm, HSVM_VariableId id_set);
        void GetAuthenticatedWebhareUserEntityId(HSVM *hsvm, HSVM_VariableId id_set);

        void DetachScriptFromRequest(HSVM *hsvm);
        void GetSRHErrors(HSVM *hsvm, HSVM_VariableId id_set);
        void SetupWebsocketInput(HSVM *vm, HSVM_VariableId id_set);

        Session* OpenSession(HSVM *vm,LockedSUCache::WriteRef &lock, bool honor_webserver_restrictions);
};

class ShtmlContextData::WebserverInputStream : public HareScript::OutputObject
{
    public:
        ShtmlContextData *contextdata;

        WebserverInputStream(HSVM *vm, ShtmlContextData *_contextdata)
        : HareScript::OutputObject(vm)
        , contextdata(_contextdata)
        {
        }

        virtual std::pair< Blex::SocketError::Errors, unsigned > Read(unsigned numbytes, void *data);
        virtual bool IsAtEOF();
        virtual bool AddToWaiterRead(Blex::PipeWaiter &waiter);
        virtual HareScript::OutputObject::SignalledStatus IsReadSignalled(Blex::PipeWaiter *waiter);
};

typedef Blex::Context<ShtmlWebContextData,ShtmlWebContextId,Shtml> ShtmlWebContext;

/** Shtml is the central class that does the actual implementation
    of WebHare's functionality into the webserver. It maintains the
    template and language caches, manages the /webhare/ namespace on the
    browser, and sets up the template environment for .shtml files so
    celebrate! */
class Shtml
{
        public:
        Shtml(WebHareServer &whserver, bool debugmode);
        ~Shtml();

        static void WebHareAccessHandler(WebServer::Connection *webcon, WebServer::AccessRule const &rule, bool check_authorized, std::string const &checkuri);
        void ExternalContentHandler(WebServer::Connection *webcon, std::string const &path, bool websocket);

        void FlushCache();
        void ExpireSessions();

        bool const debugmode;

        WHCore::ScriptEnvironment environment;

        /// SUcache uses the global blob manger, which is in the environment.
        LockedSUCache sucache;

        typedef std::map<std::string, SRHRunningAppPtr> SRHRunningAppMap;

        //ADDME: Merge with the session/user cache?
        struct SRHCache
        {
                 SRHRunningAppMap apps;
                 void ExpireApps();
                 void Clear();
        };
        typedef Blex::InterlockedData<SRHCache, Blex::ConditionMutex> LockedSRHCache;
        LockedSRHCache srhcache; //must appear AFTER environment

        // @return first: whether executed, second whether executed and returned success (only executed when syn script or wait_finished==true)
        std::pair< bool, bool > AsyncRunTask(std::unique_ptr< ConnectionWorkTask > &task, HSVM *vm, bool wait_finished);
        void DestroyVMOfFinishedSRH(std::string const &srhid);
        void IndicateSRHActivity(std::string const &srhid, bool poll_only);
        void Shutdown();

        private:
        bool TrySession(WebServer::Connection *webcon, Session &sess, WebServer::AccessRule const &rule);
        void ExecuteAccessScript(WebServer::Connection *webcon, std::string const &scriptpath, int32_t accessruleid);

        /** Starts the SHTML content handler
            @return Whether an asynchronous script has been started
        */
        bool ContentHandler(WebServer::Connection *webcon, std::string const &path, bool path_is_direct, HareScript::ErrorHandler const *errors_for_errorpage, std::string const &errors_groupid, bool websocket);

        /// Logs all errors to the error log
        void LogErrors(std::string const &groupid, std::string const &externalsessiondata, std::string const &contextinfo, const HareScript::ErrorHandler &errors, WebServer::Request const &request);

        /** Create an error page, listing information about the errors made in
            the template
            @param context HareServerPage with information about the failure
            @return Whether an asynchronous script has been started
        */
        bool SendErrors(WebServer::Connection *webcon,
                                 std::string const &groupid,
                                 std::string const &externalsessiondata,
                                 std::string const &contextinfo,
                                 HareScript::ErrorHandler const &errors,
                                 bool vm_running);

        void SuspendSRH(std::string const &progid, SRHRunningAppPtr const &app);
        SRHRunningAppPtr ResumeSRH(std::string const &progid);
        void FinishSRH(std::string const &progid);

        void VMGroupPreterminate(HSVM *vm);
        void VMGroupTerminated(HSVM *vm);

        Shtml(Shtml const &) = delete;
        Shtml& operator=(Shtml const &) = delete;

        public:
        WHCore::Connection& webhare;
        WebServer::Server& webserver;
        WebHareServer& whserver;

        friend class ConnectionWorkTask;
};

class ConnectionWorkTaskAsyncResult;

/** The VMs run in another thread than the webconnection, so we need some kind
    of synchronization. We do this by creating a dispatcher task and posting that
    to out own connection, and wait until it is finished.
*/
class ConnectionWorkTask : public WebServer::ConnectionTask
{
    public:
        enum Type
        {
        Invalid,
        VMFinished,
        AddHeader,
        FlushResponse,
        DetachScript,
        SetSessionAuth,
        SwitchToWebsocket,
        SetValidatedUsername
        };

        std::string GetTaskDescription();

        inline ConnectionWorkTask(Shtml *_html)
        : html(_html)
        , running(false)
        , is_sync(false)
        , type(Invalid)
        , authaccesrule(true)
        , vm(0)
        {
        }

        ~ConnectionWorkTask();

        bool OnExecute(WebServer::Connection *webconn);
        void OnFinished(WebServer::ConnectionAsyncInterface *asyncitf, bool has_run);

    private:
        Shtml *html;
        bool running;
        HareScript::VMGroupRef groupref;
        bool is_sync;

    public:
        Type type;
        std::string value1;
        std::string value2;
        bool always_add;
        bool canclose;
        ///Authenticate the access rule
        bool authaccesrule;
        int32_t userid;
        int32_t userentityid;

        std::string msg;

        HSVM *vm;

        std::shared_ptr< ConnectionWorkTaskAsyncResult > asyncresult;

        friend class Shtml;
};

/** Result admin class; to wait for results of work task.
    Must be kept in a shared_ptr in execution to support destruction of waiter
    and task in any order.
*/
class ConnectionWorkTaskAsyncResult
{
    private:
        class Data
        {
            public:
                inline Data() : signalled(false), executed(false), result(false) { }

                bool signalled;
                bool executed;
                bool result;
        };

        typedef Blex::InterlockedData< Data, Blex::ConditionMutex > LockedData;

        LockedData data;

    public:
        void Wait();

        void SetResult(bool result);
        void SetTerminated();
        std::pair< bool, bool > GetResult();
};

#endif
