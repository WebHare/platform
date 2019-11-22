#ifndef blex_search_indexmanager_indexmanager
#define blex_search_indexmanager_indexmanager

// Define DEBUGSEGMENTS to print debug information about index classes taking the
// commit lock and reading from and writing to segments
#ifdef DEBUGSEGMENTS
  #define DEBUGSEGMENTSPRINT(x) LOGPRINT(x)
#else
  #define DEBUGSEGMENTSPRINT(x) ((void)0)
#endif

const unsigned NumWorkers = 25;         // Number of working threads for dispatcher

const unsigned IndexFs_BlockSize = 4096;        //Suggested:4096
const unsigned IndexFs_BlocksPerFile = 32768;   //Suggested:32768 (gives max 512MB files)
const unsigned IndexFs_CacheSize = 128*IndexFs_BlockSize;  //Don't know. Tunable?
const unsigned IndexFs_EntriesPerFatPage = 4096;//Suggested:4096  (gives 64GB zmaximum store size
const unsigned CacheFs_BlockSize = 1024;        //Suggested: 1024
const unsigned CacheFs_BlocksPerFile = 128*1024;//Suggested: 128*1024
const unsigned CacheFs_CacheSize = 0;           //Don't know. Tunable?
const unsigned CacheFs_EntriesPerFatPage = 32768;//1TB

// Sanity checking
const unsigned MaxFieldsInSegment = 100000; // Max fields in segment, sanity check.

/** What to log */
enum LogLevel
{
        Log_FatalErrors, //<Log only fatal indexing errors
        Log_Statistics,  //<Log statistic information (queue runs, status reports)
        Log_Debug        //<Log as much actions as possible
};

// Index defines
/// Index version. This can be used to detect if an index should be rebuilt,
/// e.g. when the index structure is changed.
/// Version 6: Store all fields in the index, except "body", which is stored in
///            a cache file if it's supplied (makes it possible to prevent creation
///            of too many cache files when summary generation is not needed)
#define INDEX_VERSION 6

#define MAX_WORD_LENGTH 255             ///< Max token text length

#define MAX_FIELD_LENGTH 10000          ///< Max number of tokens (words) in a field
const unsigned MaxCacheFileSize = 65535;///< Limit size of cache files to 64K

/// The merge factor. There are at most MERGEFACTOR-1 segments containing
/// MERGEFACTOR^x (x>=0) documents. When the MERGEFACTORth segment containing
/// MERGEFACTOR^x documents is added, all segments containing MERGEFACTOR^x
/// documents are merged into one segment containing MERGEFACTOR^(x+1) documents,
/// until a resulting segment contains MAX_MERGEDOCS documents.
#define MERGE_FACTOR 10
#define MIN_MERGE_DOCS 100u             ///< Min number of documents to merge
#define MAX_MERGE_DOCS (1u << 31)       ///< Max number of documents in a single segment

#define INDEX_INTERVAL 128              ///< Term infos interval for writing term info index file

#define MAX_CACHE_DOCS 200              ///< Max number of documents to cache in Hits

#define SCORE_CACHE_SIZE 32             ///< Number of document scores to cache in Scorer


/** The exception thrown by Lucene classes. */
class LuceneException : public std::runtime_error
{
    public:
        /** Create an exception to throw.
            @param msg The message containing an explanation for the exception
            @param is_fatal After this exception, Lucene is unuseable (e.g. the
                            index could not be read) */
        LuceneException(std::string const &msg, bool is_fatal);
        ~LuceneException() throw();

        bool fatal() const { return _fatal; }

    private:
        bool _fatal;
};

#endif

