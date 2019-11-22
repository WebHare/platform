#ifndef blex_webhare_server_webscon
#define blex_webhare_server_webscon

#include "requestparser.h"
#include "requestroute.h"
#include "webserve.h"
#include <harescript/vm/hsvm_dllinterface.h>

namespace WebServer
{
const unsigned StreamBufferSize = 16384;

const unsigned MmapBufferSize = 65536;

/** A segmented buffer, useful for storing large quantities of webserver output
    data, while avoiding large resizes */
class SegmentedBuffer
{
    public:
        /// FIXME: remove when done with debugging
        ~SegmentedBuffer();

        static const unsigned SegmentSize=16*1024; //size of each output buffer

        ///Initialize empty buffer
        SegmentedBuffer()
        { back_buffer_fill = 0; }

        ///Clear buffer
        void Clear() { output_buffers.clear(); back_buffer_fill=0; }

        ///Is buffer empty?
        bool Empty() const
        {
                return output_buffers.empty();
        }

        ///Length of the segmented buffers
        unsigned Length() const
        {
                if (Empty())
                    return 0;
                return (output_buffers.size()-1) * SegmentSize + back_buffer_fill;
        }

        ///Add buffer to a senddata queue
        void AddToQueue(Blex::Dispatcher::QueuedSendData *queue);
        ///Write our contents to a stream
        bool SendToStream(Blex::Stream &stream);

        ///Add data to buffer
        void StoreData(const void* start, unsigned length);
        void Store(std::string const &str) { StoreData(&str[0],str.size()); }
        void Store(const char *str)        { StoreData(str,strlen(str)); }

    private:
        struct Segment
        {
                uint8_t data[SegmentSize];
        };

        typedef std::list< Segment > Segments;

        Segments output_buffers;

        unsigned back_buffer_fill;
};

/** Authentication data for a request */
struct Authentication
{
        void Reset();

        enum AlgorithmType
        {
        AlgorithmUnknown,       // Unknown
        MD5                     // Md5
        //,MD5Sess              // Md5-session, ADDME: implement support for it
        };

        enum AuthenticationType
        {
        None,                   ///< No authentication present
        Basic,                  ///< Basic authentication
        Bearer                  ///< Bearer token authentication
        };

        /// Type of authentication
        AuthenticationType auth_type;

        /// Login name of the user
        std::string seen_username;
        /// Password (basic)
        std::string password;
        /// Bearer token (bearer)
        std::string token;
};


enum class RequestURLType
{
    ForServer,
    ForClient
};

/** Variables storing the received request */
struct BLEXLIB_PUBLIC Request : RequestRoute
{
        struct AccessRuleHitInfo
        {
                AccessRule const *rule;
                signed datastoragerule;
        };

        Request(Server *server);
        void Reset();

        void ErrorLog(std::string const &error) const;

        void AddRequestHostTo(std::string *addto, int32_t overrideport = 0, bool forcehostheader = false) const;
        std::string GetRequestURL(RequestURLType type) const;

        /// Reference counter
        unsigned refcount;

        ///Server this request came from
        Server *server;
        ///Binding used for this request
        Listener const *binding;
        ///WebSite this request is run upon
        const WebSite *website;
        ///Are we still connected
        bool connected;
        ///Passed authentication data
        Authentication authentication;
        ///Verified/reported user name
        std::string verified_username;
        ///Referrer to this URL
        std::string const *referrer;
        ///User's browser
        std::string const *user_agent;
        ///Requested host
        std::string hostname;
        ///Conditional GETs
        Blex::DateTime condition_ifmodifiedsince;
        ///Accept gzip Content-Encoding
        bool accept_contentencoding_gzip;
        ///Status of the requested path
        Blex::PathStatus filestatus;
        ///All acces rules applicable so far, with the most recent rule last.
        std::vector< AccessRuleHitInfo > rules_hit;
        ///When did we start processing this request (the moment we received all data)
        uint64_t request_start;

