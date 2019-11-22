#ifndef blex_webhare_server_webserve
#define blex_webhare_server_webserve

#include <blex/threads.h>
#include <blex/path.h>
#include <blex/mime.h>
#include <blex/socket.h>
#include <blex/mmapfile.h>
#include <blex/dispat.h>
#include <blex/context.h>
#include <blex/complexfs.h>
#include <harescript/vm/hsvm_processmgr.h>
#include "whcore.h"
#include "requestparser.h"

namespace WebServer
{

enum StatusCodes
{
        StatusSwitchingProtocols=101,
        StatusOK=200,
        StatusPartialContent=206,
        StatusMovedPermanently=301,
        StatusFound=302,
        StatusSeeOther=303,
        StatusNotModified=304,
        StatusUseProxy=305,
        StatusTemporaryRedirect=307,
        StatusBadRequest=400,
        StatusAccessDenied=401,
        StatusForbidden=403,
        StatusNotFound=404,
        StatusMethodNotAllowed=405,
        StatusRequestTimeout=408,
        StatusRangeNotSatisfiable=416,
        StatusInternalError=500,
        StatusServiceUnavailable=503
};

enum class DiskLookupMethod
{
        Direct,
        SHA256B16,              // Hash of the subpath, appends the extension
        SHA256B16_Directory,    // Ignore the filename, appends the extension
};

class Connection;
struct AccessRule;

typedef std::function< void(Connection *,std::string const &) > ContentHandler;

typedef void (*AccessHandler)(Connection *webcon,AccessRule const &rule,bool check_authorized,std::string const &requesturi);

void BLEXLIB_PUBLIC HandleSendAsIs(WebServer::Connection *webcon, std::string const &path);

struct HeaderLine
{
        std::string header;
        std::string data;
};

struct BLEXLIB_PUBLIC ContentType
{
        ContentType(std::string const &_contenttype, ContentHandler const &_handler);

        std::string contenttype;
        ContentHandler handler;
        ///True to parse and split the body into separate entities, false to keep the request body intact (CGI)
        bool parse_body;
        ///Force disposition attachment
        bool force_disposition_attachment;
        ///Is websocket handler
        bool is_websocket;
};

/** Single access IP mask rule */
struct BLEXLIB_PUBLIC IPRule
{
        IPRule(std::string const &_ipmask, bool is_allow);

        ///Address to check
        Blex::SocketAddress address;
        ///Number of bits to check
        unsigned prefixlength;
        ///True if this is an 'allow' rule, false if this is a 'deny' rule
        bool is_allow;
};

/** A website hosted on this system (as virtual or normal host) */
struct BLEXLIB_PUBLIC WebSite
{
        WebSite(std::string const &folder);

        std::string documentroot;
        std::string hostname;
        std::vector<std::string> defaultpages;
        int32_t webserver_id;

        ///Lower case mode (lowercase urlpath before resolving it on a webserver output)
        bool lowercasemode;
        ///Force HTTPS
        bool forcehttps;
        ///When redirecting to HTTPS, use this port
        int32_t forcehttpsport;
};

/// Location for disk files
struct BLEXLIB_PUBLIC DataStorage
{
        std::string resource;
        bool is_folder;
        DiskLookupMethod method;
};

/** Single access rule */
struct BLEXLIB_PUBLIC AccessRule
{
        /// Matching types. WebHare system_access definition matches the numbering below
        enum MatchType
        {
                MatchExact = 0,
                MatchInitial = 1,
                MatchGlob = 2,
                MatchCookieGlob = 3
        };
        /// Construct an all-is-allowed AccessRule
        AccessRule();
        /// Unique identifier
        int32_t id;
        /// How to compare the path with the requested URL
        MatchType matchtype;
        /// Which accept types to match
        AcceptType accepttype;
        ///Path to which this rule applies
        std::string path;
        /// Redirection target for this rule
        std::string redirecttarget;
        /// Treat redirect targetas a folder (if false, redirect all to a single url)
        bool redirecttarget_is_folder;
        /// IP masks to check
        std::vector<IPRule> ip_masks;
        /// If true, invoke customhandler() AND IP check. if false: invoke customhandler() ONLY if IP check failed
        bool authrequired;
        /// Path for alternative error messages
        std::string errorpath;
        /// Final error path? (don't allow our errorpath to be overwritten by later rules)
        bool finalerrorpath;
        /// Custom handler for this rule (handles userchecking and tokens)
        AccessHandler customhandler;
        /// Is this a redirect url?
        bool redirect;
        /// Force all files to be treated as the following content type
        std::shared_ptr< ContentType const > force_content_type;
        /// If true, this path can handle ALL methods
        bool all_methods;
        /// Match initial rules as subdir (ie, a rule for /webdav/ would redirect /webdav requests to /webdav/)
        bool matchassubdir;
        /// Match only specific methods
        std::set<std::string> matchmethods;
        ///External authentication script
        std::string extauthscript;
        ///Additional headers to add
        std::vector<std::pair<std::string, std::string> > addheaders;
        ///Set cache-control on succcess
        std::string cachecontrol;
        ///Redirect code
        unsigned redirectcode;
        ///Attempt to correct case on broken urls
        bool fixcase;
        ///Glob masks for paths to ignore when matching
        std::vector< std::string > ignorepaths;
        ///Webservers to which the rule applies. empty = applies to all
        std::set<WebSite const*> limitsites;
        // User data
        std::vector<uint8_t> data;
        // Data storages for this rule
        std::vector< DataStorage > datastorage;
};

/** Access rules */
typedef std::vector<AccessRule> AccessRules;

struct Listener
{
        Listener()
        : virtualhosting(false)
        , sitenum(0)
        , id(0)
        , istrustedport(false)
        {
        }

