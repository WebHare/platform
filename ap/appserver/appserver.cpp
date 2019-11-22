#include <ap/libwebhare/allincludes.h>

#include "appserver.h"
#include <blex/logfile.h>
#include <blex/utils.h>
#include <ap/libwebhare/wh_filesystem.h>
#include <ap/libwebhare/webharedbprovider.h>
#include <ap/libwebhare/whcore_hs3.h>
#include <iostream>


//#define SHOW_EXPECTS

#ifdef SHOW_EXPECTS
 #define EXPECTPRINT(x) DEBUGPRINT(x)
#else
 #define EXPECTPRINT(x) (void)0
#endif

AppServerConn2::AppServerConn2(AppServer &_appserver, void *dispatcher)
: Blex::Dispatcher::Connection(dispatcher)
, appserver(_appserver)
, buffer(&_appserver.buffer_alloc)
, localmapper(_appserver.scriptenv->GetEnvironment().GetColumnNameMapper())
, stackm(localmapper)
, marshaller(stackm, HareScript::MarshalMode::SimpleOnly)
{
        msgvar = stackm.NewHeapVariable();
        composevar = stackm.NewHeapVariable();

        this->ResetConnection();
}

AppServerConn2::~AppServerConn2()
{
        // Must reset the connection (remove the event!)
        ResetConnection();
}

void AppServerConn2::ResetConnection()
{
        if (proxy.get())
        {
                DEBUGPRINT(proxy->id << " Reset connection");
                VMProxy::LockedProxyData::WriteRef lock(proxy->data);
                lock->conn = 0;
        }

        if (link.get())
            RemoveEvent(&link->GetEvent());
        link.reset();
        if (vmgroup.get())
            appserver.jobmgr->AbortVMGroup(vmgroup.get());

        vmgroup.reset();

        expectmode = ExpectMode::None;
        expectsize = 0;
        datamsgid = 0;
        inbuffer.clear();
        connection_closed = false;

        EXPECTPRINT("Reset connection " << this << ", expectmode=none, enableincoming=true");
}

bool AppServerConn2::SetupScript()
{
        // Start appserver scripts with low priority (mgmt scripts have high priority)
        HareScript::VMGroup *group = appserver.jobmgr->CreateVMGroup(false);
        vmgroup.reset(group, false);

        HSVM *hsvm = appserver.scriptenv->ConstructWHVM(vmgroup.get());
        if (!HSVM_LoadScript(hsvm, appserver.GetDispatchableScript().c_str()))
        {
                //FIXME: Report the actual HareScript errors (like whrun.cpp would)
                HareScript::ErrorHandler::MessageList const &errorlist = vmgroup->GetErrorHandler().GetErrors();
                for (HareScript::ErrorHandler::MessageList::const_iterator it = errorlist.begin(); it != errorlist.end(); ++it)
                {
                        Blex::ErrStream() << "At " << it->filename << "#" << it->position.line << "#" << it->position.column;
                        Blex::ErrStream() << (it->iserror ? "Error" : "Warning") << ": " << HareScript::GetMessageString(*it) << std::endl;
                }
                DEBUGPRINT("AC: SetupScript fail");
                vmgroup.reset();
                return false;
        }

        //Initialize environment for the AppServer HS functions
//        if (!appserver.EnableDebug())
//            HSVM_SetOutputCallback(hsvm, NULL, NULL); //disable output

        std::string newid = Blex::AnyToString((void*)(long)++*AppServer::LockedConnCounter::WriteRef(appserver.conncounter));
        proxy.reset(new VMProxy(appserver, this, newid));

        //Initialize environment
        if (!appserver.EnableDebug())
            HSVM_SetOutputCallback(hsvm, NULL, NULL); //disable output
        else
            HSVM_SetOutputCallback(hsvm, proxy.get(), &AppServerConn2::VMProxy::OutputWriter); //prefix output with id

        // Termination callback to abort connection when script crashes
        appserver.jobmgr->AddTerminationCallback(group, std::bind(&AppServerConn2::VMProxy::AsyncTerminationCallback, proxy, vmgroup.get()));

        // Get an IPC link to the script, add to the dispatcher so we will be signalled when a message arrives
        appserver.jobmgr->CreateIPCLink(&link, &vmgroup->parentipclink);
        AddEvent(&link->GetEvent());

        // Send the initial message (socket info) and start the script
        SendInitialMessage(newid);

        DEBUGPRINT("Starting VMGroup " << vmgroup.get());
        appserver.jobmgr->StartVMGroup(vmgroup.get());

        return true;
}