        //Is the connection data (local/remote address, is_secure and is_virtual_host) filled in?
        bool conndata_set;
        //Did the request arrive on a secure connection?
        bool is_secure;
        //Does the client connect with a secure connection (eg to the proxy)
        bool is_client_secure;
        //Did the request arrive on a virtual host
        bool is_virtual_host;
        ///Should we allow case fixing on this URL
        bool fixcase;
        //Local address
        Blex::SocketAddress localaddress;
        //Remote address
        Blex::SocketAddress remoteaddress;
        //Scheme used
        std::string scheme;
        //Header debugging enabled for this request
        bool header_debugging;

        // Request parser
        RequestParser reqparser;

        // Request contexts keeper
        Blex::ContextKeeper requestkeeper;
};

class BLEXLIB_PUBLIC RequestRef
{
    private:
        static Blex::Mutex refmutex;
        Request *request;

    public:
        inline explicit RequestRef(Request *req = 0) { request = req; }
        RequestRef(RequestRef const &rhs);
        ~RequestRef();

        inline void swap(RequestRef &rhs) { std::swap(request, rhs.request); }
        inline void reset(Request *req)  { RequestRef temp(req); swap(temp); }
        inline RequestRef & operator =(RequestRef const &rhs) { RequestRef temp(rhs); swap(temp); return *this; }

        Request & operator *() { return *request; }
        Request const & operator *() const { return *request; }
        Request * operator ->() { return request; }
        Request const * operator ->() const { return request; }
        Request * get() { return request; }
        Request const * get() const { return request; }
};

class ConnectionAsyncInterface;

/** A ConnectionTask is executed in the context (thread) of a webserver
    connection.
*/
class BLEXLIB_PUBLIC ConnectionTask
{
    private:
        bool is_running;

    public:
        ConnectionTask();
        virtual ~ConnectionTask();

        /** Execute the task
            Executed in context of webserver connection
            @return Whether task has been completed (write success to @a success member)
        */
        virtual bool OnExecute(Connection *webconn) = 0;

        /* Can be executed by caller (when task scheduling failed, or by
           webcon)
        */
        virtual void OnFinished(ConnectionAsyncInterface *itf, bool has_run) = 0;

        /** Whether the task has been executed successfully
        */
        bool success;

        friend class ConnectionAsyncInterface;
};

class BLEXLIB_PUBLIC ConnectionAsyncInterface
{
    public:
        // Create a new async interface
        ConnectionAsyncInterface(Connection *webcon);
        ~ConnectionAsyncInterface();

        Blex::StatefulEvent incomingdata_event;

    private:
        typedef std::vector< std::shared_ptr< ConnectionTask > > Tasks;

        class Data
        {
            public:
                /// Webserver connection, can be 0 when connection has moved on
                Connection *webcon;

                /// Incoming data, max WebSocketBufferSize bytes
                Blex::PodVector< uint8_t > incomingdata;

                /// True when last StoreIncomingData tried to store more data than buffer allowed
                bool blocked;

                /// Wether a HUP was received
                bool got_hup;

            private:
                /// List of running and scheduled tasks
                Tasks tasks;

                friend class ConnectionAsyncInterface;
        };

        typedef Blex::InterlockedData< Data, Blex::Mutex > LockedData;
        LockedData lockeddata;

        void LockedPushTask(Blex::InterlockedData< Data, Blex::Mutex >::WriteRef &lock, std::unique_ptr< ConnectionTask > &task);

    public:
        void PushTask(std::unique_ptr< ConnectionTask > &task);
        void DoTasks(Connection *webcon, bool just_clear);
        void ResetConnection();
        void MarkCurrentTaskFinished(bool success);

        /** Store websocket incoming data, returns ptr to first unstored char. If not equal to end,
            disable incoming data! Unblock task will be sent when stuff is read
        */
        uint8_t const * StoreIncomingData(uint8_t const *begin, uint8_t const *end);

        /// Signal that the websocket connection got a HUP
        void SignalHangup();

