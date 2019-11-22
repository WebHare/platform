#ifndef blex_webhare_libwebhare_rpc
#define blex_webhare_libwebhare_rpc

//#define IOCLIENTDEBUGGING


#ifdef IOCLIENTDEBUGGING
#define IOCLIENTDEBUGPRINT(x) DEBUGPRINT(x)
#else
#define IOCLIENTDEBUGPRINT(x)
#endif



#include <blex/podvector.h>
#include <blex/socket.h>
#include <blex/pipestream.h>

namespace Database //FIXME For legacy reasons, should be WHCore ?
{

//ADDME Move database codes out of her.e...

/** Possible transaction error codes */
enum ErrorCodes
{
        ///Transaction completed succesfully
        ErrorNone,
        ///Internal error in the database backend
        ErrorInternal,
        ///Invalid argument (transaction screwed up)
        ErrorInvalidArg,
        ///Protocol error
        ErrorProtocol,
        ///Metadata is inconsistent
        ErrorMetadataBad,
        ///Write access denied
        ErrorWriteAccessDenied,
        ///Read access denied
        ErrorReadAccessDenied,
        ///I/O error
        ErrorIO,
        ///Violated general constraints
        ErrorConstraint,
        ///Violated unique constraints
        ErrorConstraintUnique,
        ///Violated reference constraints
        ErrorConstraintReference,
        ///Violated not null constraints
        ErrorConstraintNotNull,
        ///We were disconnected
        ErrorDisconnect,
        ///The transaction conflicted, so try again or give up
        ErrorConflict,
        ///The connection was refused
        ErrorConnectionRefused,
        ///Illegal SQL command
        ErrorIllegalSQLCommand,
        ///Action would cause deadlock
        ErrorDeadlock,
        ///The wrong metadata version was specified for this operation (retry with correct version id)
        ErrorWrongMetadataVersion,
        ///We got a timeout while working with the database
        ErrorTimeout,
        ///The database is not yet ready
        ErrorNotYetReady
};

class BLEXLIB_PUBLIC Exception : public std::runtime_error
{
        public:
        Exception (ErrorCodes errorcode, const std::string& what_arg = "", const std::string& what_table = "", const std::string& what_column = "", const std::string& what_client = "");
        ~Exception() throw();

        ErrorCodes errorcode;
        std::string tablename;
        std::string columnname;
        std::string clientname;
};

namespace RequestOpcode
{
/// Opcodes for requests to the database
enum Type
{
        Answer = 0,                     ///< Send an answer to a received async ask
        AnswerException,                ///< Send an exception as answer to a received async ask
        TransactionStart,               ///< Start a new transaction
        TransactionExplicitOpen,        ///< Explicitly open an auto-transaction
        TransactionCommitRollbackClose, ///< Commit/rollback and/or close a transaction
        NotifyOpen = 5,                 ///< Open the next notification transaction from the queue
        NotifyScan,                     ///< Do a scan of a table of the notification transaction
        NotifyClose,                    ///< Close the current notification transaction
        TransactionSetRoles,            ///< Set the role in a transaction
        ResultSetAdvance,               ///< Advance the cursor to the next block (auto-close on no more data)
        ResultSetLock = 10,             ///< Lock a row in the current block
        ResultSetUnlock,                ///< Unlocks a row in the current block
        ResultSetUpdate,                ///< Updates a locked row in the current block (releases lock)
        ResultSetDelete,                ///< Deletes a locked row in the current block (releases lock)
        ResultSetFase2,                 ///< Get fase2 data for selected rows in current block (may auto-close if requested)
        ResultSetGetInfo = 15,          ///< Get info about a resultset
        ResultSetClose,                 ///< Closes the resultset (may close temp-transaction of auto-transaction when it is the last remaining resultset)
        RecordInsert,                   ///< Inserts a new record
        ScanStart,                      ///< Start a scan
        ScanNotificationsStart,         ///< Start a scan of notifications
        MetadataGet = 20,               ///< Retrieve the current metadata
        AutonumberGet,                  ///< Allocate a new autonumber for a specific table
        BlobUpload,                     ///< Upload a blob
        UNUSED_23,                      ///< Retrieves the length of a blob
        BlobRead,                       ///< Reads part of a blob. Another part will be sent immediately after this.
        BlobMarkPersistent = 25,        ///< Indicates that certain blob ids will be used by the client, and may NOT be freed.
        BlobDismiss,                    ///< Indicates that certain blob ids won't be used anymore by the client, and may be freed.
        SQLCommand,                     ///< Execute an SQL command on the server
        SubscribeAsListener,            ///< Subscribe as listener, set notification list
        Ask,                            ///< Send an ask to a specific listener
        Tell = 30,                      ///< Send a message to a specific listener
        ResetConnection,                ///< Reset the connection for reuse (free all resources)
        BeginConnection,                ///< RPC reserved for initial handshake
        KeepAlive,                      ///< Keep this connection alive
        _max = 34                       ///< This must be the last opcode!
};
std::string BLEXLIB_PUBLIC GetName(uint8_t type);
} /// End of namespace DBRequestOpcode

namespace ResponseOpcode
{
enum Type
{
        Answer = (int)RequestOpcode::Answer, ///< Normal response to a request
        AnswerException =  (int)RequestOpcode::AnswerException, ///< Exception has triggered!
        Reset,                          ///< Reset response code (after this code, connection can be reused)