AppServerConn2::VMProxy::VMProxy(AppServer &_appserver, AppServerConn2 *conn, std::string const &_id)
: appserver(_appserver)
, id(_id)
{
        DEBUGPRINT(id << " VMProxy " << this << " create");
//        data.SetupDebugging("VMProxy");
        buffer = id + " ";

        LockedProxyData::WriteRef lock(data);
        lock->conn = conn;
}

AppServerConn2::VMProxy::~VMProxy()
{
        DEBUGPRINT(id << " VMProxy " << this << " destroy");
}

void AppServerConn2::VMProxy::AsyncTerminationCallback(std::shared_ptr< VMProxy > const &proxy, HareScript::VMGroup *vmgroup)
{
        if (proxy->buffer.size() > proxy->id.size() + 1)
        {
                std::cout << proxy->buffer << std::endl; // Last line doesn't have \n at end
                std::cout.flush();
        }

        DEBUGPRINT(proxy->id << " VMProxy " << proxy.get() << " AsyncTerminationCallback");

        LockedProxyData::WriteRef lock(proxy->data);
        if (lock->conn)
            lock->conn->AsyncCloseConnection();

        proxy->appserver.AsyncErrorReport(proxy->id, vmgroup);
}

int AppServerConn2::VMProxy::OutputWriter(void *opaque_ptr, int numbytes, void const *data, int /*allow_partial*/, int *errorcode)
{
        VMProxy *proxy = static_cast< VMProxy * >(opaque_ptr);

//        LockedData::WriteRef lock(proxy->data);
        std::string &buffer = proxy->buffer;

        const char *data_ptr = static_cast< const char * >(data);
        buffer.insert(buffer.end(), data_ptr, data_ptr + numbytes);

        std::string::iterator lastn = buffer.begin();
        while (true)
        {
                std::string::iterator it = std::find(lastn, buffer.end(), '\n');
                if (it == buffer.end())
                    break;

                std::cout.write(&*lastn, std::distance(lastn, it) + 1);

                lastn = it - proxy->id.size();
                std::copy(proxy->id.begin(), proxy->id.end(), lastn);
                *it = ' ';
        }

        if (lastn != buffer.begin())
        {
                std::cout.flush();
                buffer.erase(buffer.begin(), lastn);
        }

        *errorcode = 0;
        return numbytes;
}

void AppServerConn2::SendInitialMessage(std::string const &scriptid)
{
        using namespace HareScript;
        stackm.RecordInitializeEmpty(composevar);

        ColumnNameId col_type = localmapper.GetMapping("TYPE");
        VarId var_type = stackm.RecordCellCreate(composevar, col_type);
        stackm.SetSTLString(var_type, "appserver-init");

        ColumnNameId col_localip = localmapper.GetMapping("LOCAL_IP");
        VarId var_localip = stackm.RecordCellCreate(composevar, col_localip);
        stackm.SetSTLString(var_localip, GetLocalAddress().GetIPAddress());

        ColumnNameId col_remoteip = localmapper.GetMapping("REMOTE_IP");
        VarId var_remoteip = stackm.RecordCellCreate(composevar, col_remoteip);
        stackm.SetSTLString(var_remoteip, GetRemoteAddress().GetIPAddress());

        ColumnNameId col_localport = localmapper.GetMapping("LOCAL_PORT");
        VarId var_localport = stackm.RecordCellCreate(composevar, col_localport);
        stackm.SetInteger(var_localport, GetLocalAddress().GetPort());

        ColumnNameId col_remoteport = localmapper.GetMapping("REMOTE_PORT");
        VarId var_remoteport = stackm.RecordCellCreate(composevar, col_remoteport);
        stackm.SetInteger(var_remoteport, GetRemoteAddress().GetPort());

        ColumnNameId col_debugmode = localmapper.GetMapping("DEBUGMODE");
        VarId var_debugmode = stackm.RecordCellCreate(composevar, col_debugmode);
        stackm.SetBoolean(var_debugmode, appserver.EnableDebug());

        ColumnNameId col_scriptid = localmapper.GetMapping("SCRIPTID");
        VarId var_scriptid = stackm.RecordCellCreate(composevar, col_scriptid);
        stackm.SetSTLString(var_scriptid, scriptid);

        std::shared_ptr< IPCMessage2 > packet;
        appserver.jobmgr->AllocateMessage(&packet);
        packet->data.reset(marshaller.WriteToNewPacket(composevar));

        DEBUGPRINT(proxy->id << " AC: Sent initial message: 'appserver-init'");

        link->SendMessage(&packet, false);
}

