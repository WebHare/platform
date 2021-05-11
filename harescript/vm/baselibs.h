#ifndef blex_harescript_vm_libs_baselibs
#define blex_harescript_vm_libs_baselibs

#include <blex/context.h>
#include <blex/logfile.h>
#include <blex/mime.h>
#include <blex/pipestream.h>
#include <blex/zstream.h>
#include <blex/socket.h>
#include "hsvm_constants.h"
#include "hsvm_context.h"
#include "hsvm_blobinterface.h"
#include "hsvm_marshalling.h"
#include "hsvm_events.h"

#include "hsvm_idmapstorage.h"
#include "hsvm_dllinterface.h"
#include "bufferedpipes.h"

namespace HareScript
{

class VarMemory;
class BuiltinFunctionsRegistrator;
class Job;

namespace Baselibs
{

const unsigned SystemContextId = 2;
struct SystemContextData;

/** TCP/IP context data */
struct TCPIPContext
{
        /** @short Create a new TCP socket */
        int CreateNewTCPSocket(HSVM *vm);

        /** @short Create a new UDP socket */
        int CreateNewUDPSocket(HSVM *vm);

        int ReceiveDatagram(int connectionid, Blex::SocketAddress *remoteaddress, char *buffer, int bufferlen);

        bool SendDatagram(int connectionid, Blex::SocketAddress const &remoteaddress, char const *buffer, int bufferlen);

        /** @short Get the local TCP/IP endpoint */
        Blex::SocketAddress GetLocalEndpoint(int connectionid);

        /** @short Get the remote TCP/IP endpoint */
        Blex::SocketAddress GetRemoteEndpoint(int connectionid);

        /** @short Bind the socket to a local TCP/IP endpoint */
        bool BindTCPSocket(int connectionid, Blex::SocketAddress local_endpoint);

        /** @short Listen for connections */
        bool Listen(int connectionid);

        /** @short Accept a connection */
        int Accept(HSVM *vm, int connectionid);

        /** @short Connect a socket to a TCP/IP host, -1 error, 0 ok, 1 connecting, call FinishConnectSocket when writable */
        int ConnectSocket(int connectionid, Blex::SocketAddress remote_endpoint, std::string const &hostname);

        /** @short Finish socket connecting, -1 error, 0 ok, 1 connecting, call FinishConnectSocket when writable */
        int FinishConnectSocket(int connectionid, bool cancel);

        /** @short Make an opened TCP connection secure */
        bool CreateSecureSocket(int connectionid, bool initiate, std::string const &ciphersuite, std::string const &hostname, int securitylevel);

        void DestroySecureSocket(int connectionid);

        bool SetSecureSocketCertificate(int connectionid, Blex::Stream &str);

        bool GetPeerCertificateChain(int connectionid, std::string *dest);

        /** @short Shutdown a TCP connection (partly) */
        void ShutdownSocket(int connectionid, bool sread, bool swrite);

        /** @short Shutdown a SSL connection */
        void ShutdownSSL(int connectionid);

        /** @short Close an existing connection and destroy the socket */
        void CloseSocket(int connectionid);

        /** @short Return the last error number */
        int GetLastError(int connectionid, std::string *out_sslerror);

        /** @short Set the socket timeout */
        void SetSocketTimeout(int connectionid, int timeout);

        /** @short Get the socket timeout, -1 if connectionid is no socket  */
        int GetSocketTimeout(int connectionid);

        /** @short Set the socket timeout */
        int SetSocketSendBufferSize(int connectionid, uint32_t newsize);

        /** @short Get the socket timeout, -1 if connectionid is no socket  */
        uint32_t GetSocketSendBufferSize(int connectionid);

        /** @short Set the last error number */
        void SetLastError(int connectionid, int error);

        /** Closes all handles */
        void CloseHandles();

        class Cache
        {
            public:
                class HostnameLookupValue
                {
                    public:
                        Blex::DateTime expires;

                        std::vector<Blex::SocketAddress> alladdresses;
                };

                typedef std::map< std::string, HostnameLookupValue > HostNameLookupCache;

                HostNameLookupCache hostnamelookupcache;
        };

        typedef Blex::InterlockedData< Cache, Blex::Mutex > LockedCache;

        // Static cache, shared by all tcpipcontexts
        static LockedCache cache;

        static void ClearCache();

        class SocketMarshallerData;

        private:
        class SocketInfo : public HareScript::OutputObject
        {
        public:
                SocketInfo(HSVM *vm, TCPIPContext *context, bool is_tcp);