        AsyncMask = 128,                ///< Mask for asynchronous opcodes
        Ask = AsyncMask,                ///< Asynchronous ask (please respond by calling the dbase with RequestOpcode::Answer
        Notify,                         ///< Asynchronous notification that notifications are available
        Message,                        ///< Asynchronous message (no need to respond)
        Ping,                           ///< Asynchronous ping (please respond with request pong)
        _max                            ///< This must be the last opcode!
};
std::string GetName(Type type);
} // End of namespace DBAnswerOpcode

/** IOBuffers are used for frontend/backend communication */
class BLEXLIB_PUBLIC IOBuffer
{
        public:
        /** Current DB protocol revision */
        static unsigned const ProtRevision = 19;
        /** Header length of all packets */
        static unsigned const HeaderSize = 4;

        IOBuffer();
        ~IOBuffer();

        uint8_t * GetRawBegin()
        { return &*iobuffer.begin(); }
        uint8_t const * GetRawBegin() const
        { return &*iobuffer.begin(); }

        uint8_t * GetRawLimit()
        { return &*iobuffer.end(); }
        uint8_t const * GetRawLimit() const
        { return &*iobuffer.end(); }

        unsigned GetRawLength() const
        { return iobuffer.size(); }

        /** Write binary (uninterpreted) data to this structure
            @parma len Minimum required length
            @param indata Buffer to copy data from */
        void WriteBinary(unsigned len, uint8_t const *indata);

        /** Read binary (uninterpreted) from the structure
            @return Pair of iterators to the data to tread */
        std::pair<uint8_t const*,uint8_t const *> ReadBinary();

        /** Read one value from the current cursor position of the specified
            type. Throws an exception if there is not enough data.

            The advantage of ReadIn over Read is that ReadIn can automatically
            infer the reading type, so that both ReadIn and Write properly
            adapt when types are changed

            @param dest Location to store the read result */
        template <typename ReadType> void ReadIn(ReadType *store);

        /** Read one value from the current cursor position of the specified
            type. Throws an exception if there is not enough data
            @return Read value */
        template <typename ReadType> ReadType Read()
        {
                ReadType data;
                ReadIn (&data);
                return data;
        }
        template <typename WriteType> void Write(WriteType const &val);

        /** Reset this structure so that replies can be read */
        void ResetReadPointer()
        { readpos=HeaderSize; }

        unsigned GetDataLength() const
        { return GetRawLength()-HeaderSize; }

        /** Reset for incoming data. The header will be transferred, and a
            pointer to the internal buffer will be provided to receive the
            rest of the data
            @param headerbytes Pointer to the first 4 header bytes
            @return pointer to begin of total storage (including header) */
        uint8_t* ResetForIncoming(uint8_t const *header)
        {
                iobuffer.resize(Blex::getu32lsb(header)&0xffffff);
                if (iobuffer.size()<4)
                    InvalidRPCData();

                std::copy(header,header+4,&iobuffer.front());
                return &iobuffer.front();
        }

        /** Is this packet complete? */
        bool IsPacketComplete() const
        {
                if (iobuffer.size() < HeaderSize)
                    return false;
                return iobuffer.size() >= GetClaimedLength();
        }