void AppServerConn2::SendDataMessage(uint8_t* data, uint32_t len, bool is_binary, bool complete)
{
        using namespace HareScript;
        stackm.RecordInitializeEmpty(composevar);

        ColumnNameId col_type = localmapper.GetMapping("TYPE");
        VarId var_type = stackm.RecordCellCreate(composevar, col_type);
        stackm.SetString(var_type, is_binary ? Blex::StringPair::FromStringConstant("binary")
                                             : Blex::StringPair::FromStringConstant("line"));

        ColumnNameId col_data = localmapper.GetMapping("DATA");
        VarId var_data = stackm.RecordCellCreate(composevar, col_data);
        stackm.SetString(var_data, (const char *)data, (const char *)data + len);

        HareScript::ColumnNameId col_is_complete = localmapper.GetMapping("IS_COMPLETE");
        VarId var_is_complete = stackm.RecordCellCreate(composevar, col_is_complete);
        stackm.SetBoolean(var_is_complete, complete);

        std::shared_ptr< IPCMessage2 > packet;
        appserver.jobmgr->AllocateMessage(&packet);
        packet->replyto = expectmsgid;
        packet->data.reset(marshaller.WriteToNewPacket(composevar));

        DEBUGPRINT(proxy->id << " AC: Sent data sent reply: '" << (is_binary ? "binary" : "line") << "'");

        link->SendMessage(&packet, false);
}

void AppServerConn2::SendTimeout()
{
        SendSimpleMessage("timeout", 0);
}

void AppServerConn2::SendDataSentMessage()
{
        SendSimpleMessage("datasent", datamsgid);
        datamsgid = 0;
}

void AppServerConn2::SendSimpleMessage(const char *type, uint64_t msgid)
{
        if(!link.get())
        {
                DEBUGPRINT((proxy ? proxy->id : 0) << " AC: Trying to send simple message of type '" << type << "' but there is no IPC link to receive it");
                return;
        }

        using namespace HareScript;
        stackm.RecordInitializeEmpty(composevar);

        ColumnNameId col_type = localmapper.GetMapping("TYPE");
        VarId var_type = stackm.RecordCellCreate(composevar, col_type);
        stackm.SetString(var_type, type, type + strlen(type));

        std::shared_ptr< IPCMessage2 > packet;
        appserver.jobmgr->AllocateMessage(&packet);
        packet->replyto = msgid;
        packet->data.reset(marshaller.WriteToNewPacket(composevar));

        DEBUGPRINT(proxy->id << " AC: Sent simple message '" << type << "'");

        link->SendMessage(&packet, false);
}

