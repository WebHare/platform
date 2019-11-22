#ifndef blex_binarylogfile
#define blex_binarylogfile

#ifndef blex_podvector
#include "podvector.h"
#endif
#ifndef blex_mmapfile
#include "mmapfile.h"
#endif

namespace Blex
{

namespace Detail
{
/** A template class that can be wrapped around a structure to ensure
    that no members will be accessed without proper locking. The owner
    of the object can only access the members by creating a lock object.
    Also, a special scoped lock is added, with runtime-checking if access
    is only done when locked
    (this is a adaptation of InterlockedData)
*/
template < class Data, class ProtectMutex > class ScopedLockedData : public ProtectMutex
{
    public:
        /** Obtain a write lock and read/write access to the protected data*/
        class WriteRef : public ProtectMutex::AutoWriteLock
        {
                public:
                /** Construct a read-write access lock */
                WriteRef(ScopedLockedData<Data,ProtectMutex> &_datasource)
                  : ProtectMutex::AutoWriteLock(_datasource)
                  , datasource(_datasource)
                {
                }

                /** Access the protected data */
                Data& operator*() { return datasource.protected_data; }
                /** Access the protected data */
                Data* operator->() { return &datasource.protected_data; }

                private:
                /** Pointer to the protected data structure */
                ScopedLockedData<Data,ProtectMutex> &datasource;
        };
        /** Obtain a write lock and read/write access to the protected data, using scoped lock. With runtime-checking*/
        class ScopedRef : public ProtectMutex::ScopedLock
        {
                public:
                /** Construct a read-write access lock */
                ScopedRef(ScopedLockedData<Data,ProtectMutex> &_datasource, bool lock)
                  : ProtectMutex::ScopedLock(_datasource, lock)
                  , datasource(_datasource)
                {
                }

                void DoThrow() { throw std::runtime_error("Mutex not locked in ScopedLockedData"); }

                /** Access the protected data */
                Data& operator*() { /*if (!IsLocked()) DoThrow(); */return datasource.protected_data; }
                /** Access the protected data */
                Data* operator->() { /*if (!IsLocked()) DoThrow(); */return &datasource.protected_data; }

                private:
                /** Pointer to the protected data structure */
                ScopedLockedData<Data,ProtectMutex> &datasource;
        };

    private:
        /** An instance of the data that we are protecting */
        Data protected_data;

        friend class WriteRef;
        friend class ScopedRef;
};

} // End of namespace detail

/** The BinaryLogFile class is a logfile to which messages can be written, and
    can be read from. Writes are atomic, and will survive an OS or application
    crash. Messages cannot be directly deleted from the logfile, but the first
    part of a logfile can be rewritten.

    This can be done by calling StartRewriteFase, calling SendRewriteMessages to
    obtain all messages that need to be rewritten, writing rewritten messages to
    log (with to_write set true) and then calling CompleteRewriteFase.

    Internal locking order: data -> chains (in order of data->chains) -> segmentadmin

    This class is fully threadsafe.

    DEVELOPERS WARNING: this class uses std::shared_ptrs, but these are
      NOT THREADSAFE! They may only be modified and copied under the Data lock!!!
*/
class BLEXLIB_PUBLIC BinaryLogFile
{
    public:
        /// Signature of function receiving all the messages
        typedef std::function< void(PodVector< uint8_t > const &) > MessageReceiver;

    private:

        /// The logfile itself. Only modified in constructor, and sectionfile is fully mt safe, so no locks needed
        std::unique_ptr< SectionFile > logfile;

        /// Segment size of the logfile (only set in constructor)
        unsigned segmentsize;

        /// Set to true to disable disk flushing
        const bool disable_flush;

        /** Structure protecting administration data (and segment headers in
            disk pages). Make sure it is taken when reading/writing headers.
        */
        struct SegmentAdmin
        {
                /// Free map for segments
                Blex::PodVector< bool > segment_used_map;
        };

        typedef InterlockedData< SegmentAdmin, Mutex > LockedSegmentAdmin;

        /// Administration data (and segment header lock */
        LockedSegmentAdmin segmentadmin;

        /** A chain describes a connected list of connected segments. On disk,
            every chain segment links to the next on disk. Also, chains
            can be chained together with the next_chain field.
        */
        class Chain
        {
            private:
                /// Log class this chain belongs to (for acces to segment admin)
                BinaryLogFile *log;

                /// List of segments in chain
                std::vector< unsigned > segments;