        /// Reads data from incoming data buffer. Also schedules unblock event when buffer was full.
        unsigned ReadIncomingData(uint8_t *buf, unsigned maxread);

        /// Returns whether the websocket connection has got a HUP.
        bool HasHangup();

        void ClearOutput();
        unsigned OutputLength();
        void StoreData(const void* start, unsigned length);

        // If you run synchronous to connection, get your connection pointer here
        Connection *GetSyncWebcon();
};

/** Every web connection lives in a WebServerConnection, which is based
    on the Dispatchable class so that it can be multiplexed.
    The WebServerConnections maintain the data that is associated with a
    connection. */
class BLEXLIB_PUBLIC Connection : public Blex::Dispatcher::Connection
{
    public:
        using Blex::Dispatcher::Connection::MarkAsSleeping;
        using Blex::Dispatcher::Connection::GetLocalAddress;
        using Blex::Dispatcher::Connection::GetRemoteAddress;

        struct OutputData
        {
                //FIXME: shouldn't be public?! FIXME: combine with outbuf?
                SegmentedBuffer output_body;
        };
        typedef Blex::InterlockedData< OutputData, Blex::Mutex > LockedOutputData;
        LockedOutputData lockedoutputdata;

        enum ProtocolStates
        {
                ///Parsing a method, parsing any charcter, waiting for CR
                Method_Parsing,
                ///Got CR after method, waiting for LF
                Method_GotCr,
                ///Parsing the request header
                Request_Header_Parsing,
                ///Actual body parsing
                Body_Parsing,
                ///Handling a send, not parsing anything right now
                Responding,
                ///Request failed, must disconect
                RequestFailed
        };

        /** Variables storing data about the active connection */
        struct CurrentConn
        {
                void Reset();

                ///Configuration used for handling this connection
                ServerConfigPtr config;

                ///Binding on which this request was received
                Listener const *binding;
        };

        /** (Temporary) state variables used when parsing a request, but not
            representing any useful information outside the parser - specifically,
            this information should not be used to actually fulfill the request */
        struct Protocol
        {
                ///Reset the parser structure for a new request
                void Reset();

                ///Connection persistent?
                bool persistent;
                ///Have we sent headers on this connection
                bool sent_headers;
                ///Have we responded on this connection?
                bool responded;
                ///Is this an continuing response? (means: have we already flushed?)
                bool continuing_response;
                ///Are we running an error handler
                bool running_error_handler;
                ///Is the response generated asynchronously? (eg shtml script run by jobmgr)
                bool async_response;
                ///Status code so far
                StatusCodes status_so_far;
                ///Status message if available
                std::string status_additional_message;
                ///Pending error code
                std::string pending_error_message;
                ///Is this a websockets connections
                bool is_websocket;
                ///Error ID
                std::string errorid;
        };

        typedef std::function< void() > FlushCallback;

        Connection(Server *base, void *disp);
        ~Connection();

        /** Get the content type requested by this requested */
        const ContentType *GetContentType() const { return contenttype; }

        const CurrentConn& GetConnection() const
        { return connection; }

        const Request& GetRequest() const
        { return *request; }

        const RequestRef& GetRequestRef() const
        { return request; }

        RequestParser & GetRequestParser()
        { return request->reqparser; }

        RequestParser const & GetRequestParser() const
        { return request->reqparser; }

        /** Get the webserver object */
        Server & GetWebServer()
        { return *webserver; }

        /** Get the request-specific context keeper */
        Blex::ContextKeeper & GetRequestKeeper()
        { return request->requestkeeper; }

        /* Does this request want to handle ALL methods (DELETE, COPY, whatever...)
           as opposed to the simple methods (GET and PUT). */
        bool GetHandleAllMethods() const;

        void SetValidatedUsername(std::string const &username);

        /** Decode the status header from the HTTP headers and store it in protocol.status_so_far, if any*/
        void DecodeStatusHeader(std::string const &scriptpath);

        void FailRequest(StatusCodes errorcode, std::string const &reason);
        void RedirectRequest(std::string const &newurl, StatusCodes redirectcode);