                virtual bool IsAtEOF();
                virtual std::pair< Blex::SocketError::Errors, unsigned > Read(unsigned numbytes, void *data);
                virtual std::pair< Blex::SocketError::Errors, unsigned > Write(unsigned numbytes, const void *data, bool allow_partial);

                HSVM *vm;

                TCPIPContext *context;

#ifdef DEBUG
                Blex::DebugSocket socket;
#else
                Blex::Socket socket;
#endif
                std::unique_ptr<Blex::SSLContext> sslcontext;

                bool is_tcp;
                int timeout;

                Blex::SocketError::Errors lasterror;

                std::vector<uint8_t> ssl_cert_key;

                virtual bool AddToWaiterRead(Blex::PipeWaiter &waiter);
                virtual SignalledStatus IsReadSignalled(Blex::PipeWaiter *waiter);
                virtual bool AddToWaiterWrite(Blex::PipeWaiter &waiter);
                virtual SignalledStatus IsWriteSignalled(Blex::PipeWaiter *waiter);
        };

        typedef std::shared_ptr<SocketInfo> SocketInfoPtr;

        /** @short Check a socket
            @return NULL if the socket doesn't xist*/
        SocketInfo* GetSocket(int connectionid);

        // An associative list of sockets with connectionid as key
        std::map<int, SocketInfoPtr> socketlist;

        // Check to see if we have received anything
        static bool complete(std::vector<uint8_t> *data) { return !data->empty(); }

        std::shared_ptr< SocketInfo > ExportSocket(int connectionid);
        int ImportSocket(VirtualMachine *vm, std::shared_ptr< SocketInfo > const &socket);

        friend struct OSContext;
        friend class SocketInfo;
        friend class SocketMarshallerData;
};

struct MimeDecodeStore : public Blex::Mime::DecodeReceiver
{
        MimeDecodeStore(HSVM *vm,
                                 std::string const &toptype,
                                 std::string const &topencoding,
                                 std::string const &topdescription,
                                 std::string const &topdisposition,
                                 std::string const &topcontentid,
                                 std::string const &defaultcontenttype,
                                 Blex::FileOffset data_part,
                                 Blex::FileOffset part_start,
                                 Blex::FileOffset body_start);

        void StartPart(std::string const &contenttype, std::string const &encoding, std::string const &description, std::string const &disposition, std::string const &content_id, std::string const &original_charset, Blex::FileOffset part_start, Blex::FileOffset body_start);
        void EndPart(Blex::FileOffset body_end, Blex::FileOffset part_end, unsigned linecount);
        void ReceiveData(const void *databuffer, unsigned buflen);

        struct Part
        {
                ///Variable storing this part
                HSVM_VariableId thisrec;
                ///The thisrec.parts member
                HSVM_VariableId cellparts;
                ///The thisrec.data member
                HSVM_VariableId celldata;
        };
        int32_t tempstream;
        HSVM *vm;
        HSVM_VariableId toppart;
        std::stack<Part> partstack;
        int32_t counter;
        Blex::Mime::Decoder decoder;

        Blex::PodVector<uint8_t> scratchpad;
};

typedef std::shared_ptr<MimeDecodeStore> MimeDecodeStorePtr;

/** Crypto context data*/
struct CryptoContext
{
    public:
        CryptoContext();
        ~CryptoContext();

        struct Hasher : public HareScript::OutputObject
        {
                Hasher(HSVM *vm, Blex::HashAlgorithm::Type alg);
                ~Hasher();

                //ADDME Push crypto algorith abstraction into blexlib
                HSVM *vm;
                std::unique_ptr< Blex::Hasher > hasher;

                std::pair< Blex::SocketError::Errors, unsigned > Write(unsigned numbytes, const void *data, bool allow_partial);
        };

        typedef std::shared_ptr<Hasher> HasherPtr;
        typedef std::map< int, HasherPtr > Hashers;
        Hashers hashers;

        typedef std::shared_ptr<Blex::EVPKey> EVPKeyPtr;
        typedef IdMapStorage<EVPKeyPtr> EvpKeys;
        EvpKeys evpkeys;
};

/** OS context data */
struct OSContext
{
        public:
        OSContext();
        ~OSContext();

        struct FileInfo
        {
                FileInfo(HSVM *vm)
                : vm(vm)
                {
                        diskfile=NULL;
                        io_failure=false;
                        can_write=false;
                        eof=false;
                        blobid=0;
                }

                unsigned Read(unsigned numbytes, void *data);
                unsigned Write(unsigned numbytes, const void *data, bool allow_partial);
                HSVM *vm;
                Blex::FileStream *diskfile;
                int blobid;
                Blex::FileOffset bloboffset;
                std::unique_ptr<Blex::RandomStream> randomfile;
                bool io_failure;
                bool can_write;
                bool eof;
        };

