#ifndef blex_search_indexmanager_consiliomain
#define blex_search_indexmanager_consiliomain

#include <blex/complexfs.h>
#include "../libwebhare/dbase_client.h"
#include "../libwebhare/whcore.h"
#include "../libwebhare/webserve.h"

#include "consilio.h"
#include "cache.h"
#include "hits.h"
#include "langspecific.h"

/** Configuration data read from the registry */
struct IndexManagerConfig
{
        Blex::SocketAddress listenport;
        bool stemming;
        LogLevel loglevel;
};

typedef std::vector<std::string> SearchResults;

/** Objects and functions for manipulation of the search index. */
namespace Lucene
{
        // Forward declarations to Lucene classes (we don't want to include Lucene header
        // files here)
        class NormalizedTokenStream;    // Forward declaration for analysis/tokenstream.h
        class Query;                    // Forward declaration for search/query.h
}

class IndexManager;

class ConsilioBroadcastListener : public Blex::NotificationEventReceiver
{
    public:
        ConsilioBroadcastListener(WHCore::Connection &conn, IndexManager &indexmanager);
        ~ConsilioBroadcastListener();

        void ReceiveNotificationEvent(std::string const &event, uint8_t const *hsvmdata, unsigned hsvmdatalen);

    private:
        // WHCore connection
        WHCore::Connection &conn;

        /// IndexManager link
        IndexManager &indexmanager;
};

class Janitor;                  // Forward declaration for consilio_janitor.h

/** The IndexManager takes care of the index. It handles indexing of pages and
    searching the index. */
class IndexManager
{
    public:
        IndexManager(WHCore::Connection &conn, std::string const &indexdir, IndexManagerConfig const& conf, bool force_rebuild);
        ~IndexManager();

        /** Get the current logging level */
        LogLevel GetLogLevel() const;

        /** Run the IndexManager. */
        int Execute();

        /** Register that we properly shut down the index*/
        void ProperShutdown();

        /** Index a single file.
            @param id The id of the file to index
            @param indexid The indexid this file is indexed in
            @param fields The fields to index for the file
            @return The time (in ms) it took to index the file, or -1 if the file
                    could not be indexed */
        int IndexFile(const std::string &id, const std::string &indexid, const WebServer::WebVars &fields, std::shared_ptr<Blex::RandomStream> body);

        /** Delete all files with a given indexid and/or fileid.
            @param indexid Delete all pages with this indexid, if not empty
            @param webhareid Delete all pages with this webhareid, if not empty
            @param url Delete this url from a given index
            @return The number of delete pages */
        uint32_t DeleteFiles(std::string const &indexid, std::string const &groupdid, std::string const &objectid, std::string const &contentsource);

        /** Delete all files matching a given query.
            @param query The query used to determine which pages will be deleted
            @return The number of delete pages */
        uint32_t DeleteQuery(std::shared_ptr<Lucene::Query> query);

        /** Delete all files matching a given term (fieldname:fieldvalue).
            @param fieldname Field name of the term to delete
            @param fieldvalue Term text of the term to delete
            @return The number of delete pages */
        uint32_t DeleteTerm(const std::string & fieldname, const std::string & fieldvalue);

        /** Optimize the index (merge all segments into one single segment).
            @return The time (in ms) it took to index the file, or -1 if the file
                    could not be indexed */
        int OptimizeIndex();

        /** The web request handler */
        void HandleIndexRequest(WebServer::Connection *webcon, std::string const &path);

        /** Asynchronously process a search request.
            @param fields Search fields
            @param indexid The index to search, or empty for all indices
            @param results An array to put the search results into
            @return The total number of results found for the requested query,
                    or -1 when no valid query was found
                    or -2 when a Lucene exception was thrown */
        int32_t Search(const WebServer::WebVars &fields, const std::string &indexid, SearchResults * results);

        int32_t GetSuggestKeywords(const WebServer::WebVars &fields, const std::string &indexid, SearchResults * results);

        /** Get the number of documents in a given index (called asynchronously).
            @param indexid ID of the index to get the size from
            @return The number of documents in the index
                    or -1 when no valid query was found
                    or -2 when a Lucene exception was thrown */
        int32_t IndexSize(const std::string &indexid);

        /** Get a list of all indexes */
        bool IndexList(SearchResults *list);

        /// Index status
        enum IndexStatus
        {
                IndexOk = 1,        ///< Index is clean (sanity file exists)
                IndexCheck = 2,     ///< Index is validated and should be checked
                IndexOptimizing = 3 ///< Index is being optimized (other writing processes will have to wait)
        };
        typedef Blex::InterlockedData<IndexStatus, Blex::ConditionMutex> LockedStatus;
        /// Index status
        LockedStatus indexstatus;

        typedef Blex::InterlockedData<bool, Blex::ConditionMutex> LockedConfigured;
        /// Is the IndexManager configured yet?
        LockedConfigured indexmanagerconfigured;

        /** Log level is changed in the registry.
            @param loglevel The new log level */
        void SetNewLogLevel(LogLevel loglevel);

        typedef Blex::InterlockedData<LogLevel, Blex::ConditionMutex> LockedLogLevel;
        /// Log level
        LockedLogLevel loglevel;