bool AppServerConn2::HandleInput()
{
        switch (expectmode)
        {
        case ExpectMode::Line:
                {
                        std::vector<uint8_t>::iterator linefeed=std::find(inbuffer.begin(),inbuffer.end(),'\n');
                        if (linefeed != inbuffer.end()) //Got a linefeed
                        {
                                bool have_cr = std::distance(inbuffer.begin(), linefeed) >= 1 && linefeed[-1]=='\r';
                                unsigned size = linefeed-inbuffer.begin() - (have_cr ? 1 : 0);
                                if (size > expectsize)
                                {
                                        SendDataMessage(&inbuffer[0], expectsize, false, false);
                                        inbuffer.erase(inbuffer.begin(), inbuffer.begin() + expectsize);
                                        EXPECTPRINT("HandleInput handled incomplete line for " << this << ", expectmode=none");
                                }
                                else
                                {
                                        SendDataMessage(&inbuffer[0], size, false, true);
                                        inbuffer.erase(inbuffer.begin(), linefeed+1);
                                        EXPECTPRINT("HandleInput handled line for " << this << ", expectmode=none");
                                }

                                expectmode = ExpectMode::None;
                                expectmsgid = 0;
                                return true;
                        }
                        else if (inbuffer.size() > expectsize) //Incomplete?
                        {
                                SendDataMessage(&inbuffer[0], expectsize, false, false);
                                inbuffer.erase(inbuffer.begin(), inbuffer.begin() + expectsize);

                                EXPECTPRINT("HandleInput handled incomplete line for " << this << ", expectmode=none");
                                expectmode = ExpectMode::None;
                                expectmsgid = 0;
                                return true;
                        }
                } break;
        case ExpectMode::Binary:
                {
                        if (inbuffer.size() >= expectsize)
                        {

                                SendDataMessage(&inbuffer[0], expectsize, true, true);
                                inbuffer.erase(inbuffer.begin(), inbuffer.begin() + expectsize);

                                EXPECTPRINT("HandleInput handled binary data for " << this << ", expectmode=none");
                                expectmode = ExpectMode::None;
                                expectmsgid = 0;
                                return true;
                        }
                } break;
        default: ;
        }
        return false;
}

void AppServerConn2::EnableInputForExpect()
{
        if (!connection_closed)
        {
                EnableIncomingData(true);
                EXPECTPRINT("EnableInputForExpect " << this << ", expectmode=" << expectmode << ", enableincoming=true");
        }
        else
        {
                EXPECTPRINT("EnableInputForExpect  " << this << ", expectmode=" << expectmode << ", enableincoming=true - on closed connection, ignoring");
        }
}

bool AppServerConn2::HandleMessage(HareScript::IPCMessage2 &msg)
{
        using namespace HareScript;
        try
        {
                marshaller.ReadMarshalPacket(msgvar, &msg.data);

                if (stackm.GetType(msgvar) != VariableTypes::Record)
                    return false;

                ColumnNameId col_type = localmapper.GetMapping("TYPE");
                VarId var_type = stackm.RecordCellGetByName(msgvar, col_type);
                if (!var_type || stackm.GetType(var_type) != VariableTypes::String)
                    return false;

                Blex::StringPair type = stackm.GetString(var_type);
                if (type == Blex::StringPair::FromStringConstant("expectline") || type == Blex::StringPair::FromStringConstant("expectbinary"))
                {
                        ColumnNameId col_size = localmapper.GetMapping("SIZE");
                        VarId var_size = stackm.RecordCellGetByName(msgvar, col_size);
                        if (!var_size || stackm.GetType(var_size) != VariableTypes::Integer)
                            return false;

                        int32_t size = stackm.GetInteger(var_size);

                        DEBUGPRINT(proxy->id << " AC: Incoming message '" << type << "', size: " << size);

                        expectmode = type == Blex::StringPair::FromStringConstant("expectline") ? ExpectMode::Line : ExpectMode::Binary;
                        EXPECTPRINT("Got expect XXX for " << this << ", expectmode=" << expectmode);
                        expectsize = size;
                        expectmsgid = msg.msgid;

                        // Check if current data buffer has requested data, and execute. If not: ask for more data
                        if (!HandleInput())
                            EnableInputForExpect();
                }
                else if (type == Blex::StringPair::FromStringConstant("send"))
                {
                        ColumnNameId col_data = localmapper.GetMapping("DATA");
                        VarId var_data = stackm.RecordCellGetByName(msgvar, col_data);
                        if (!var_data || stackm.GetType(var_data) != VariableTypes::String)
                            return false;

                        bool delay_sender = buffer.GetTotalSize() >= 65536;

                        Blex::StringPair data = stackm.GetString(var_data);
                        buffer.StoreData(data.begin, data.size());

                        DEBUGPRINT(proxy->id << " AC: Incoming message '" << type << "', data size: " << data.size());

                        senddata.clear();
                        buffer.AddToQueue(&senddata);
                        AsyncQueueSend(senddata.size(),&senddata[0]);

                        datamsgid = msg.msgid;
                        if (!delay_sender)
                        {
                                EXPECTPRINT("Small data sent, not delaying input " << this);
                                EnableInputForExpect();
                        }
                }
                else if (type == "disconnect")
                {
                        DEBUGPRINT(proxy->id << " AC: Incoming message '" << type << "'");
                        AsyncCloseConnection();
                }
                else
                {
                        Blex::ErrStream() << "Appserver control got unknown message, type: '" << type.stl_str() << "'";
                        AsyncCloseConnection();
                }
        }
        catch (VMRuntimeError &e)
        {
                DEBUGPRINT(proxy->id << " AC: Exception: " << e.what());
                return false;
        }
        return true;
}