        Blex::Dispatcher::ListenAddress listener;
        bool virtualhosting;
        unsigned sitenum;
        int32_t id;
        bool istrustedport;
};

/** \brief WebServer configuration data.
    These structures are created by WebServer using classes that wish to
    configure it. Note that multiple instances of this structure may exist,
    eg when the server is reconfigured but some in-progress connections still
    depend on the old configuration data.
*/
struct BLEXLIB_PUBLIC ServerConfig
{
        public:
        ServerConfig();

        /** Complete the server configuration array (done before applying configuration. also creates the 'www' aliases) */
//        void CompleteServerConfig();

        /** Set up a virtual hostname lookup */
        void SetupVirtualName(std::string const &hostname, unsigned sitenum);

        /** Find the binding associated with an incoming connection
            @param addr Address of incoming connection
            @return Binding requested by the incoming request, or NULL if no match was found */
        Listener const *FindBinding(Blex::SocketAddress const &addr) const;

        /** Find the binding by id
            @param Id of the binding
            @return Binding, or NULL if no match was found */
        Listener const *FindBindingById(int32_t id) const;

        /** Find the website associated with an incoming connection
            @param addr Address of incoming connection
            @param hostname Hostname requested
            @return Website requested by the incoming request, or NULL if no match was found */
        WebSite const *FindWebSite(Listener const *listener, std::string const &hostname) const;

        /** Find a website by ID */
        WebSite* FindWebSiteById(int32_t id);

        /** Add a content type handler
            @param extension Extension to handle (without the dot)
            @param contenttype (default) mime-type for this content
            @param handler If not NULL, handler that will pre-process this content
            @return The added contenttype, to allow further tweaking if necessary (eg parseoption and parsebody) */
        std::shared_ptr< ContentType > AddContentType(std::string const &extension,std::string const &contenttype, ContentHandler const &handler);

        void SetDefaultContentType(std::string const &extension);

        const ContentType* GetContentType(std::string const &filename) const;
        std::shared_ptr< ContentType > GetContentTypeByContentType(const std::string &contenttype);

        typedef std::map<std::string, std::shared_ptr< ContentType >, Blex::StrCaseLess <std::string> > ContentTypes;
        //typedef std::map<std::string, unsigned, Blex::StrCaseLess <std::string> > VirtualHosts;

        std::vector <Listener> listeners;
        std::vector <WebSite> sites;
        std::vector <Blex::SocketAddress> trust_xforwarded_for;
        std::vector <std::string> stripextensions;

        std::string default_contenttype_extension;

        //ADDME: These two fields belong in the SHTML or WHCORE engine, not here?
        unsigned script_timeout;

        ContentTypes contenttypes;
        ContentTypes contenttypesbyct;
        //VirtualHosts virtualhosts;

        ///Global acces rules
        AccessRules globalrules;

        // debug url masks
        std::vector< std::string > debugurlmasks;

        private:
        typedef std::map<std::string, int32_t, Blex::StrCaseLess<std::string> > ExactSiteMatches;
        typedef std::pair<std::string, int32_t> GlobMask;
        typedef std::vector<GlobMask> GlobMasks;

