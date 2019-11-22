#ifndef blex_webhare_appserver_appserver
#define blex_webhare_appserver_appserver

#include <blex/dispat.h>
#include <ap/libwebhare/whcore.h>
#include <ap/libwebhare/whcore_hs3.h>
#include <ap/libwebhare/dispatcherbuffer.h>

class AppServer;

namespace ExpectMode
{
enum Type
{
        None,
        Binary,
        Line,
        DataSent
};
} // End of namespace ExpectMode

class AppServerConn2 : public Blex::Dispatcher::Connection
{
    public:
        AppServerConn2(AppServer &appserver, void *dispatcher);
        ~AppServerConn2();

    private:
        class VMProxy
        {
            public:
                VMProxy(AppServer &_appserver, AppServerConn2 *conn, std::string const &id);
                ~VMProxy();

                struct Data
                {
                        Data() : conn(0), terminated(false) {}

                        AppServerConn2 *conn;
                        bool terminated;
                };

                typedef Blex::InterlockedData< Data, Blex::Mutex > LockedProxyData;

                LockedProxyData data;
                AppServer &appserver;
                std::string id;
                std::string buffer;


                static void AsyncTerminationCallback(std::shared_ptr< VMProxy > const &proxy, HareScript::VMGroup *vmgroup);
                static int OutputWriter(void *opaque_ptr, int numbytes, void const *data, int /*allow_partial*/, int *errorcode);
        };

        void ResetConnection();
        bool SetupScript();
        bool HandleInput();
        bool HandleMessage(HareScript::IPCMessage2 &msg);
        void SendTimeout();
        void EnableInputForExpect();

        void SendDataMessage(uint8_t* data, uint32_t len, bool is_binary, bool complete);
        void SendDataSentMessage();
        void SendSimpleMessage(const char *type, uint64_t msgid);
        void SendInitialMessage(std::string const &vmid);

        virtual void HookIncomingData(uint8_t const *start, unsigned numbytes);
        virtual void HookSignal(Blex::Dispatcher::Signals::SignalType signal);
        virtual void HookDataBlocksSent(unsigned numblocks);
        virtual bool HookExecuteTask(Blex::Dispatcher::Task *task);
        virtual void HookEventSignalled(Blex::Event *event);

        /// Appserver
        AppServer &appserver;

        /// Current script VM
        HareScript::VMGroupRef vmgroup;

        /// Proxy for VM
        std::shared_ptr< VMProxy > proxy;

        /// Link to current script
        std::shared_ptr< HareScript::IPCLinkEndPoint > link;

        /// Current incoming data buffer
        std::vector<uint8_t> inbuffer;

        /// Current expect mode (None, Line, Binary)
        ExpectMode::Type expectmode;

        /// Expected (max) size. Binary: expected size, Line: max line length
        unsigned expectsize;

        /// Messageid for expect message, for reply
        uint64_t expectmsgid;

        /// Messageid for data message, for reply
        uint64_t datamsgid;

        /// Connection closed
        bool connection_closed;

        /// Data buffer
        DispatcherDataBuffer buffer;

        /// Data sending
        Blex::Dispatcher::QueuedSendData senddata;

        HareScript::ColumnNames::LocalMapper localmapper;
        HareScript::StackMachine stackm;
        HareScript::Marshaller marshaller;
        HareScript::VarId msgvar;
        HareScript::VarId composevar;

        friend class VMProxy;
};

/** Appserver main class */
class AppServer
{
public:
        AppServer();
        ~AppServer();

        /** Main function */
        int Execute(std::vector<std::string> const &args);

        /** Should we produce debugging output? */
        bool EnableDebug() const { return debug; }

        /** The script that handles the actual dispatchable connections */
        std::string const &GetDispatchableScript() { return script; }

        /** WebHare main object */
        std::unique_ptr<WHCore::Connection> webhare;
        /** Script environment for dispatchable scripts */
        std::unique_ptr<WHCore::ScriptEnvironment> scriptenv;

    private:
        Blex::Dispatcher::Dispatcher dispatcher;

        void StartManagementScript();
        void ManagementScriptTerminated(HareScript::VMGroup *group);

    public:
        void AsyncErrorReport(std::string const &id, HareScript::VMGroup *vmgroup);

        // Jobmgr MUST stop before dispatcher does
        std::unique_ptr<HareScript::JobManager> jobmgr;

        // Jobmgr intregration MUST stop begore jobmgr and whcore connection
        std::unique_ptr< WHCore::JobManagerIntegrator > jobmgrintegrator;

        Blex::Dispatcher::Connection *CreateConnection(void *dispat);

        std::vector<Blex::Dispatcher::ListenAddress> listenaddresses;

        typedef Blex::InterlockedData< unsigned, Blex::Mutex > LockedConnCounter;

        LockedConnCounter conncounter;

        DispatcherDataBufferAllocator buffer_alloc;

        bool debug;
        bool oldconn;
        std::string script;
};

#endif