                // We need to declare LockedChain, because we need it in-class.
                typedef InterlockedData< Chain, Mutex > LockedChain;

            public:
                /// Create an empty chain
                Chain();

                /// Set associated log for this chain. MUST be called after construction!
                inline void SetAssociatedLog(BinaryLogFile *_log) { log = _log; }

                /// Destroys the chain (also clears used segments in log's free map)
                ~Chain();

                /// Current write offset
                Blex::FileOffset write_offset;

                /// Nr of first segment with unflushed data
                unsigned flush_limit_segment_nr;

                /// Next chain
                std::shared_ptr< LockedChain > next_chain;

                /// Get the number of segments in this chain
                unsigned GetSegmentsCount() const;

                /// Returns a specific segment
                inline unsigned GetSegment(unsigned nr) const { return segments[nr]; }

                /// Adds a known segment to the chain.
                void AddKnownSegment(unsigned id);

                /// Add a new, fresh segment to the chain
                void AddNewSegment();
        };

        typedef InterlockedData< Chain, Mutex > LockedChain;

        /** Administration data, contains all the current chains, and the
            rewrite fase stuff
        */
        struct Data
        {
                /// Constructor, for empty init
                Data();

                /// List of segments in current log chain
                std::vector< std::shared_ptr< LockedChain > > chains;

                /// Are we in rewrite fase?
                bool in_rewrite_fase;

                /// Number of chains that are currently being rewritten (only valid in rewrite fase)
                unsigned rewritten_chains;

                /// New chain that is used for rewriting
                std::shared_ptr< LockedChain > rewrite_chain;
        };

        typedef Detail::ScopedLockedData<Data, Mutex> LockedData;

        /// Administration data.
        LockedData data;

        /** Opens or creates a logfile.
            @param filename Name of file
            @param create Create a new file if it does not exist.
            @param exclusive Fail opening an existing file if @a create is true.
            @param disable_flush Don't flush to disk when true.
        */
        explicit BinaryLogFile(const std::string &filename, bool create_exclusive, bool disable_flush);

        /** Scans an existing logfile, fills the segments list in the chain structure based on the on-disk chain information
            @param section Autosection to use to lock sections
            @param slock Write lock on segment admin
            @param chain Chain structure to scan
            @param first_segment First segment of chain.
        */
        void ScanSegmentChain(SectionFile::AutoSection &section, LockedSegmentAdmin::WriteRef &slock, Chain &chain, unsigned first_segment);

        /** Scans a chain for the last commit mark (or an end-of-chain mark). Returns whether this chain has been
            closed and linked to another chain
            @param section Autosection to use to lock sections
            @param chain Chain to scan
            @param last_commit_mark Optional address where offset of last commit mark is stored
            @param next_chain_id Optional address where id of the first segment of the next chain is stored.
                   Only valid when 'true' is returned.
            @return Returns whether the chain is closed and linked to another chain (id is optionally stored in next_chain_id)
        */
        bool ScanChainForEnd(SectionFile::AutoSection &section, Chain const &chain, FileOffset *last_commit_mark, unsigned *next_chain_id);

        /** Reads data from a chain.
            @param section Autosection to use to lock sections
            @param chain Chain structure identifying chain to read from
            @param ofs Offset to read from
            @param buffer Buffer to place read data in
            @param size Number of bytes to read
            @return Number of read bytes.
        */
        unsigned DirectRead(SectionFile::AutoSection &section, Chain const &chain, Blex::FileOffset ofs, uint8_t *buffer, unsigned size);

        /** Writes to a chain. Auto-extends if written past end.
            @param section Autosection to use to lock sections
            @param chain Chain structure identifying chain to write to
            @param ofs Offset to write to
            @param buffer Buffer to read data from
            @param size Number of bytes to write
            @param flush Immediately flush the data to disk.
            @return Number of written bytes
        */
        unsigned DirectWrite(SectionFile::AutoSection &section, Chain &chain, Blex::FileOffset ofs, uint8_t const *buffer, unsigned size);

        /** Flushes the data in a chain up until a specific offset. The data can be flushed into two fases, if done so the
            last 4 bytes will be flushed with as least writes as possible. FIXME: rework the itf so that it can be explained
            (like with a parameter that specifies linear-write?)
            @param section Autosection to use to lock sections
            @param chain Chain structure identifying chain to write to
            @param ofs Offset to flush until
            @param first_fase If true, not all bytes will be flushed, the last page (or section or sector, depends on MaxLinearWriteSize
                will not be flushed
            */
        void FlushChainData(SectionFile::AutoSection &section, Chain &chain,  Blex::FileOffset ofs, bool first_fase);