        class ZipFile : public HareScript::OutputObject // To work with handle system
        {
            public:
                ZipFile(HSVM *vm) : OutputObject(vm, "ZIP file") { }

                std::unique_ptr< Interface::InputStream > inputstream;
                std::unique_ptr< Blex::ZipArchiveReader > archive;
        };

        typedef std::shared_ptr<ZipFile> ZipFilePtr;

        /** Setup console support */
        void SetupConsole();

        /** @short Create an OS subprocess
            @long Have the OS start a process, under our direct control. Specify
                  what input and output streams we want to process
            @param take_input True if we want control of the process input stream (if false, it will be tied to EOF)
            @param take_output True if we want to receive the process output stream (if false, it will be discarded)
            @param take_errors True if we want to receive the process output stream (if false, it will be discarded)
            @param merge_output_errors True if the error stream should be merged into the output stream (requires take_output=true, ignores take_errors)
            @return Identifier of the process, or 0 if the process could not be created
        */
        int CreateProcess(HSVM *vm, bool take_input, bool take_output, bool take_errors, bool merge_output_errors, bool separate_processgroup, int64_t virtualmemorylimit);

        /** @short Start an OS subprocess
            @long Have the OS start a process, under our direct control. Specify
                  what input and output streams we want to process
            @param processname Name of the process to start
            @param args An array of arguments to pass to the process (eg, argv[1].. argv[n])
            @return Whether the process could be launched
        */
        bool RunProcess(int processid, std::string const &processname, std::vector<std::string> const &args, std::string const &set_cwd, bool share_stdin, bool share_stdout, bool share_stderr);
        void SetProcessEnvironment(int processid, Blex::Process::Environment const &env);

        int WaitForProcessOutput(int processid, int maxwait);
        std::string ReadProcessOutput(int processid);
        std::string ReadProcessErrors(int processid);
        int32_t GetProcessOutputHandle(int processid, bool for_errors);
        void WaitProcess(int processid);
        void SendInterrupt(int processid);
        void TerminateProcess(int processid);
        void DetachProcess(int processid);
        void ResetProcessInput(int processid);
        std::string GetConsoleLine();
        int OpenDiskFile(HSVM *vm, std::string const &path, bool writeaccess, bool create, bool failifexists, bool publicfile);
        bool IsProcessRunning(int processid);
        bool DeleteDiskFile(std::string const &path);
        bool DeleteDiskDirectory(std::string const &path, bool recurse);
        Blex::FileOffset GetFilelength(HSVM *vm, int filehandle);
        void SetDiskFilelength(int filehandle, Blex::FileOffset filesize);
        Blex::FileOffset GetFilePointer(HSVM *vm, int filehandle);
        void SetFilePointer(HSVM *vm, int filehandle, Blex::FileOffset filesize);
        bool CloseFile(HSVM *vm, int filehandle);
        void SetConsoleExitcode(int exitcode);
        int GetProcessExitCode(int processid);
        std::pair< int32_t, int32_t > CreatePipeSet(HSVM *vm, bool bidi);
        void DeletePipe(int32_t pipeid);
        void SetPipeJob(int32_t pipeid, Job *job);
        void BreakPipe(int32_t pipeid);
        void SetPipeReadSignalThreshold(int32_t pipeid, unsigned threshold);
        void SetPipeYieldThreshold(int32_t pipeid, signed threshold);
        int MovePipeToOtherVM(HSVM *receiver, int pipeid);
        void CloseHandles();

        ZipFile* GetZipFile(int fileid);

//        static bool PipeMarshaller(struct HSVM *receiver, HSVM_VariableId received_var, struct HSVM *caller, HSVM_VariableId sent_var);
        static int PipeMarshaller(struct HSVM *vm, HSVM_VariableId var, void **resultdata, HSVM_ObjectRestorePtr *restoreptr, HSVM_ObjectClonePtr *cloneptr);

        typedef std::shared_ptr<FileInfo> FileInfoPtr;

        std::map<int, FileInfoPtr> filelist;

        std::map< int, ZipFilePtr > zipfiles;

        ///arguments passed to the console
        std::vector<std::string> console_args;

        ///console support enabled
        bool console_support;

        ///console exit code
        uint8_t exitcode;

        struct ProcessOutputPipe : public HareScript::OutputObject
        {
                ProcessOutputPipe(HSVM *vm, std::unique_ptr< Blex::PipeReadStream > &pipe);
                ~ProcessOutputPipe();

                std::unique_ptr< Blex::PipeReadStream > output;