        void PrepareBodyForError();

        //Transmit webpages, statusses or error messages

        void FinalSendStatus(StatusCodes errornum);
        void FinalSendStatusRedirect(StatusCodes errornum,std::string const & newurl);

        void SetLastModified(Blex::DateTime lastmodtime);

        void SendFile(std::string const &filename);
        /** Send the specified stream to the end user */
        void SendStream(std::unique_ptr<Blex::Stream> &to_send, Blex::FileOffset data_length);

        //Below is LEGACY, not verified whether they should be kept
        bool IsHeaderSet(const char *fieldname, unsigned fieldlen);
        std::string const* GetPreparedHeader(const char *fieldname, unsigned fieldlen);
        void AddHeader(const char *fieldname, unsigned fieldlen,const char *datastart, unsigned datalen, bool always_add);
        void AddHeader(const char *fieldname, unsigned fieldlen,const uint8_t *datastart, unsigned datalen, bool always_add)
        {
                AddHeader(fieldname,fieldlen,reinterpret_cast<const char*>(datastart),datalen,always_add);
        }
        template < unsigned fieldlen, unsigned datalen >
         void AddHeader(const char (&fieldname)[fieldlen], const char (&data)[datalen], bool always_add)
        {
                AddHeader(fieldname, fieldlen - 1, data, datalen - 1, always_add); // 0 char is also included in length
        }
        template < unsigned fieldlen >
         void AddHeader(const char (&fieldname)[fieldlen], std::string const &data, bool always_add)
        {
                AddHeader(fieldname, fieldlen - 1, data.c_str(), data.size(), always_add); // 0 char is also included in length
        }

        std::vector<HeaderLine> const& GetAllPreparedHeaders() const
        {
                return send_headers;
        }

        /** Requests permission to run in a specific category. If permission is denied, is_sleeping is
            set to true, and execution must return to the dispatcher. It will be signalled when it may
            run on.
            @return Whether permission to run on was obtained. If false, return to dispatcher. */
        bool GetCategoryRunPermission(unsigned category);

        /** Look up an error page */
        std::string GetErrorPagePath(std::string const &errorfile);

        /** Can we still set headers? */
        inline bool CanSetHeaders()
        {
                return !protocol.sent_headers;
        }

        bool FlushResponse(FlushCallback const &flushcallback);

        void WaitForSignal();

        /** Indicates that the response will be generated asynchronously from the dispatcher
            connection
        */
        void IndicateAsyncResponseGeneration();

        /** Indicates that the asynchronous response generation has finished
        */
        void AsyncResponseDone();

        /** Indicates this is a websockets, and the handler wants all incoming data
        */
        void SwitchToWebsocket();

        std::shared_ptr< ConnectionAsyncInterface > const & GetAsyncInterface()
        {
                return async_itf;
        }

        /** Indicates that this connection is done running in the current category. If
            connections are waiting to run in this specific category, they one of them
            will be signalled. */
        void LeaveCurrentCategory();

        void SetOnTimerElapsed(std::function< void() > const &func)
        { ontimerelapsed = func; }

        void AddErrorID(std::string const &errorid)
        {
                protocol.errorid = protocol.errorid + (protocol.errorid.empty() ? "" : " + ") + errorid;
        }
        std::string const & GetErrorID() const
        {
                return protocol.errorid;
        }

        /// Is it okay to continue processing the request? (no failure yet and no response yet)
        bool OkToContinue() const
        {
                return protocol.status_so_far == StatusOK && !protocol.responded;
        }

        Protocol const& GetProtocolInfo() const
        {
                return protocol;
        }

    private:

        /// Webserver
        Server *server;

        /** Current category this connection is in (0 for none) */
        unsigned current_category;

        /** Requested category (0 for none) */
        unsigned requested_category;