        /** Prepare space for incoming data. Use Unreserve after this call
            to return the unused parts of the data. This call is needed when
            we wish to add something, but don't know yet how long it the data
            will be.
            @param len Bytes to reserve
            @return Pointer to the new data buffer */
        uint8_t* Reserve(unsigned len)
        {
                unsigned addpos=iobuffer.size();
                iobuffer.resize(addpos+len);
                return &iobuffer[addpos];
        }
        /** Frees unused data after a Reserve
            @param len Bytes to free */
        void Unreserve(unsigned len)
        {
                iobuffer.resize(iobuffer.size()-len);
        }

        /** Get the length the buffer claims to have (should only be used by
            I/O code filling this buffer, that cannot rely on GetRawLength() ) */
        unsigned GetClaimedLength() const
        { return Blex::getu32lsb(&iobuffer[0])&0xFFFFFF; }

        /** Finish the buffer for transmission by setting up the length bytes
            properly (should only be used by I/O code filling this buffer) */
        void FinishForReplying(bool exception)
        { Blex::putu32lsb(&iobuffer.front(),iobuffer.size() | ((exception?ResponseOpcode::AnswerException:ResponseOpcode::Answer)<<24)); }

        uint8_t GetOpcode() const
        { return Blex::getu8(GetRawBegin()+3); }

        /** Reset buffer for sending a request or reply*/
        void ResetForSending()
        { iobuffer.resize(4); }

        /** Does this RPC contain an exception? */
        bool IsException() const
        { return GetOpcode()==RequestOpcode::AnswerException; }

        /** Finish the buffer for transmission by setting up the length bytes
            properly (should only be used by I/O code filling this buffer) */
        void FinishForRequesting(uint8_t opcode)
        { Blex::putu32lsb(&iobuffer.front(),iobuffer.size() | (opcode<<24)); }

        /** Throw the exception contained in this IObuffer */
        void ThrowException();

        void WriteVersionData();

        Blex::PodVector<uint8_t>* GetInternalIOBuffer() { return &iobuffer; }
        private:

        void InvalidRPCData();

        Blex::PodVector<uint8_t> iobuffer;
        unsigned readpos;

        friend std::ostream& operator<<(std::ostream &lhs, IOBuffer const &rhs);
};

class TCPConnection
{
    public:
        /** Construct a TCP connection and link us to the parent
            @param frontend Our owner */
        TCPConnection();

        /** Unregister ourselves with the TCP Frontend class, and destroy ourselves */
        ~TCPConnection();

        /** Try to complete a connection reset */
        bool CompleteConnectionReset();

        /** Has this transaction already failed */
        bool HasFailed();

        /** Send a packet on the connection. Implementation must be thread-safe!
            @param buf IO buffer containing the packet to send
            @param timeout Time after which the sending must throw if not yet succeeded. Use Blex::DateTime::Invalid() to not wait at all
            @return Returns whether sending has succeeded (always true if @a timeout == Blex::DateTime::Invalid() */
        bool SendPacket(IOBuffer const &buf, Blex::DateTime timeout = Blex::DateTime::Max());

        /** Place a packet in the internal sendqueue. Returns true when the entire sendqueue has been emptied.
            If not sent,
        */
        bool AsyncSendPacket (IOBuffer const &buf);

        /** Receives a packet from the connection. Implementation must be thread-safe (although it is NOT recommended to
            use from different threads!)
            @param buf IO buffer where received packet must be stored
            @param timeout Time after which the receiving must throw if not yet succeeded. Use Blex::DateTime::Invalid() to not wait at all
            @return Returns whether receiving has succeeded (always true if @a timeout == Blex::DateTime::Invalid()
        */
        bool ReceivePacket(IOBuffer *iobuf, Blex::DateTime timeout);

        /** Retries sending content in the internal sendqueue. Returns true when the entire queue has been sent
        */
        bool RetryAsyncSend();

        /** Add to a pipewaiter
            @param extwaiter Pipewaiter to add to. The waiter is signalled on incoming data, though it is
                not guaranteed that on every signal a packet has arrived */
        void AddToWaiterRead(Blex::PipeWaiter &extwaiter);

        /** Add to a pipewaiter
            @param extwaiter Pipewaiter to add to. The waiter is signalled on incoming data and room for outgoing data, though it is
                not guaranteed that on every signal a packet has arrived */
        void AddToWaiterReadWrite(Blex::PipeWaiter &extwaiter);

        /** Returns whether the read end this socket was the cause of a signal
            @param extwaiter Pipewaiter to check
        */
        bool IsReadSignalled(Blex::PipeWaiter &extwaiter);