void AppServerConn2::HookIncomingData(uint8_t const *start, unsigned numbytes)
{
        // Expectmode may be None, because we enable incoming data after small sends

        // Grab as much data as we can, and say it is has been eaten
        inbuffer.insert(inbuffer.end(), start, start+numbytes);
        ClearIncomingData(numbytes);

        if (HandleInput())
        {
                // Input was accepted. Disable more incoming data until a new expect is issued.
                EXPECTPRINT("HandleInput returned TRUE for " << this << ", expectmode=" << expectmode << ", enableincoming=false");
                EnableIncomingData(false);
        }
}

void AppServerConn2::HookSignal(Blex::Dispatcher::Signals::SignalType signal)
{
        switch(signal)
        {
        case Blex::Dispatcher::Signals::GotEOF:
                {
                        if (!connection_closed)
                        {
                                EXPECTPRINT("Got signal EOF " << this << ", expectmode=" << expectmode << " - sending clientdisconnect");
                                SendSimpleMessage("clientdisconnect", 0);
                        }
                        else
                        {
                                EXPECTPRINT("Got signal EOF" << this << " on already closed connection, expectmode=" << expectmode);
                        }
                        connection_closed = true;
                } break;

        case Blex::Dispatcher::Signals::ConnectionClosed:
                {
                        if (!connection_closed)
                        {
                                EXPECTPRINT("Got signal ConnectionClose " << this << ", expectmode=" << expectmode << " - sending clientdisconnect");
                                SendSimpleMessage("clientdisconnect", 0);
                        }
                        connection_closed = true;
                        ResetConnection();
                }break;

        case Blex::Dispatcher::Signals::NewConnection:
                if (!SetupScript())
                {
                        Blex::ErrStream() << "Script encountered an error";
                        ResetConnection();
                        AsyncCloseConnection();
                        return;
                }

                // Don't accept data until script explicitly say so.
                EXPECTPRINT("New connection: " << this << ", expectmode=" << expectmode << ", enableincoming=false");
                EnableIncomingData(false);
                break;
        default: ; // Ignore other signals
        }
}

void AppServerConn2::HookDataBlocksSent(unsigned numblocks)
{
        buffer.MarkBuffersSent(numblocks);

        if (datamsgid != 0 && buffer.GetTotalSize() < 65536)
            SendDataSentMessage();
}

bool AppServerConn2::HookExecuteTask(Blex::Dispatcher::Task */*task*/)
{
        return false;
}

void AppServerConn2::HookEventSignalled(Blex::Event */*event*/)
{
        // Incoming message from the script!
        std::shared_ptr< HareScript::IPCMessage2 > msg;
        while (link->ReceiveMessage(&msg))
        {
                if (!HandleMessage(*msg))
                    AsyncCloseConnection();

                appserver.jobmgr->DiscardMessage(&msg);
        }
        if (link->IsBroken())
            RemoveEvent(&link->GetEvent());
}

//////////////////////////////////////////////////////////////////////////////
//
// AppServer main application
//

AppServer::AppServer()
: dispatcher(std::bind(&AppServer::CreateConnection,this,std::placeholders::_1))
{
        *LockedConnCounter::WriteRef(conncounter) = 0;
}

AppServer::~AppServer()
{
}

Blex::Dispatcher::Connection *AppServer::CreateConnection(void *dispat)
{
        return new AppServerConn2(*this,dispat);
}