                virtual bool IsAtEOF();
                virtual std::pair< Blex::SocketError::Errors, unsigned > Read(unsigned numbytes, void *data);
                virtual bool AddToWaiterRead(Blex::PipeWaiter &waiter);
                virtual SignalledStatus IsReadSignalled(Blex::PipeWaiter *waiter);
        };

        private:
        struct Console : public HareScript::OutputObject
        {
                Console() : OutputObject(NULL, "Console")
                {
                }

                virtual std::pair< Blex::SocketError::Errors, unsigned > Read(unsigned numbytes, void *data);
                virtual bool IsAtEOF();
                virtual bool AddToWaiterRead(Blex::PipeWaiter &waiter);
                virtual SignalledStatus IsReadSignalled(Blex::PipeWaiter *waiter);
        };

        struct Process : public HareScript::OutputObject
        {
                Process(HSVM *_vm) : OutputObject(_vm, "Process"), vm(_vm), started(false), write_unblocked(false)
                {
                }

                ~Process();

                HSVM *vm;
                bool started;
                bool write_unblocked;

                bool Run(std::string const &processname, std::vector<std::string> const &args, std::string const &set_cwd,bool share_stdin, bool share_stdout, bool share_stderr);
                void SetEnvironment(Blex::Process::Environment const &env);
                std::pair< Blex::SocketError::Errors, unsigned > Write(unsigned numbytes, const void *data, bool allow_partial);
                int WaitForProcessOutput(int waittime);
                int32_t GetOutputHandle(bool for_errors);

                std::unique_ptr<Blex::Process> proc;
                std::unique_ptr<Blex::PipeWriteStream> input;
                std::unique_ptr< ProcessOutputPipe > output;
                std::unique_ptr< ProcessOutputPipe > errors;

                virtual bool IsAtEOF();
                virtual bool AddToWaiterRead(Blex::PipeWaiter &waiter);
                virtual SignalledStatus IsReadSignalled(Blex::PipeWaiter *waiter);
                virtual bool AddToWaiterWrite(Blex::PipeWaiter &waiter);
                virtual SignalledStatus IsWriteSignalled(Blex::PipeWaiter *waiter);
        };

        struct PipeEnd : public HareScript::OutputObject
        {
                PipeEnd(HSVM *vm) : OutputObject(vm, "Pipe end"), owner_job(0)
                {
                }
                ~PipeEnd();

                std::unique_ptr< Blex::BufferedPipeReadStream > read_stream;
                std::unique_ptr< Blex::BufferedPipeWriteStream > write_stream;
                Job *owner_job;

                virtual std::pair< Blex::SocketError::Errors, unsigned > Read(unsigned numbytes, void *data);
                virtual std::pair< Blex::SocketError::Errors, unsigned > Write(unsigned numbytes, const void *data, bool allow_partial);

                virtual bool IsAtEOF();
                virtual bool ShouldYieldAfterWrite();
                virtual bool AddToWaiterRead(Blex::PipeWaiter &waiter);
                virtual SignalledStatus IsReadSignalled(Blex::PipeWaiter *waiter);
                virtual bool AddToWaiterWrite(Blex::PipeWaiter &waiter);
                virtual SignalledStatus IsWriteSignalled(Blex::PipeWaiter *waiter);

                void BreakPipe();
        };

        class PipeMarshalData
        {
            public:
                PipeMarshalData(PipeEnd *pipe);
                bool RestoreTo(struct HSVM *vm, HSVM_VariableId var);

            private:
                std::unique_ptr< Blex::BufferedPipeReadStream > read_stream;
                std::unique_ptr< Blex::BufferedPipeWriteStream > write_stream;
        };

        typedef std::shared_ptr<Process> ProcessPtr;

        /** @short Get a file
            @return NULL if the file doesn't xist*/
        FileInfo* GetFile(int fileid);
        /** @short Get a process
            @return NULL if the process doesn't xist*/
        Process* GetProcess(int processid );

        std::map< int, ProcessPtr > processes;


        std::map< int32_t, std::shared_ptr< PipeEnd > > pipes;

        void DestroyOpenProcesses();

        ///Did the console hit EOF ?
        bool console_eof;

        public:
        ///signal input pipe, if any
        std::unique_ptr<ProcessOutputPipe> signalinputpipe;

        Console console;

        friend class PipeMarshalData;
};

/** Listener outputobject (used to be able to wait on connections, for
    notifications, asks and tells)
*/
class EventStream : public HareScript::OutputObject
{
    private:
        Blex::NotificationEventQueue queue;

    public:
        EventStream(HSVM *vm, Blex::NotificationEventManager &_eventmgr);
        ~EventStream();