        /** Allocates a new segment, optionally chaining it after another. Segment chaindata on-disk is updated
            when chaining, chain structures in-memory are not updated
            @param append_to Segment to append to, leave out to avoid chaining
            @return Id of newly allocated segment
        */
        unsigned AllocateNewSegment(unsigned append_to = 0xFFFFFFFF);

        /** Initializes a new, fresh log. Warning! This kills all data in a log!
        */
        void InitializeNewLog();

        /** Writes a message to a chain (including size marker)
            @param chain Chain to write to
            @param message Buffer with message to write
            @param length Length of the message to write
            @param auto_commit Also commit message, after writing it.
        */
        void WriteMessageToChain(Chain &chain, uint8_t const *message, unsigned length, bool auto_commit);

        /** Sends all messages that are stored in a list of chains to a receiver function. This function does not
            copy the shared_ptrs, but does lock the chains for reading.
            @param receiver Function to send all messages to (in store order)
            @param chains List of chains to read the messages from
        */
        void SendAllMessagesInternal(MessageReceiver const &receiver, std::vector< std::shared_ptr< LockedChain > > const &chains);

    public:

        /** Opens or creates a logfile
            @param filename Name of file
            @param create_exclusive Fail opening an existing file
            @return BinaryLogFile object, NULL on failure
        */
        static BinaryLogFile * Open(const std::string &filename, bool create_exclusive);

        /** Opens or creates a logfile which won't flush to disk
            @param filename Name of file
            @param create_exclusive Fail opening an existing file
            @return BinaryLogFile object, NULL on failure
        */
        static BinaryLogFile * OpenNoFlush(const std::string &filename, bool create_exclusive);

        /** Writes a message to then main log. Max message size: 1 GB
            @param message Buffer with message to write.
            @param length Length of message
            @param commit If true, immediately commit message.
            @seealso WriteRewriteMessage, SendAllMessages
        */
        void WriteMessage(uint8_t const *message, unsigned length, bool commit);

        /** Writes a message to replace the part of the log that is currently
            rewritten. The message is not visible until the rewrite fase is closed.
            Max message size: 1GB.
            @param message Message to write.
            @param length Length of message
            @seealso WriteMessage
        */
        void WriteRewriteMessage(uint8_t const *message, unsigned length);

        /** Commits all uncommitted messages written until now to the log. Newly
            written messages will not be read if not committed. Multithread: be
            carefull, parallel added uncommitted messages are also committed!
            @param force_new_chain Forces a new chain to be opened.
            @seealso SendAllMessages
        */
        void Commit(bool force_new_chain = false);

        /** Calls a receiver function for all committed messages available in the
            log. No new messages may be written to the log within the receiver
            function (will cause deadlock!)
            @param receiver Receiver function. Called once for every message.
            @seealso WriteMessage
        */
        void SendAllMessages(MessageReceiver const &receiver);

        /** Tries to start a rewrite fase of the log, fails if someone is already rewriting. The parts of the
            log that must be rewritten can be obtained via SendRewriteMessages. Writes to the replacement part
            of the log must be written to WriteMessage, with the to_rewrite flag set. When the rewrite fase is
            completed, the newly written messages replace all the messages obtained by SendRewriteMessages. A
            rewrite can only occur when more than one chain is used by the log (new chains can be forced by Commit)
            @returns Whether rewrite fase was succesfully entered.
            @seealso SendRewriteMessages, WriteRewriteMessage, CompleteLogRewrite, Commit
            */
        bool TryStartLogRewrite();

        /** Commits, and ends the log rewrite fase. After this function has returned, the log
            will contain the messages written in the reset fase, instead of the previous contents
            @seealso StartLogReset, SendRewriteMessages
        */
        void CompleteLogRewrite();

        /** Sends all the messages that will be rewritten in the current rewrite fase to a receiver.
            Upon calling CompleteLogRewrite, the sent messages will be replaced by the messages sent
            to WriteMessage with the flag to_rewrite set. Messages may be added to the log when inside
            this function.
            @seealso StartLogRewrite, CompleteLogRewrite
        */
        void SendRewriteMessages(MessageReceiver const &receiver);

        /** Returns the number of chains currently in use by the log
        */
        unsigned GetChainCount();

        friend class Chain;
};

} // End of namespace Blex

#endif // Sentry