        struct GlobMaskSorter
        {
                bool operator()(GlobMask const &lhs, GlobMask const &rhs);
        };

        ExactSiteMatches exactsitematches;
        GlobMasks globmasks;
};

typedef std::shared_ptr<ServerConfig const> ServerConfigPtr;


struct StatusData
{
        StatusData(unsigned code, std::string const &title, std::string const &description);

        unsigned code;
        std::string title;
        std::string description;
};

typedef std::function< void(Connection&,unsigned,uint64_t) > AccessLogFunction;
typedef std::function< void(Blex::SocketAddress const &,std::string const&) > ErrorLogFunction;

/** The WebHare HTTP server.

    Thread-safety: all function calls must be synchronized except where
    stated otherwise.

    Exception-safety: basic guarantee. The class will not leak in the presence
    of exceptions.
*/
class BLEXLIB_PUBLIC Server
{
        public:
        /** Initialize the webserver, and build the http and mime header
            tables */
        Server(std::string const &_tmpdir, AccessLogFunction const &_accesslogfunction, ErrorLogFunction const &_errorlogfunction);

        /** Clean up the webserver and terminate any remaining connections */
        ~Server();

        /** Set the jobmanager for this server */
        void SetJobManager(HareScript::JobManager *jobmgr);

        /** Get the text for built-in HTTP error messages
            @param code Status code requested (eg 401: Resource not found) */
        StatusData const* GetStatusData(unsigned statuscode);

        /** Get a reference to the current server configuration */
        ServerConfigPtr ObtainConfig() const;

        /** Install a new server configuration. This function is
            fully thread-safe and does not require synchronization.
            @param newconfig Config structure that will be copied for the new configuration*/
        bool ApplyConfig(ServerConfigPtr newconfig, std::vector<Blex::Dispatcher::ListenAddress> *broken_listeners);

        /** Run the webserver */
        void MainLoop(unsigned numworkers);

        /** Asynchronous interrupt function (called on SIGINT) */
        bool InterruptHandler(int sig);

        /** Get the server boot time */
        Blex::DateTime GetBootTime() const;

        Blex::ContextRegistrator& GetRequestRegistrator()
        { return requestregistrator; }

        Blex::ComplexFileSystem & GetTempFS()
        { return uploadfs; }

        void RegisterConnectionCategory(unsigned category, unsigned maxconcurrent);

        /// Get the jobmanager for this webserver
        HareScript::JobManager & GetJobManager() { return *jobmanager; }

        private:
        typedef std::deque< std::pair< Connection *, bool > > ConnQueue;

        /// Data about connections running in a specific category
        struct CategoryData
        {
                inline CategoryData() : runcount(0), max_concurrent(1) {}

                /// Queue of connections (running and waiting)
                ConnQueue queue;

                /// Number of currently running connections
                unsigned runcount;

                /// Maximum number of running connections at a time, default 1
                unsigned max_concurrent;
        };

        /// Data aboud all categories in the server
        struct CatConnData
        {
                std::map< unsigned, CategoryData > cats;

                CategoryData & FindCategory(unsigned category);
        };

        /// Queue waiting incoming connections
        typedef Blex::InterlockedData<CatConnData, Blex::ConditionMutex> LockedCatConnData;
        /// Queue waiting incoming connections
        LockedCatConnData lockedcatconndata;

        Blex::ComplexFileSystem uploadfs;

        /** Create a new webserver connection structure. This creates a
            Connection class, capable of handling one connection
            at a time. The dispatcher calls this function */
        Blex::Dispatcher::Connection* CreateConnection(void *dispatcher);

        ///Registrator for webserver request plugins
        Blex::ContextRegistrator requestregistrator;

        ///Webserver's boot time
        const Blex::DateTime boottime;

        typedef Blex::InterlockedData<ServerConfigPtr,Blex::Mutex> ServerConfigPtrHolder;

        ServerConfigPtrHolder currentconfig;

        Blex::Dispatcher::Dispatcher dispatcher;

    public:
        ///Access logging function
        AccessLogFunction const accesslogfunction;
        ///Error logging function
        ErrorLogFunction const errorlogfunction;
    private:

        // Jobmanager of this webserver (FIXME webserver shouldn't depend on harescript?)
        HareScript::JobManager *jobmanager;

        Server(Server const &) = delete;
        Server& operator=(Server const &) = delete;

        friend class Connection;
        friend struct Request;
};

} //end namespace webserver

#endif