        /** Whether the current connection is sleeping (before entering processing in a category) */
        bool is_sleeping;
        /** Whether the current connection is sleeping to wait for a flush */
        bool is_sleeping_for_flush;
        /** Whether the current connection is sleeping to wait for a signal (not category system) */
        bool is_sleeping_for_signal;

        /// Function to call when timer elapses
        std::function< void() > ontimerelapsed;

        /** Set default webvariables */
        void SetDefaultWebvars();

        bool PreprocessHeader();

        /** We've got the header, process the request so we can handle Body redirects */
        void ProcessRequestHeader();

        /** We've got the data and are in Responding phase, so process the request */
        void ProcessRequest();

        /** We've got all we need, send the final results */
        void ExecuteRequest();

        /** Finish up after the request has been executed */
        void FinishRequest();

        /** Do post processing (verify and parse header-lines) after invoking
            a handler */
        void PostProcessAfterHandler();

        void SetContentDispAttach(const char *filename_begin, unsigned filename_length);

        /** Generate content for an error status message */
        void GenerateErrorContent();

        /** Generate default error content */
        void GenerateDefaultErrorContent();

        ///Figure out a default pagename to append to disk_file_path
        bool ExpandDefaultPages();

        unsigned PathMatchesRule(AccessRule const &rule, std::string const &path, WebSite const *forwebsite) const;

        /// Checks if header debugging is enabled for this url (logging accessrules, tried disk paths)
        void CheckHeaderDebugging();

        /** Execute any path rewrites */
        void DoDiskPathRewrites(std::string const &path, WebSite const *forwebsite, bool fixcase);

        /** Check if file exists on disk storage, fixing case, expanding default pages, removing extensions */
        int DoDiskStorageFileCheck(bool fixcase, bool allow_rewrites, std::string const &testpath);

        void FailDiskPathResolve(std::vector< std::string > const &tested_paths);

        /** Verify that the user can access the requested resource. If the user
            can't, call FailRequest */
        void DoAccessCheck(AccessRules const &rules, std::string const &path, WebSite const *forwebsite);

        /** Capture and send outgoing data after a ExecuteRequest */
        void ScheduleOutgoingData();

        /// Redirect to an alternative path for the specified file, if possible
        bool RedirectAlternativePath(std::string const &inpath);

        ///Content handler for this request (knows the mimetype)
        const ContentType *contenttype;

        Protocol protocol;

        CurrentConn connection;

        RequestRef request;


        ///Parse inbound data that is already in the SSL buffers
        bool HookExecuteTask(Blex::Dispatcher::Task *task);
        void HookIncomingData(uint8_t const *start, unsigned buflen);
        uint8_t const* SubHookIncomingData(uint8_t const *start, uint8_t const *limit);
        void HookEventSignalled(Blex::Event *event);

        ///Notification that some data blocks have been sent
        void HookDataBlocksSent(unsigned numblocks);

        ///The dispatcher synchronous callback function for signals
        void HookSignal(Blex::Dispatcher::Signals::SignalType signal);
        ///The dispatcher asynchronous callback function for signals
        void AsyncHookSignal(Blex::Dispatcher::Signals::SignalType signal);

        Server *webserver;

        /** Send the page. Expects a PrepareHeader to have been called already */
        void SendPage();

        bool AnyDataToSend() const ;

        void FinishDataNow();
        //Below is LEGACY, not verified whether they should be kept

        friend class Server;

        ///Path to the file that needs to be sent (after mapping vhost and rewriters)
        std::string disk_file_path;

        /** Base path, if set we're allowed to look for directory handling markers from here
            Is always a prefix of disk_file_path, ends with a '/' if set
        */
        std::string base_file_path;

        ///std::string _field,_data;
        SegmentedBuffer output_header;

        /// The urlpath on the URL (including first slash)
        std::string requested_path;