        bool AddToWaiterRead(Blex::PipeWaiter &waiter);
        void RemoveFromWaiterRead(Blex::PipeWaiter &waiter);
        HareScript::OutputObject::SignalledStatus IsReadSignalled(Blex::PipeWaiter *waiter);

        void TryRead(HSVM_VariableId id_set);

        template< class Itr > void ModifySubscriptions(Itr add_begin, Itr add_end, Itr remove_begin, Itr remove_end, bool reset)
        {
                queue.ModifySubscriptions(add_begin, add_end, remove_begin, remove_end, reset);
        }
};

/** Our own context data.. */
struct SystemContextData
{
        public:
        /// Scratchpad for encode/decode functions, to avoid continuous reallocation
        Blex::PodVector< char > scratchpad;

        std::map<int, MimeDecodeStorePtr> decoders;

        TCPIPContext tcpip;
        OSContext os;
        CryptoContext crypto;

        struct CompressingStream
        {
                HSVM *vm;

                std::unique_ptr<Blex::Stream> outputdata;
                std::unique_ptr<Blex::ZlibCompressStream> inputdata;
        };
        struct DecompressingStream
        {
                HSVM *vm;
                int blobhandle;

                std::unique_ptr<Blex::Stream> inputdata;
                std::unique_ptr<Blex::ZlibDecompressStream> outputdata;
        };

        struct GeneratedArchive
        {
                std::unique_ptr< Blex::ZipArchiveWriter > zipfile;
                int32_t streamid;
        };

        struct Log;

        typedef RegisteredIdMapStorage<std::shared_ptr<GeneratedArchive> > Archives;
        Archives archives;

        typedef RegisteredIdMapStorage<std::shared_ptr<Log> > Logs;
        Logs logs;

        typedef std::shared_ptr<CompressingStream> CompressingStreamPtr;
        typedef std::shared_ptr<DecompressingStream> DecompressingStreamPtr;

        std::map<int, CompressingStreamPtr> compressingstreams;
        std::map<int, DecompressingStreamPtr> decompressingstreams;
        std::map< int32_t, std::shared_ptr< EventStream > > eventstreams;

        SystemContextData();

        ~SystemContextData();

        bool inited_cols;

        inline void CheckColumnMappings(VirtualMachine *vm) { if (!inited_cols) InitColumnMappings(vm); }
        void InitColumnMappings(VirtualMachine *vm);
        void CloseHandles();

        HSVM_ColumnId col_pvt_eof; // "PVT_EOF"
        HSVM_ColumnId col_pvt_pos; // "PVT_POS"
        HSVM_ColumnId col_pvt_data; // "PVT_DATA"
        HSVM_ColumnId col_pvt_current; //  "PVT_CURRENT"
        HSVM_VariableId var_intcallbacks;

        private:
        friend void PrintTo(VarId id_set,VirtualMachine *vm);
        friend void SendBlobTo(VarId id_set,VirtualMachine *vm);
        friend class HareScript::OutputObject;
};

typedef Blex::Context<SystemContextData, SystemContextId, void> SystemContext;

void InitMime(struct HSVM_RegData *regdata);
void InitCrypto(struct HSVM_RegData *regdata);
void InitTokenStream(struct HSVM_RegData *regdata);

void InitStrings(BuiltinFunctionsRegistrator &bifreg);
void InitTypes(BuiltinFunctionsRegistrator &bifreg);
void InitProcess(BuiltinFunctionsRegistrator &bifreg);
void InitLibdumper(BuiltinFunctionsRegistrator &bifreg);
void InitBlob(BuiltinFunctionsRegistrator &bifreg);
void InitTCPIP(BuiltinFunctionsRegistrator &bifreg);
void InitJSON(Blex::ContextRegistrator &creg, BuiltinFunctionsRegistrator &bifreg);
void InitRegex(Blex::ContextRegistrator &creg, BuiltinFunctionsRegistrator &bifreg);

} // End of namespace Baselibs

HSVM_PUBLIC void JHSONEncode(HSVM *vm, HSVM_VariableId input, HSVM_VariableId output, bool hson);

/** Register base libraries, functions and context*/
void RegisterDeprecatedBaseLibs(BuiltinFunctionsRegistrator &bifreg, Blex::ContextRegistrator &creg);

/** Register DLL-style libraries, functions and context*/
int BaselibsEntryPoint(struct HSVM_RegData *regdata, void *context_ptr);

/** Setup console support */
void SetupConsole(VirtualMachine &vm);

/** Setup docgen support */
int DocgenEntryPoint(HSVM_RegData *regdata,void*);

} // End of namespace HareScript

#endif