        /** Returns whether the write end of this socket was the cause of a signal
            @param extwaiter Pipewaiter to check
        */
        bool IsWriteSignalled(Blex::PipeWaiter &extwaiter);

        /** Returns whether outging data is present (waiting to be queued)
        */
        bool HasOutgoingData();

        /** Asynchronously close the connection and disable PopRequets */
        void AsyncClose();

        /** Set read buffering mode. If true (default), buffer all incoming data
        */
        void SetBufferAllPackets(bool _bufferall) { buffer_all = _bufferall; };

        ///I/O actions tiemout - FIXME private!
        unsigned io_timeout;
        ///Socket - FIXME private!
        Blex::Socket sock;
    private:
        friend class TCPFrontend;

        struct AData
        {
                AData(): abort(false) {}

                Blex::PodVector< uint8_t > incoming;
                Blex::PodVector< uint8_t > outgoing;
                bool abort;
        };
        typedef Blex::InterlockedData<AData,Blex::Mutex> LockedAData;
        LockedAData adata;

        void TrySendOutgoing(LockedAData::WriteRef &lock);
        unsigned TryReceiveIncoming(LockedAData::WriteRef &lock);
        void PopPacket(LockedAData::WriteRef &lock, IOBuffer *iobuf);
        void Loop(bool send, IOBuffer *receive, Blex::DateTime timeout);


        void ReceivePacketIgnoreAsync(IOBuffer *iobuf, Blex::DateTime timeout);


        void SignalConnection();

        /** Inner data loop
            @param want_reply We want a reply (set a timeout)
            @param sending True: return after send completion, false: return after read completion*/
        bool DoHandleData(bool want_reply, bool sending);

        /** Pop outbound data from the lock and move it to current_outbound */
        void PopOutboundData();

        /** Read current receive buffer into an IOBuffer */
        void ParseIOBuffer(IOBuffer *iobuf);

        /** Returns whether the passed data contains a complete IO-buffer */
        bool IsComplete(Blex::PodVector< uint8_t > *data);

        /** Returns the estimated length of the IO buffer in the passed data, 0 if the length is not present yet */
        unsigned GetFirstBufferLength(Blex::PodVector< uint8_t > *data);

        Blex::PipeSet trigger;
        Blex::PipeWaiter waiter;

        /** True if this connection failed on the RPC Level (illegal RPC or disconnect) which makes reuse impossible
            Written from multiple threads, but can only switch once from false to true.
        */
        bool rpcfailed;

        ///Buffer all incoming data? (if false, read one packet and a little bit extra)
        bool buffer_all;
};

//specialise Read and Write to support std::strings
template <> inline void IOBuffer::ReadIn<std::string>(std::string *out)
{
        uint32_t len = Read<uint32_t>();
        if (&iobuffer[readpos] + len > GetRawLimit())
            InvalidRPCData();
        readpos += len;
        out->reserve(len);
        out->assign(reinterpret_cast<const char*>(&iobuffer[readpos-len]),
                    reinterpret_cast<const char*>(&iobuffer[readpos]));
}

template <> inline void IOBuffer::Write<std::string>(std::string const &srcdata)
{
        WriteBinary(srcdata.size(),reinterpret_cast<uint8_t const*>(&srcdata[0]));
}

//specialise Read and Write to support bools
template <> inline void IOBuffer::ReadIn<bool>(bool *out)
{
        *out = Read<uint8_t>();
}

template <> inline void IOBuffer::Write<bool>(bool const &srcdata)
{
        Write<uint8_t>(static_cast<uint8_t>(srcdata?1:0));
}

template<> void IOBuffer::ReadIn< std::vector<uint8_t> >(std::vector<uint8_t> *out);
template<> void IOBuffer::Write< std::vector<uint8_t> >(std::vector<uint8_t> const &srcdata);

template <typename ReadType> inline void IOBuffer::ReadIn(ReadType *store)
{
        //Verify that the data is there
        if (&iobuffer[readpos] + sizeof(ReadType) > GetRawLimit())
            InvalidRPCData();

        //Get the data, increase our position and return the data
        *store = Blex::GetLsb<ReadType>(&iobuffer[readpos]);
        readpos += sizeof(ReadType);
}
template <typename WriteType> inline void IOBuffer::Write(WriteType const &val)
{
        Blex::PutLsb<WriteType>(Reserve(sizeof(WriteType)), val);
}

} //end namespace WHCore

#endif
