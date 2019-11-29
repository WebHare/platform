#ifndef blex_webhare_shared_whcore
#define blex_webhare_shared_whcore

#include "whrpc.h"
#include "dbase_client.h"
#include <blex/getopt.h>
#include <blex/crypto.h>
#include <blex/mapvector.h>
#include <blex/socket.h>
#include <blex/context.h>
#include <blex/notificationevents.h>
#include <harescript/vm/hsvm_dllinterface.h>
#include <harescript/vm/hsvm_processmgr.h>
#include <harescript/vm/hsvm_marshalling.h>
#include <harescript/vm/hsvm_stackmachine.h>

namespace CompilationPriority
{
///Compilation priority classes
enum Class
{
        ///Highest priority (unused)
        ClassHighest,
        ///Interactive applications
        ClassInteractive,
        ///Background applications
        ClassBackground,
        ///Idle compilations (not directly required, but compile them just in  case)
        ClassIdle
};
} //end namespace CompilationPriority

namespace WHMRequestOpcode
{
enum Type
{
        SendEvent =             101,
        RegisterPort =          102,
        UnregisterPort =        103,
        ConnectLink =           104,
        OpenLinkResult =        105,
        DisconnectLink =        106,
        SendMessageOverLink =   107,
        RegisterProcess =       108,
        GetProcessList =        109,
        ConfigureLogs =         110,
        Log =                   111,
        Disconnect =            112,
        FlushLog =              113,
        SetSystemConfig =       114,
        _max =                  114
};
}


namespace WHMResponseOpcode
{
enum Type
{
        Answer =                0,
        IncomingEvent =         101,
        RegisterPortResult =    102,
        OpenLink =              103,
        ConnectLinkResult =     104,
        LinkClosed =            105,
        IncomingMessage =       106,
        RegisterProcessResult = 107,
        GetProcessListResult =  108,
        UnregisterPortResult =  109,
        ConfigureLogsResult =   110,
        FlushLogResult =        111,
        SystemConfig =          112
};
}

namespace WHCore
{


//forward declarations
class Connection;
class SHTMLWebserverCallbacks;

/** Verify whether a [namebegin,nameend[ is acceptable as a file, folder, site or username in WebHare.
    @param slashesok true to ignore slashes in the name (used to validate full paths)
    @return true if the name is acceptable in WebHare */
bool BLEXLIB_PUBLIC ValidName(const char *namebegin, const char *nameend,bool slashesok=false);

/// stderr writer for harescripts
int BLEXLIB_PUBLIC StandardErrorWriter(void */*opaque_ptr*/, int numbytes, void const *data, int /*allow_partial*/, int *errorcode);

class LogConfig
{
    public:
        std::string tag;
        std::string logroot;
        std::string logname;
        std::string logextension;
        bool autoflush;
        unsigned rotates;
        bool with_mseconds;
};

class BLEXLIB_PUBLIC ManagerConnection
{
    public:
        /** @param conn WHCore connection
        */
        ManagerConnection (Connection &conn, Blex::NotificationEventManager &notificationeventmgr);
        ~ManagerConnection();

        void Start();
        void Stop();

        /// Wait max 2 seconds until whmanager connection is establisthed and handshake has been received
        void WaitForConnection();

        /** Wait for max 2 seconds until the jobmgr received a connection to the debugmanager (if present)
            Note: still need to wait until the jobmgr receives the debugger config. Ask the jobmgr to wait.
        */
        void WaitForDebugInit();

        bool ConfigureLogs(std::vector< LogConfig > const &config, std::vector< bool > *result);
        bool FlushLog(std::string const &name);
        void Log(std::string const &name, std::string const &line);
        void SetSystemConfig(uint8_t const *data, unsigned datalen);
        void GetSystemConfig(std::shared_ptr< Blex::PodVector< uint8_t > const > *data);
        void WaitSendQueueEmpty();

        void DistributeNotificationEvent(std::shared_ptr< Blex::NotificationEvent > const &event);

        class AutoJobMgrRegistrar
        {
            private:
                ManagerConnection &conn;

                // no copying
                AutoJobMgrRegistrar(AutoJobMgrRegistrar const &);
                AutoJobMgrRegistrar & operator=(AutoJobMgrRegistrar const &);

            public:
                AutoJobMgrRegistrar(ManagerConnection &_conn, HareScript::JobManager *jobmgr);
                ~AutoJobMgrRegistrar();
        };