        ///Total output size
        uint64_t total_output_size;
        ///Input file, when doing a mmaped-sends
        std::unique_ptr<Blex::MmapFile> outmmap_file;
        ///Pointer to memory map of output file
        const void *outmmap_mapping;
        ///Current memory mapping offset
        uint64_t outmmap_offset;
        ///Current map size
        unsigned outmmap_mappedsize;
        ///Current memory mapping file length
        uint64_t outmmap_length;
        ///Range start
        uint64_t range_start;
        ///Range limit
        uint64_t range_limit;
        ///Input stream, when doing a streamed send
        std::unique_ptr<Blex::Stream> outstream_str;
        ///Buffer for temporary storage of input stream data
        std::unique_ptr<uint8_t[]> outstream_buffer;
        ///Number of bytes used in the outstream buffer
        uint32_t outstream_buffer_length;
        ///Number of bytes offered for sending last time we called Send() for the outstream
        uint32_t outstream_lastsendsize;
        ///Flush completed callback
        FlushCallback flushcallback;

        ///Async interface
        std::shared_ptr< ConnectionAsyncInterface > async_itf;

        unsigned TryPath(bool fixcase);
        void RedirectIntoDirectory();

        bool TryParseRequestLine(std::string const &requestline);
        void ParseHeaderFields(std::string const &parse_data, const HeaderParsers &parsers);
        void ParseHeaderFieldParameters(char const *param_start, char const *param_end, const HeaderParsers &parsers);


        ///Reset structure to accept a new connection
        void ResetNewConnection();

        ///Reset structure to accept a new request
        void ResetNewRequest();

        /** Prepares the header for sending (in output_header) and schedules it in @a final_senddata)
        */
        void ScheduleHeaderForSending();

        ///setup the final headers
        void SetupFinalHeaders();

        void PrepareResponse(uint64_t length);

        std::vector<HeaderLine> send_headers;

        Blex::Dispatcher::QueuedSendData final_senddata;

        /** Analyze the output data and prepare the next packet for transmisson.
            Returns whether any data was sent, or whether a next call may send some more data (this usually
            happends when no data can be sent because other sends are still pending.
        */
        bool PullAndSendOutgoingData();

        /** Pull more data from the output stream into the local stream buffer @a outstream_buffer.
            Tries to fill the stream buffer completely, if possible.
        */
        void PullFromStream();

        /** Drops @a numbytes from the local stream buffer
        */
        void DropFromStream(unsigned numbytes);

        /** When sending a stream or a file mapping, schedules the next batch of data in final_senddata.
            Except for the first send, data from a file mapping can only be scheduled when no sends are
            pending in the dispatcher.
            Puts the data in final_senddata.
        */
        void PullFromStreamOrMapping();

        void DoHttpHeaderParse();
        void Split(char const *tosplit_begin, char const *tosplit_end, char tokensplitter, void (Connection::*parsefunc)(char const *, char const *));
        void SplitWithQuotes(char const*  tosplit_begin, char const*  tosplit_end, char tokensplitter, char quotation_mark, void (Connection::*parsefunc)(char const* , char const* ));

        void HTTPHeader_Connection         (char const *begin, char const *end);
        void HTTPHeader_Cookie             (char const *begin, char const *end);
        void HTTPHeader_CookieParts        (char const *begin, char const *end);
        void HTTPHeader_Authorization      (char const *begin, char const *end);
        void HTTPHeader_Host               (char const *begin, char const *end);
        void HTTPHeader_IfModifiedSince    (char const *begin, char const *end);
        void HTTPHeader_AcceptEncoding     (char const *begin, char const *end);

        /** Signals all connections in queue, returns whether all connections have been signalled and
            there is still room for the another connection to run
        */
        bool SignalCategoryRunnables(Server::CategoryData &catdata);

        /** Returns whether a signal is a valid wakeup for running a connection in a
            specific category
        */
        bool IsSignalValidRunPermission();

        /** Finds this connection in the connection queue
        */
        Server::ConnQueue::iterator FindThisConnectionInQueue(Server::ConnQueue &queue);


        //ADDME: Try to get rid of these 'friendships' by stabilizing our API!
        friend void HandleSendAsIs(WebServer::Connection *webcon, std::string const &path);

};

} //end namespace webserver
#endif