int AppServer::Execute (std::vector<std::string> const &args)
{
        Blex::OptionParser::Option optionlist[] =
        { Blex::OptionParser::Option::Switch("d", false)
        , Blex::OptionParser::Option::StringOpt("secure")
        , Blex::OptionParser::Option::StringList("listenport")
        , Blex::OptionParser::Option::StringOpt("jobs")
        , Blex::OptionParser::Option::StringOpt("workers")
        , Blex::OptionParser::Option::Param("script", true)
        , Blex::OptionParser::Option::ListEnd()
        };

        Blex::OptionParser optparse(optionlist);
        WHCore::Connection::AddOptions(optparse);

        if (!optparse.Parse(args) || !optparse.Exists("listenport"))
        {
                Blex::ErrStream() << optparse.GetErrorDescription();
                return EXIT_FAILURE;
        }

        debug = optparse.Switch("d");
        webhare.reset(new WHCore::Connection(optparse, "appserver", WHCore::WHManagerConnectionType::RequireConnected));
        scriptenv.reset(new WHCore::ScriptEnvironment(*webhare, CompilationPriority::ClassInteractive, false, false));

        unsigned numjobs = optparse.Exists("jobs") ? std::atoi(optparse.StringOpt("jobs").c_str()) : 6;
        unsigned numdispatchers = optparse.Exists("workers") ? std::atoi(optparse.StringOpt("workers").c_str()) : 5;

        jobmgr.reset(new HareScript::JobManager(scriptenv->GetEnvironment()));
        unsigned numreservedhighpriority = std::min(numjobs / 5, 3u);
        jobmgr->Start(numjobs, numreservedhighpriority); // Start with 20 worker threads. FIXME: rational number please

        jobmgrintegrator.reset(new WHCore::JobManagerIntegrator(*scriptenv, *webhare, jobmgr.get()));

        for(unsigned i=0;i<optparse.StringList("listenport").size();++i)
        {
                Blex::Dispatcher::ListenAddress addy;

                //Decode as raw port first
                std::string listenport = optparse.StringList("listenport")[i];
                std::pair<unsigned, std::string::const_iterator> port = Blex::DecodeUnsignedNumber<unsigned>(listenport.begin(), listenport.end());
                if(port.first >= 1 && port.first <= 65535 && port.second == listenport.end())
                {
                        //Backwards compatiblity, create a IPv4 listener
                        addy.sockaddr.SetIPAddress("0.0.0.0");
                        addy.sockaddr.SetPort(port.first);
                }
                else
                {
                        addy.sockaddr = Blex::SocketAddress(listenport);
                }

                if (optparse.Exists("secure"))
                {
                        std::string keyfilename = optparse.StringOpt("secure");
                        std::string keyfilestore = webhare->GetModuleFolder("system");

                        if(!keyfilestore.empty())
                        {
                                std::unique_ptr< Blex::FileStream > keyfile, certfile;

                                std::string keyfilepath, certfilepath;

                                if (keyfilename.find('/') == std::string::npos)
                                {
                                        // No '/'? Assume the keyfile is in the system module
                                        keyfilepath = keyfilestore + "keys/" + keyfilename + ".key";
                                        certfilepath = keyfilestore + "keys/" + keyfilename + ".crt";
                                }
                                else
                                {
                                        // Assume the parameter is a path to the keyfile, and the cert is
                                        // found by replacing the last extension with .crt
                                        keyfilepath = keyfilename;
                                        signed pos = keyfilename.find_last_of(".");
                                        if (pos != -1)
                                            certfilepath = keyfilename.substr(0, pos) + ".crt";
                                        else
                                            certfilepath = keyfilename + ".crt";
                                }

                                keyfile.reset(Blex::FileStream::OpenRead(keyfilepath));
                                certfile.reset(Blex::FileStream::OpenRead(certfilepath));

                                if (keyfile.get() && certfile.get())
                                {
                                        addy.privatekey = ReadStreamAsString(*keyfile);
                                        addy.certificatechain = ReadStreamAsString(*certfile);
                                }
                        }
                }
                listenaddresses.push_back(addy);
        }

        this->StartManagementScript();

        script = optparse.Param("script");

        Blex::SetInterruptHandler(std::bind(&Blex::Dispatcher::Dispatcher::InterruptHandler,&dispatcher,std::placeholders::_1), false);
        dispatcher.UpdateListenPorts(listenaddresses.size(),&listenaddresses[0]);

        if(!dispatcher.RebindSockets(NULL))
        {
                Blex::ErrStream()<<"Unable to bind to the specified port\n";
                jobmgr->Shutdown();
                return 1;
        }
        dispatcher.Start(numdispatchers, 0, true);
        jobmgr->Shutdown();
        webhare->FlushManagerQueue();
        Blex::ResetInterruptHandler();
        return 0;
}