    private:
        typedef std::shared_ptr<Database::IOBuffer> IOBufferPtr;
        typedef std::queue<IOBufferPtr> IOBufferQueue;
        typedef std::queue< std::pair< uint32_t, IOBufferPtr > > IOTransmitQueue;

        struct ControlLinkData;
        struct ExtLinkData;

        void ConnectedLoop(Database::TCPConnection &conn);
        void Thread();
        void RegisterSelf(Database::TCPConnection &conn);
        void HandleInput(Blex::PipeWaiter *waiter, IOBufferPtr *inbuf);
        void SendConnectedEvent();
        void SendUpdatedSystemConfigEvent();
        std::pair< bool, bool > HandleControlLinkMessage(ControlLinkData &linkdata, HareScript::IPCMessage2 &msg);
        bool HandleExtLinkMessage(Blex::PipeWaiter &waiter, ExtLinkData &linkdata, HareScript::IPCMessage2 &msg);
        void ClearPortData(bool jobmgr_too);

        void CreateException(std::string const &what, Blex::PodVector< uint8_t > *msgdata);

        void SendRegisterPortResponseMessage(ControlLinkData &linkdata, uint64_t replyto, std::string const &port, bool success);
        void SendUnregisterPortResponseMessage(ControlLinkData &linkdata, uint64_t replyto, std::string const &port);
        void SendSimpleResponseMessage(std::shared_ptr< HareScript::IPCLinkEndPoint > const &link, uint64_t replyto, std::string const &status);
        void SendProcessListMessage(std::shared_ptr< HareScript::IPCLinkEndPoint > const &link, uint64_t replyto, std::map< uint64_t, std::string > const &processes);
        void SendRegisterPortRPC(ControlLinkData &linkdata, uint64_t msgid, std::string const &port, bool isregister, bool need_unregister_response);

        void SetJobMgr(HareScript::JobManager *jobmgr);
        void ResetJobMgr();

        bool InitDebuggerConnection(Blex::PipeWaiter *waiter);

        IOBufferPtr GetIOBuffer();
        void AddToCache(IOBufferPtr const &buf);

        Connection &conn;
        Blex::NotificationEventManager &notificationeventmgr;
        HareScript::GlobalBlobManager *blobmgr;

        HareScript::ColumnNames::GlobalMapper globalmapper;
        HareScript::ColumnNames::LocalMapper localmapper;
        HareScript::StackMachine stackm;
        HareScript::Marshaller marshaller;
        HareScript::VarId msgvar;
        HareScript::VarId composevar;

        IOTransmitQueue transmitqueue;
        IOBufferQueue cache;

        struct ControlLinkData
        {
                std::set< std::string > registeredports;
                std::shared_ptr< HareScript::IPCLinkEndPoint > link;
                uint32_t connid;
                std::list< uint64_t > requested_processlists_replyids;
        };

        struct ExtLinkData
        {
                ExtLinkData() : linkid(0), scheduled_packets(0), throttled(false), part_msgid(0) {}

                std::shared_ptr< HareScript::IPCLinkEndPoint > link;
                uint32_t linkid;

                unsigned scheduled_packets;
                bool throttled;

                uint64_t part_msgid;
                Blex::PodVector< uint8_t > part_data;
        };

        std::map< uint32_t, ControlLinkData > controllinks;
        std::map< uint32_t, ExtLinkData > extlinks;

        uint32_t pending_debugger_connid;
        std::shared_ptr< HareScript::IPCLinkEndPoint > pending_debugger_link;

        struct MgrData
        {
                MgrData();

                IOBufferQueue queue;

                HareScript::JobManager *jobmgr;

                std::vector< std::string > registered_ports;
                std::vector< std::pair< std::string, bool > > port_actions;
                std::map< uint32_t, std::vector< bool > > configurelogresults;

                bool abort;
                bool connected;
                bool connectfailed;
                bool release_jobmgr;
                Blex::DateTime aborttimeout;
                uint64_t processcode;
                bool have_debugger;
                bool wait_debuginit;
                uint32_t conncounter;
                uint32_t requestcounter;
                std::shared_ptr< Blex::PodVector< uint8_t > > systemconfig;
        };
        typedef Blex::InterlockedData<MgrData, Blex::ConditionMutex> LockedMgrData;
        LockedMgrData mgrdata;