        /** Get the commit lock. A process takes this lock when rewriting the
            "segments" file and deleting outdated segment files, or when reading
            the "segments" file and opening the segment files of the segment it
            names. */
        Blex::Mutex commit_lock;

        IndexManagerConfig const &GetConfig() const { return conf; }

        /// Cache of the segments
        SegmentsCache cache;

    private:
        void AccessLogFunction(WebServer::Connection&,unsigned,uint64_t);
        void ErrorLogFunction(Blex::SocketAddress const &,std::string const&);

        void BackupIndex(const std::string & basedir);

        /** Validate the index. Just a quick scan on startup after an unclean
            shutdown to check if all necessary files are present.

            This function does the following:
            - Remove existing locks
            - Check if all segments in the segments file exist and are complete
              (i.e. no segment files missing)
            - Remove unused and invalid segments and unused files
            - Write segments and deletable files

            When true is returned the resulting index _should_ be readable by
            indexing and searching processes. Only the existence of all segment
            files is guaranteed, not whether the files are complete and correct!
            @param indexdir The directory to check
            @return If the index could be validated */
        bool ValidateIndex(const std::string & indexdir, std::string const &cachedir);

        /** Check the index version
            @param indexdir The directory to check
            @return If the index has the right version (if false, the index should
                    be completely rebuilt) */
        bool CheckIndexVersion(const std::string & indexdir);

        /** Highlight words in a given TokenStream.
            */
        std::string HighlightWords(Lucene::NormalizedTokenStream &text,
                                                 const std::set<std::string> &words,
                                                 int32_t maxlength,
                                                 bool highlight = true);

        /** Read a cache file and return index page parameters. If the cache file
            could be read, the resulting array is guaranteed to contain values
            for all page parameters in the order url, fileid, title, type,
            modificationdate, size and summary.
            @param filename The name of the cache file
            @param req_fields An map to put the page parameters into, insert requested fields
            @param highlight Highlight matches
            @param querywords Words in the query
            @param summarylength The approximate length of the produced summary, in characters
            @return If the file could be read */
        bool GenerateSummaryFromCache(const std::string &filename,
                                                    std::map<std::string, std::string> *req_fields,
                                                    bool highlight,
                                                    const std::set<std::string> &querywords,
                                                    int32_t summarylength,
                                                    Blex::Lang::Language lang);

        /** A command for the IndexManager */
        struct Command
        {
                /// The action to perform
                std::string action;
                /// The index to perfom the action on
                std::string indexid;
        };

        /** Get the <action, indexid> from a URL. */
        Command ParseCommand(const std::string &url);

        /// Dispatcher which accepts and dispatcher incoming connections
        WebServer::Server webserver;

        /// The janitor thread
        std::unique_ptr<Janitor> janitor;

        /// File used as index-sanity marker
        std::string sanityfile;

        std::unique_ptr<Blex::ComplexFileSystem> indexdirectory;
        std::unique_ptr<Blex::ComplexFileSystem> cachefs;
        std::unique_ptr<Blex::ComplexFileSystem> ramfs;

        /// Configuration
        IndexManagerConfig conf;

        /** Check if the index is available for writing requests (add, delete,
            optimize). An index is unavailable if it should be checked or rebuilt
            or if it is currently being optimized by the Janitor. */
        bool IsIndexAvailable(WebServer::Connection *webcon);

        /** Get a list of objects indexed before a given date */
        std::vector<uint32_t> GetOutdatedObjects(std::string const &last_indexed, std::string const &indexid, std::string const &contentsource, std::string const &groupid, std::string const &objectid, std::vector<std::string> *active);

        /** Process a connect request. */
        void ConnectionRequest(WebServer::Connection *webcon);

        /** Process a configuration request. */
        void ConfigureRequest(WebServer::Connection *webcon);

        /** Process a set status request. */
        void SetStatusRequest(WebServer::Connection *webcon);

        /** Process an index request. */
        void IndexRequest(WebServer::Connection *webcon, std::string const &indexid);

        /** Process a delete request. */
        void DeleteRequest(WebServer::Connection *webcon, std::string const &indexid);

        /** Process a deleteoutdated request. */
        void DeleteOutdatedRequest(WebServer::Connection *webcon, std::string const &indexid);

        /** Process a modification date request. */
        void ModDateRequest(WebServer::Connection *webcon, std::string const &indexid);

        /** Process a search request. */
        void SearchRequest(WebServer::Connection *webcon, std::string const &indexid);

        /** Process a suggest request. */
        void SuggestRequest(WebServer::Connection *webcon, std::string const &indexid);

        /** Process an index size request. */
        void SizeRequest(WebServer::Connection *webcon, std::string const &indexid);

        /** Process an index list request. */
        void IndexListRequest(WebServer::Connection *webcon);

        /** Process an optimize request. */
        void OptimizeRequest(WebServer::Connection *webcon);

        /** Process a status request. */
        void StatusRequest(WebServer::Connection *webcon);

        friend int UTF8Main(const std::vector<std::string> & args);

        IndexManager(IndexManager const &) = delete;
        IndexManager& operator=(IndexManager const &) = delete;
};

#endif