void AppServer::AsyncErrorReport(std::string const &id, HareScript::VMGroup *vmgroup)
{
        HSVM *hsvm = *vmgroup->GetCurrentVM();
        HareScript::ErrorHandler const &errorhandler = vmgroup->GetErrorHandler();

        if (!errorhandler.AnyErrors() && !errorhandler.AnyWarnings())
            return;

        for (std::list<HareScript::Message>::const_iterator it = errorhandler.GetWarnings().begin(); it != errorhandler.GetWarnings().end(); ++it)
            DisplayMessage(scriptenv->GetFileSystem(), &HareScript::GetVirtualMachine(hsvm)->GetContextKeeper(), *it);

        for (std::list<HareScript::Message>::const_iterator it = errorhandler.GetErrors().begin(); it != errorhandler.GetErrors().end(); ++it)
            DisplayMessage(scriptenv->GetFileSystem(),& HareScript::GetVirtualMachine(hsvm)->GetContextKeeper(), *it);

        for (HareScript::ErrorHandler::StackTrace::const_iterator itr=errorhandler.GetStackTrace().begin(); itr!=errorhandler.GetStackTrace().end();++itr)
            DisplayStackLocation(scriptenv->GetFileSystem(), &HareScript::GetVirtualMachine(hsvm)->GetContextKeeper(),*itr);

        std::map< std::string, std::string > params;
        params["script"] = Blex::AnyToJSON(id.empty() ? std::string("modulescript::system/internal/appserver/manager.whscr") : script);
        params["contextinfo"] = Blex::AnyToJSON(jobmgr->GetGroupErrorContextInfo(vmgroup));
        LogHarescriptError(*webhare, "appserver", jobmgr->GetGroupId(vmgroup), jobmgr->GetGroupExternalSessionData(vmgroup), errorhandler, params);
}

void AppServer::StartManagementScript()
{
        HareScript::VMGroup *group = jobmgr->CreateVMGroup(true);

        HareScript::VMGroupRef vmgroup;
        vmgroup.reset(group, false);

        HSVM *hsvm = group->CreateVirtualMachine();
        HareScript::SQLLib::WHDB::SetWHDBProviderDefaultClientName(hsvm, "appserver management");
        HSVM_SetOutputCallback(hsvm, 0, &WHCore::StandardErrorWriter);
        HSVM_SetErrorCallback(hsvm, 0, &WHCore::StandardErrorWriter);

        // FIXME: set current script name (setcurrentfile on errorhandler)
        if (!HSVM_LoadScript(hsvm, "modulescript::system/internal/appserver/manager.whscr"))
        {
                Blex::ErrStream() << "Errors loading appserver management script, terminating appserver\n";
                AsyncErrorReport("", group);
                Blex::FatalAbort();
        }

        // Ignore the callback handle result, don't need to revoke it
        jobmgr->AddTerminationCallback(group, std::bind(&AppServer::ManagementScriptTerminated, this, group));
        jobmgr->StartVMGroup(group);
}

void AppServer::ManagementScriptTerminated(HareScript::VMGroup *group)
{
        if (jobmgr->IsRunning())
        {
                Blex::ErrStream() << "Errors loading appserver management script";
                AsyncErrorReport("", group);

                Blex::SleepThread(1000);
                StartManagementScript();
        }
}

int UTF8Main(std::vector<std::string> const &args)
{
        AppServer myserver;
        int ret=myserver.Execute(args);
        return ret;
}

int main(int argc, char *argv[])
{
        return Blex::InvokeMyMain(argc,argv,&UTF8Main);
}