        bool CheckAbort(LockedMgrData::ReadRef const &lock);
        bool LockedPushIntoQueue(LockedMgrData::WriteRef &lock, IOBufferPtr *iobuf);
        bool ScheduleQueuedPackets(LockedMgrData::WriteRef &lock);
        bool ProcessTransmitQueue(LockedMgrData::WriteRef &lock, Database::TCPConnection &tcpconn, Blex::PipeWaiter &waiter);
        void InitWHManagerPort(LockedMgrData::WriteRef &lock, Blex::PipeWaiter &waiter, std::shared_ptr< HareScript::IPCNamedPort > *port);
        bool LoopWithJobMgr(Database::TCPConnection &tcpconn);

        friend class BroadcastInterface;
        friend class AutoJobMgrRegistrar;

        Blex::Thread subthread; //note: must be last object!

        void HandleLinks(
                Blex::PipeWaiter &waiter,
                std::shared_ptr< HareScript::IPCNamedPort > &port);
};

class SoftResetListener : public Blex::NotificationEventReceiver
{
        Connection &conn;

    public:
        SoftResetListener(Connection &conn);
        ~SoftResetListener();

        void ReceiveNotificationEvent(std::string const &event, uint8_t const *hsvmdata, unsigned hsvmdatalen);
};

class BLEXLIB_PUBLIC JobManagerIntegrator;

namespace WHManagerConnectionType
{
        enum Type
        {
        None =              0,
        Connect =           1,
        RequireConnected =  2
        };
}

/** Connection manages the connection to a remote WebHare database,
    provides a few often-used functions for accessing modules and the database

    Generally, initializing the Connection is what any WebHare related software
    does upon loading, passing its argv[1] as webhare_server parameter.*/
class BLEXLIB_PUBLIC Connection
{
        public:

        struct ModuleData
        {
                std::string modpath;
                Blex::DateTime creationdate;
        };

        typedef std::map<std::string, ModuleData, Blex::StrCaseLess<std::string> > ModuleMap;

        /** Add well-known WebHare options to a command line parser */
        static void AddOptions(Blex::OptionParser &optparser);
        /** Print globally supported options to std::cerr */
        static void PrintGlobalOptions();


        /** Initialize the WebhareConfig structure and attempt to read all
            necessary data files. Throws an exception on any failure.
            @param options Command-line options passed to this server */
        Connection(Blex::OptionParser const &options, std::string const &clientname, WHManagerConnectionType::Type connect_whmanager);

        ~Connection();

        std::string GetConfigKey(Database::TransFrontend &trans, std::string const &name);

        /** Get the client name */
        std::string const &GetClientName() const
        { return clientname; }

        /** Get the root directory for the WebHare files (root, /dbase,
            /modules, /skins, /web etc) */
        const std::string& GetWebHareRoot() const
        {
                return installationroot;
        }
        /** Get the base directory for the WebHare data files (dbase, installedmodules). */
        const std::string& GetBaseDataRoot() const
        {
                return basedatadir;
        }

        /** Get the ephemeral var directory. */
        std::string GetEphemeralRoot() const;

        /** Get the directory for the WebHare binaries (/bin/) */
        std::string GetBinRoot() const;

        /** Get the directory for the WebHare log files (/log/) */
        std::string GetLogRoot() const;

        /** Get the directory for the WebHare tmp files (/tmp/) */
        std::string GetTmpRoot() const;

        /** Get the directory for the compile cache */
        std::string GetCompileCache() const;

        /** Get the preload library */
        const std::string& GetPreloadLibrary() const
        { return preloadlibrary; }

        /** Get the path to a module root */
        std::string GetModuleFolder(std::string const &modulename) const;
        /** Get a list of modules */
        void GetModuleNames(std::vector<std::string> *modules) const;
        /** Use only shipped fonts? */
        bool UseOnlyShippedFonts() const
        {
                return only_shipped_fonts;
        }

        Blex::SocketAddress GetDbaseAddr() const
        {
                return dbaseaddr;
        }

        Database::TCPFrontend& GetDbase() const
        {
                return *dbaseptr;
        }

        Blex::SocketAddress const & GetCompilerLocation() const
        {
                return compilerloc;
        }

        /** add the standard options to a command's option list (eg --dbroot, --compiler) */
        void AddStandardArguments(std::vector<std::string> *arglist);

        /** Reload plugin configuration */
        void ReloadPluginConfig() const;

        /** Scan a specific module folder
            @param always_overwrites Always overwrite modules found here (to ensure webhare core modules are never overwritten) */
        void ScanModuleFolder(ModuleMap *map, std::string const &folder, bool rootfolder, bool always_overwrites) const;

        /** Connect to the WH manager to listen for remote events */
        void ConnectToWHManager();

        /** Start the connection to the debugger */
        void InitDebugger();

        std::vector<std::string> const &GetModuleDirs() const { return moduledirs; }

        //void Broadcast(std::string const &eventname, uint8_t const *data, unsigned datalen, HareScript::BroadcastMode::Type mode) const;

        bool ConfigureRemoteLogs(std::vector< LogConfig > const &config, std::vector< bool > *result)
        {
                return mgrconn.ConfigureLogs(config, result);
        }
        void RemoteLog(std::string const &logname, std::string const &logline)
        {
                mgrconn.Log(logname, logline);
        }
        bool FlushRemoteLog(std::string const &logname)
        {
                return mgrconn.FlushLog(logname);
        }
        void FlushManagerQueue()
        {
                mgrconn.WaitSendQueueEmpty();
        }

        void GetSystemConfig(std::shared_ptr< Blex::PodVector< uint8_t > const > *data)
        {
                mgrconn.GetSystemConfig(data);
        }

        void SetSystemConfig(uint8_t const *data, unsigned datalen)
        {
                mgrconn.SetSystemConfig(data, datalen);
        }

        std::unique_ptr<SHTMLWebserverCallbacks> shtmlcallbacks;

        Blex::NotificationEventManager & GetNotificationEventMgr() { return notificationeventmgr; }

    private:
        ///Client name
        std::string clientname;
        ///Database connecting to the WebHare database
        std::unique_ptr<Database::TCPFrontend> dbaseptr;
        ///Where is webhare
        std::string installationroot;
        ///And where is the database server
        Blex::SocketAddress dbaseaddr;
        ///And where is the compile server?
        Blex::SocketAddress compilerloc;
        ///And where is the consilio server?
        Blex::SocketAddress consilioloc;
        ///Base directory for data (has no default, but if set, modifies the default for data directories)
        std::string basedatadir;
        ///Preload library
        std::string preloadlibrary;
        ///Location of the compile cache
        std::string compilecache;
        ///Module storage directories
        std::vector<std::string> moduledirs;
        ///Use only the shipped fonts?
        bool only_shipped_fonts;

        //void OpenTransactionConnection(std::string const &clientname) const;

        struct Config
        {
                ModuleMap modulemap;
        };

        typedef Blex::InterlockedData<Config, Blex::Mutex> LockedConfig;
        mutable LockedConfig moduleconfig;

        // Needs to be destructed before static data
        Blex::NotificationEventManager notificationeventmgr;
        ManagerConnection mgrconn;
        SoftResetListener softresetlistener;

        Connection(const Connection&) = delete;
        Connection& operator=(const Connection&) = delete;

        friend class BroadcastInterface;
        friend class JobManagerIntegrator;
};


/** Maximum folder depth (affects maximum possible fullpath size)*/
const unsigned MaxFolderDepth = 15;

namespace FolderTypes
{
        /** Folder types */
        enum FolderType
        {
                /** Folder that will be ignored by Webhare */
                Foreign = 1
        };
}

///Get the status part from a published flag
inline int32_t GetStatusFromPublished(int32_t published )
{
        return published % 100000 /* first flag */;
}
///Get the flags part from a published flag
inline int32_t GetFlagsFromPublished(int32_t published )
{
        return published - GetStatusFromPublished(published);
}
///Test if a flag is set
inline bool TestFlagFromPublished(int32_t published, int32_t flag_to_test)
{
        return ((published % (flag_to_test*2)) / flag_to_test) == 1;
}
///Should the file be pulished?
inline bool IsPublishPublished(int32_t published)
{
        return GetStatusFromPublished(published) != 0 || TestFlagFromPublished(published, 100000 /* once published flag */);
}
///Set or reset a flag in a published mask
inline int32_t SetFlagsInPublished(int32_t published, int32_t flag_to_set, bool set)
{
        if (TestFlagFromPublished(published,flag_to_set))
        {
                if (set)
                    return published;
                else
                    return published - flag_to_set;
        }
        else
        {
                if (set)
                    return published + flag_to_set;
                else
                    return published;
        }
}

namespace AccessLevels
{
        enum Level
        {
                /** May update everything contained in a folder */
                FullAccess = 1000,
                /** May browse folder contents */
                BrowseFolder = 100,
                /** No browsing, and folder is inside a hidden folder! */
                InsideHiddenFolder = 75,
                /** The folder is hidden! */
                IsHiddenFolder = 50,
                /** No browsing, may see metadata only */
                NoBrowsing = 0
        };
}

} //end namespace WHCore

#endif
