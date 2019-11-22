#include <ap/libwebhare/allincludes.h>

#include <blex/path.h>
#include <blex/logfile.h>
#include <blex/getopt.h>
#include <blex/utils.h>

#include <ap/libwebhare/whrpc_server.h>

#include "whmgrmain.h"


// -----------------------------------------------------------------------------
//
// Definitions
//

namespace
{
static const char *debugmgr_internalport = "wh:debugmgr_internal";

} // End of anonymous namespace

// -----------------------------------------------------------------------------
//
// NamedPort
//

NamedPort::NamedPort(Connection *_conn, std::string const &_name)
: conn(_conn)
, name(_name)
{
}

NamedPort::~NamedPort()
{
}

// -----------------------------------------------------------------------------
//
// Link
//

std::pair< Connection *, uint32_t > Link::GetOther(Connection *me, uint32_t mylinkid)
{
        if (me == init && init_linkid == mylinkid)
            return std::make_pair(target, target_linkid);
        else if (me == target && target_linkid == mylinkid)
            return std::make_pair(init, init_linkid);

        throw Database::Exception(Database::ErrorWriteAccessDenied, "No permission to access links that you are not an endpoint of!");
}

Connection::Connection(WHManager *_manager, void*data)
: Database::RPCConnection(data)
, manager(_manager)
{
        linkcounter = 0x80000000;
        processcode = 0;
}

Connection::~Connection()
{
        CleanUpConnection();
}

std::string Connection::GetRequestOpcodeName(uint8_t code)
{
        switch (code)
        {
        case WHMRequestOpcode::SendEvent:               return "SendEvent";
        case WHMRequestOpcode::RegisterPort:            return "RegisterPort";
        case WHMRequestOpcode::UnregisterPort:          return "UnregisterPort";
        case WHMRequestOpcode::ConnectLink:             return "ConnectLink";
        case WHMRequestOpcode::DisconnectLink:          return "DisconnectLink";
        case WHMRequestOpcode::SendMessageOverLink:     return "SendMessageOverLink";
        case WHMRequestOpcode::OpenLinkResult:          return "OpenLinkResult";
        case WHMRequestOpcode::RegisterProcess:         return "RegisterProcess";
        case WHMRequestOpcode::GetProcessList:          return "GetProcessList";
        case WHMRequestOpcode::ConfigureLogs:           return "ConfigureLogs";
        case WHMRequestOpcode::Log:                     return "Log";
        case WHMRequestOpcode::Disconnect:              return "Disconnect";
        case WHMRequestOpcode::SetSystemConfig:         return "SetSystemConfig";
        default:
            return "Unknown request opcode";
        }
}

std::string Connection::GetResponseOpcodeName(uint8_t code)
{
        switch (code)
        {
        case WHMResponseOpcode::Answer:                 return "Answer";
        case WHMResponseOpcode::IncomingEvent:          return "IncomingEvent";
        case WHMResponseOpcode::RegisterPortResult:     return "RegisterPortResult";
        case WHMResponseOpcode::OpenLink:               return "OpenLink";
        case WHMResponseOpcode::ConnectLinkResult:      return "ConnectLinkResult";
        case WHMResponseOpcode::LinkClosed:             return "LinkClosed";
        case WHMResponseOpcode::IncomingMessage:        return "IncomingMessage";
        case WHMResponseOpcode::RegisterProcessResult:  return "RegisterProcessResult";
        case WHMResponseOpcode::GetProcessListResult:   return "GetProcessListResult";
        case WHMResponseOpcode::ConfigureLogsResult:    return "ConfigureLogsResult";
        case WHMResponseOpcode::FlushLogResult:         return "FlushLogResult";
        case WHMResponseOpcode::SystemConfig:           return "SystemConfig";
        default:
            return "Unknown response opcode";
        }
}


void Connection::CleanUpConnection()
{
        DEBUGPRINT("CleanUpConnection conn " << this);

        linkcounter = 0x80000000;

        bool removed_debugger = false;

        // Make sure all ports are inaccessible
        {
                WHManager::LockedData::WriteRef lock(manager->data);

                lock->processes.erase(processcode);

                for (std::map< std::string, std::shared_ptr< NamedPort > >::iterator it = ports.begin(); it != ports.end(); ++it)
                {
                        if (it->first == debugmgr_internalport)
                            removed_debugger = true;
                        lock->ports.erase(it->first);
                }

                for (std::map< uint64_t, std::shared_ptr< Link > >::iterator it = lock->links.begin(); it != lock->links.end();)
                {
                        Connection *other(0);
                        uint64_t linkid(0);

                        if ((it->second->init != this) && (it->second->target != this))
                        {
                                ++it;
                                continue;
                        }

                        if (it->second->init == this)
                        {
                                it->second->init = 0;
                                other = it->second->target;
                                linkid = it->second->target_linkid;
                        }
                        if (it->second->target == this)
                        {
                                it->second->target = 0;
                                other = it->second->init;
                                linkid = it->second->init_linkid;
                        }
                        // If init == target == this then other = 0
                        if (other)
                        {
                                std::unique_ptr< LinkClosedTask > task;
                                task.reset(new LinkClosedTask(other));
                                task->targetlinkid = linkid;

                                std::unique_ptr< Database::RPCTask > rpctask;
                                rpctask.reset(task.release());

                                DEBUGPRINT("Conn " << this << " scheduling task LinkClosedTask on " << other << ", target_linkid: " << linkid << " localid: " << it->first);
                                QueueRemoteTask(other, rpctask, false);
                        }

                        DEBUGPRINT("Conn " << this << " deleting link " << it->first << " upon cleanup");
                        lock->links.erase(it++);
                }

                DEBUGPRINT("Unregistering connection " << this);
                lock->connections.erase(this);
        }

        DumpRemoteToLocalId("Connection cleanup");

        // Clear the remote to local id mappings
        remotetolocalid.clear();

        // Clear local ports
        ports.clear();

        // Clear the process code
        processcode = 0;

        // If changed, broadcast new debugger status to other connections
        if (removed_debugger)
            BroadcastSystemConfig();
}

void Connection::BroadcastSystemConfig()
{
        WHManager::LockedData::WriteRef lock(manager->data);

        Connection *debuggerconnection = 0;
        std::map< std::string, NamedPort * >::iterator portit = lock->ports.find(debugmgr_internalport);
        if (portit != lock->ports.end())
            debuggerconnection = portit->second->conn;

        for (std::set< Connection * >::iterator it = lock->connections.begin(); it != lock->connections.end(); ++it)
        {
                // Don't give debugger 'live' status to process with debugmanager
                bool have_debugger = debuggerconnection && debuggerconnection != *it;

                std::unique_ptr< SystemConfigTask > task;
                task.reset(new SystemConfigTask(*it, have_debugger, lock->systemconfig));

                std::unique_ptr< Database::RPCTask > rpctask;
                rpctask.reset(task.release());

                DEBUGPRINT("Conn " << this << " scheduling task SystemConfigTask on " << *it);
                QueueRemoteTask(*it, rpctask, false);
        }

}


void Connection::HookIncomingConnection()
{
        DEBUGPRINT("Registering connection " << this);
        WHManager::LockedData::WriteRef(manager->data)->connections.insert(this);
}

void Connection::HookPrepareForUse()
{
}

void Connection::HookDisconnectReceived(Blex::Dispatcher::Signals::SignalType DEBUGONLYARG(signal))
{
        DEBUGPRINT("Conn " << this << " Receive disconnect signal " << Blex::Dispatcher::Signals::GetName(signal));

        CleanUpConnection();
}


Database::RPCResponse::Type Connection::HookSignalled(Database::IOBuffer */*iobuf*/)
{
        return Database::RPCResponse::DontRespond;
}


Database::RPCResponse::Type Connection::HookTimeOut(Database::IOBuffer */*iobuf*/, bool /*fatal*/)
{
        return Database::RPCResponse::DontRespond;
}


Database::RPCResponse::Type Connection::HookHandleMessage(Database::IOBuffer *iobuf)
{
        Database::RPCResponse::Type responsetype;
        try
        {
                WHMRequestOpcode::Type opcode = (WHMRequestOpcode::Type)iobuf->GetOpcode();
                if (iobuf->GetRawLength()<Database::IOBuffer::HeaderSize
                    || opcode > WHMRequestOpcode::_max)
                    throw Database::Exception(Database::ErrorProtocol, "Invalid RPC call, opcode " + Blex::AnyToString(static_cast< unsigned >(opcode)));

                iobuf->ResetReadPointer();

                switch (opcode)
                {
                case WHMRequestOpcode::SendEvent:       responsetype = RemoteSendEvent(iobuf); break;
                case WHMRequestOpcode::RegisterPort:    responsetype = RemoteRegisterPort(iobuf); break;
                case WHMRequestOpcode::UnregisterPort:  responsetype = RemoteUnregisterPort(iobuf); break;
                case WHMRequestOpcode::ConnectLink:     responsetype = RemoteConnectLink(iobuf); break;
                case WHMRequestOpcode::DisconnectLink:  responsetype = RemoteDisconnectLink(iobuf); break;
                case WHMRequestOpcode::SendMessageOverLink: responsetype = RemoteSendMessageOverLink(iobuf); break;
                case WHMRequestOpcode::OpenLinkResult:  responsetype = RemoteOpenLinkResult(iobuf); break;
                case WHMRequestOpcode::RegisterProcess: responsetype = RemoteRegisterProcess(iobuf); break;
                case WHMRequestOpcode::GetProcessList:  responsetype = RemoteGetProcessList(iobuf); break;
                case WHMRequestOpcode::ConfigureLogs:   responsetype = RemoteConfigureLogs(iobuf); break;
                case WHMRequestOpcode::Log:             responsetype = RemoteLog(iobuf); break;
                case WHMRequestOpcode::Disconnect:      responsetype = RemoteDisconnect(iobuf); break;
                case WHMRequestOpcode::FlushLog:        responsetype = RemoteFlushLog(iobuf); break;
                case WHMRequestOpcode::SetSystemConfig: responsetype = RemoteSetSystemConfig(iobuf); break;
                default:
                    throw Database::Exception(Database::ErrorProtocol, "Unknown RPC opcode");
                }

//                if (responsetype != Database::RPCResponse::DontRespond && responsetype != Database::RPCResponse::Retry && responsetype != Database::RPCResponse::RespondAsync)
//                    iobuf->FinishForReplying(false); //all went ok
        }
        catch (Database::Exception &except)
        {
                iobuf->ResetForSending();
                iobuf->Write<uint32_t>(except.errorcode);
                iobuf->WriteBinary(strlen(except.what()), (uint8_t const *)except.what());

                responsetype = Database::RPCResponse::Respond;
                iobuf->FinishForReplying(true); //exception!
        }
        return responsetype;
}

Database::RPCResponse::Type Connection::RemoteSendEvent(Database::IOBuffer *iobuf)
{
        DumpRemoteToLocalId("RemoteSendEvent");

        std::string eventname;
        Blex::SemiStaticPodVector< uint8_t, 1024 > msg;

        iobuf->ReadIn(&eventname);
        std::pair<uint8_t const*, uint8_t const*> msgbuf = iobuf->ReadBinary();
        msg.assign(msgbuf.first, msgbuf.second);

        DEBUGPRINT("Conn " << this << " Incoming RPC RemoteSendEvent, event: '" << eventname << "'");

        {
                WHManager::LockedData::WriteRef lock(manager->data);

                for (std::set< Connection * >::iterator it = lock->connections.begin(); it != lock->connections.end(); ++it)
                {
                        if (*it == this)
                            continue;

                        std::unique_ptr< EventTask > task;
                        task.reset(new EventTask(*it));
                        task->eventname = eventname;
                        task->msg = msg;

                        std::unique_ptr< Database::RPCTask > rpctask;
                        rpctask.reset(task.release());

                        DEBUGPRINT("Conn " << this << " scheduling task EventTask on " << *it << ", eventname: " << eventname);
                        QueueRemoteTask(*it, rpctask, false);
                }
        }

        return Database::RPCResponse::DontRespond;
}

Database::RPCResponse::Type Connection::RemoteRegisterPort(Database::IOBuffer *iobuf)
{
        std::string portname;
        uint32_t connid;
        uint64_t msgid;

        iobuf->ReadIn(&portname);
        iobuf->ReadIn(&connid);
        iobuf->ReadIn(&msgid);

        DEBUGPRINT("Conn " << this << " Incoming RPC RemoteRegisterPort, port: '" << portname << "', connid: " << connid << ", msgid: " << msgid);

        bool exists = false;
        {
                WHManager::LockedData::WriteRef lock(manager->data);

                exists = lock->ports.count(portname);
                if (!exists)
                {
                        std::shared_ptr< NamedPort > port;
                        port.reset(new NamedPort(this, portname));

                        ports[portname] = port;
                        lock->ports[portname] = port.get();
                }
        }

        if (!exists && portname == debugmgr_internalport)
            BroadcastSystemConfig();

        iobuf->ResetForSending();

        iobuf->Write(portname);
        iobuf->Write(connid);
        iobuf->Write(msgid);
        iobuf->Write(!exists);

        iobuf->FinishForRequesting(WHMResponseOpcode::RegisterPortResult);

        DEBUGPRINT("Conn " << this << " Sending RPC RegisterPortResult, portname: " << portname << ", connid: " << connid << ", msgid: " << msgid << ", success: " << !exists);

        return Database::RPCResponse::Respond;
}


Database::RPCResponse::Type Connection::RemoteUnregisterPort(Database::IOBuffer *iobuf)
{
        std::string portname;
        uint32_t connid;
        uint64_t msgid;
        bool respond;

        iobuf->ReadIn(&portname);
        iobuf->ReadIn(&connid);
        iobuf->ReadIn(&msgid);
        iobuf->ReadIn(&respond);

        DEBUGPRINT("Conn " << this << " Incoming RPC RemoteUnregisterPort, port: '" << portname << "', connid: " << connid << ", msgid: " << msgid << ", respond: " << respond);

        bool exists = false;
        if (ports.count(portname))
        {
                exists = true;

                WHManager::LockedData::WriteRef lock(manager->data);

                ports.erase(portname);
                lock->ports.erase(portname);
        }

        if (exists && portname == debugmgr_internalport)
            BroadcastSystemConfig();

        if (respond)
        {
                iobuf->ResetForSending();

                iobuf->Write(portname);
                iobuf->Write(connid);
                iobuf->Write(msgid);

                iobuf->FinishForRequesting(WHMResponseOpcode::UnregisterPortResult);

                DEBUGPRINT("Conn " << this << " Sending RPC UnregisterPortResult, portname: " << portname << ", connid: " << connid << ", msgid: " << msgid);

                return Database::RPCResponse::Respond;
        }
        else
        {
                return Database::RPCResponse::DontRespond;
        }
}


Database::RPCResponse::Type Connection::RemoteConnectLink(Database::IOBuffer *iobuf)
{
        DumpRemoteToLocalId("RemoteConnectLink");

        std::string portname;
        uint32_t init_linkid;
        uint64_t msgid;

        iobuf->ReadIn(&portname);
        iobuf->ReadIn(&init_linkid);
        iobuf->ReadIn(&msgid);

        std::shared_ptr< Link > link;
        link.reset(new Link);
        link->init_linkid = init_linkid;
        link->init = this;

        std::unique_ptr< LinkOpenedTask > task;
        task.reset(new LinkOpenedTask(0));
        task->portname = portname;
        task->msgid = msgid;

        DEBUGPRINT("Conn " << this << " Incoming RPC RemoteConnectLink, port: '" << portname << "', linkid: " << init_linkid << ", msgid: " << msgid);

        {
                WHManager::LockedData::WriteRef lock(manager->data);

                std::map< std::string, NamedPort * >::iterator portit = lock->ports.find(portname);
                if (portit == lock->ports.end())
                {
                        iobuf->ResetForSending();
                        iobuf->Write(init_linkid);
                        iobuf->Write(msgid);
                        iobuf->Write(false);
                        iobuf->FinishForRequesting(WHMResponseOpcode::ConnectLinkResult);
                        DEBUGPRINT("Sending RPC OpenLinkResult, linkid: " << init_linkid << ", replyto: " << msgid << ", success: false");
                        return Database::RPCResponse::Respond;
                }

                link->target = portit->second->conn;
                link->locallinkid = ++lock->linkidcounter;

                task->target = link->target;
                task->locallinkid = link->locallinkid;

                DEBUGPRINT("Conn " << this << " inserting link " << link->locallinkid);
                lock->links.insert(std::make_pair(link->locallinkid, link));
                remotetolocalid[ init_linkid ] = link->locallinkid;

                std::unique_ptr< Database::RPCTask > rpctask;
                rpctask.reset(task.release());

                DumpRemoteToLocalId("RemoteConnectLink: update");
                DEBUGPRINT("Conn " << this << " scheduling task LinkOpenedTask on " << link->target << ", initid " << init_linkid << " localid: " << link->locallinkid);
                QueueRemoteTask(link->target, rpctask, false);
        }

/*
        iobuf->ResetForSending();
        iobuf->Write(link->init_linkid);

        iobuf->FinishForReplying(false);
*/
        return Database::RPCResponse::DontRespond;
}


Database::RPCResponse::Type Connection::RemoteDisconnectLink(Database::IOBuffer *iobuf)
{
        DumpRemoteToLocalId("RemoteDisconnectLink");
        uint32_t linkid = iobuf->Read< uint32_t >();

        std::map< uint32_t, uint64_t >::iterator lit = remotetolocalid.find(linkid);
        if (lit == remotetolocalid.end())
            return Database::RPCResponse::DontRespond;

        uint64_t locallinkid = lit->second;
        remotetolocalid.erase(lit);

        DumpRemoteToLocalId("RemoteDisconnectLink: update");

        std::unique_ptr< LinkClosedTask > task;
        task.reset(new LinkClosedTask(0));

        DEBUGPRINT("Conn " << this << " Incoming RPC RemoteDisconnectLink, targetlinkid: " << linkid << " (local: " << locallinkid << ")");

        {
                WHManager::LockedData::WriteRef lock(manager->data);

                std::map< uint64_t, std::shared_ptr< Link > >::iterator it = lock->links.find(locallinkid);
                if (it == lock->links.end())
                {
                        DEBUGPRINT(" Link already gone");
                        return Database::RPCResponse::DontRespond;
                }

                std::pair< Connection *, uint32_t > other = it->second->GetOther(this, linkid);
                if (other.first)
                {
                        task->target = other.first;
                        task->targetlinkid = other.second;

                        std::unique_ptr< Database::RPCTask > rpctask;
                        rpctask.reset(task.release());

                        DEBUGPRINT("Conn " << this << " scheduling task LinkClosedTask on " << other.first << ", target linkid " << other.second << " localid: " << locallinkid);
                        QueueRemoteTask(other.first, rpctask, false);
                }

                DEBUGPRINT("Conn " << this << " deleting link " << it->first << " upon RemoteDisconnect");
                lock->links.erase(it);
        }

        return Database::RPCResponse::DontRespond;
}


Database::RPCResponse::Type Connection::RemoteSendMessageOverLink(Database::IOBuffer *iobuf)
{
        DumpRemoteToLocalId("RemoteSendMessageOverLink");

        uint32_t linkid = iobuf->Read< uint32_t >();
        uint64_t msgid = iobuf->Read< uint64_t >();
        uint64_t replyto = iobuf->Read< uint64_t >();
        bool lastpart = iobuf->Read< bool >();
        std::pair<uint8_t const*, uint8_t const*> msgbuf = iobuf->ReadBinary();

        std::map< uint32_t, uint64_t >::iterator lit = remotetolocalid.find(linkid);
        if (lit == remotetolocalid.end())
            return Database::RPCResponse::DontRespond;

        uint64_t locallinkid = lit->second;

        DEBUGPRINT("Conn " << this << " Incoming RPC RemoteSendMessageOverLink, targetlinkid: " << linkid << " (local: " << locallinkid << "), msgid: " << msgid << ", replyto " << replyto);

        std::unique_ptr< MessageTask > task;
        task.reset(new MessageTask);

        {
                WHManager::LockedData::WriteRef lock(manager->data);

                std::map< uint64_t, std::shared_ptr< Link > >::iterator it = lock->links.find(locallinkid);
                if (it == lock->links.end())
                {
                        DEBUGPRINT(" Link gone");
                        return Database::RPCResponse::DontRespond;
                }

                std::pair< Connection *, uint32_t > other = it->second->GetOther(this, linkid);

                if (other.first)
                {
                        task->target = other.first;
                        task->targetlinkid = other.second;
                        task->msgid = msgid;
                        task->replyto = replyto;
                        task->lastpart = lastpart;
                        task->msg.assign(msgbuf.first, msgbuf.second);

                        std::unique_ptr< Database::RPCTask > rpctask;
                        rpctask.reset(task.release());

                        DEBUGPRINT("Conn " << this << " scheduling task MessageTask on " << other.first << ", target linkid " << other.second << " localid: " << locallinkid << " msgid: " << msgid << " replyto: " << replyto);
                        QueueRemoteTask(other.first, rpctask, false);
                }
        }
        return Database::RPCResponse::DontRespond;
}

Database::RPCResponse::Type Connection::RemoteOpenLinkResult(Database::IOBuffer *iobuf)
{
        DumpRemoteToLocalId("RemoteOpenLinkResult");

        uint32_t linkid = iobuf->Read< uint32_t >();
        uint64_t replyto = iobuf->Read< uint64_t >();
        bool success = iobuf->Read< bool >();

        std::map< uint32_t, uint64_t >::iterator lit = remotetolocalid.find(linkid);
        if (lit == remotetolocalid.end())
            return Database::RPCResponse::DontRespond;

        uint64_t locallinkid = lit->second;

        DEBUGPRINT("Conn " << this << " Incoming RPC OpenLinkResult, targetlinkid: " << linkid << " (local: " << locallinkid << "), replyto: " << replyto);

        std::unique_ptr< LinkEstablishedTask > task;
        task.reset(new LinkEstablishedTask);
        task->replyto = replyto;
        task->success = success;

        {
                WHManager::LockedData::WriteRef lock(manager->data);

                std::map< uint64_t, std::shared_ptr< Link > >::iterator it = lock->links.find(locallinkid);
                if (it == lock->links.end())
                {
                        DEBUGPRINT(" Link gone");
                        return Database::RPCResponse::DontRespond;
                }

                std::pair< Connection *, uint32_t > other = it->second->GetOther(this, linkid);
                if (other.first)
                {
                        task->targetlinkid = other.second;
                        task->target = other.first;

                        std::unique_ptr< Database::RPCTask > rpctask;
                        rpctask.reset(task.release());

                        DEBUGPRINT("Conn " << this << " scheduling task LinkEstablishedTask on " << other.first << ", target linkid " << other.second << " localid: " << locallinkid);
                        QueueRemoteTask(other.first, rpctask, false);
                }
        }
        return Database::RPCResponse::DontRespond;
}

Database::RPCResponse::Type Connection::RemoteRegisterProcess(Database::IOBuffer *iobuf)
{
        processcode = iobuf->Read< uint64_t >(); // Ignored
        std::string name = iobuf->Read< std::string >();

        DEBUGPRINT("Conn " << this << " Incoming RPC RegisterProcess, processcode: " << processcode << ", name: '" << name << "'");

        bool have_debugger;
        std::shared_ptr< Blex::PodVector< uint8_t > > systemconfig;

        {
                WHManager::LockedData::WriteRef lock(manager->data);

                processcode = ++lock->processcodecounter;

                have_debugger = false;
                std::map< std::string, NamedPort * >::const_iterator it = lock->ports.find(debugmgr_internalport);
                if (it != lock->ports.end())
                    have_debugger = it->second->conn != this;

                WHManager::RegisteredProcess &data = lock->processes[processcode];

                data.code = processcode;
                data.name = name;

                systemconfig = lock->systemconfig;
        }

        iobuf->ResetForSending();

        uint8_t dummy = 0;

        iobuf->Write(processcode);
        iobuf->Write(have_debugger);
        if (systemconfig.get())
            iobuf->WriteBinary(systemconfig->size(), &(*systemconfig)[0]);
        else
            iobuf->WriteBinary(0, &dummy);

        iobuf->FinishForRequesting(WHMResponseOpcode::RegisterProcessResult);

        DEBUGPRINT("Conn " << this << " Sending RPC RegisterProcessResult, processcode: " << processcode << ", have_debugger: " << have_debugger << ", config: " << (systemconfig.get() ? "yes" : "no"));
        return Database::RPCResponse::Respond;
}

Database::RPCResponse::Type Connection::RemoteGetProcessList(Database::IOBuffer *iobuf)
{
        DEBUGPRINT("Conn " << this << " Incoming RPC GetProcessList");

        iobuf->ResetForSending();

        {
                WHManager::LockedData::WriteRef lock(manager->data);

                iobuf->Write< uint32_t >(lock->processes.size());

                for (std::map< uint64_t, WHManager::RegisteredProcess >::iterator it = lock->processes.begin(); it != lock->processes.end(); ++it)
                {
                        iobuf->Write< uint64_t >(it->second.code);
                        iobuf->Write< std::string >(it->second.name);
                }
        }

        iobuf->FinishForRequesting(WHMResponseOpcode::GetProcessListResult);

        DEBUGPRINT("Conn " << this << " Sending RPC GetProcessListResult");
        return Database::RPCResponse::Respond;
}

Database::RPCResponse::Type Connection::RemoteConfigureLogs(Database::IOBuffer *iobuf)
{
        DEBUGPRINT("Conn " << this << " Incoming RPC RemoteConfigureLogs");

        std::vector< class WHCore::LogConfig > newconfig;

        uint32_t id = iobuf->Read< uint32_t >();
        uint32_t count = iobuf->Read< uint32_t >();
        newconfig.resize(count);
        DEBUGPRINT("Got " << count << " logs");
        for (unsigned i = 0; i < count; ++i)
        {
                WHCore::LogConfig &config = newconfig[i];

                config.tag = iobuf->Read< std::string >();
                config.logroot = iobuf->Read< std::string >();
                config.logname = iobuf->Read< std::string >();
                config.logextension = iobuf->Read< std::string >();
                config.autoflush = iobuf->Read< bool >();
                config.rotates = iobuf->Read< uint32_t >();
                config.with_mseconds = iobuf->Read< bool >();
        }

        iobuf->ResetForSending();

        std::vector< bool > results;
        manager->SetNewLogConfiguration(newconfig, &results);

        iobuf->Write< uint32_t >(id);
        iobuf->Write< uint32_t >(count);
        for (unsigned i = 0; i < count; ++i)
            iobuf->Write< bool >(results[i]);

        iobuf->FinishForRequesting(WHMResponseOpcode::ConfigureLogsResult);

        return Database::RPCResponse::Respond;
}

Database::RPCResponse::Type Connection::RemoteLog(Database::IOBuffer *iobuf)
{
        DEBUGPRINT("Conn " << this << " Incoming RPC RemoteLog");

        std::string logname = iobuf->Read< std::string >();
        std::string logline = iobuf->Read< std::string >();

        bool found_log = false;
        {
                WHManager::LockedLogData::WriteRef lock(manager->logdata);

                std::map< std::string, WHManager::LogFileData >::iterator it = lock->logs.find(logname);
                if (it != lock->logs.end())
                {
                        it->second.logfile->StampedLog(logline);
                        found_log = true;
                }
        }

        if (!found_log)
            Blex::ErrStream() << "Tried to log to non-existing log '" << logname << "': " << logline;

        return Database::RPCResponse::DontRespond;
}

Database::RPCResponse::Type Connection::RemoteDisconnect(Database::IOBuffer *iobuf)
{
        DEBUGPRINT("Conn " << this << " Incoming RPC Disconnect");

        iobuf->ResetForSending();

        Blex::Dispatcher::Connection::AsyncSignal(Blex::Dispatcher::Signals::Hangup);

        return Database::RPCResponse::DontRespond;
}

Database::RPCResponse::Type Connection::RemoteFlushLog(Database::IOBuffer *iobuf)
{
        DEBUGPRINT("Conn " << this << " Incoming RPC RemoteFlushLog");

        uint32_t id = iobuf->Read< uint32_t >();
        std::string logname = iobuf->Read< std::string >();

        bool found_log = false;
        {
                WHManager::LockedLogData::WriteRef lock(manager->logdata);

                std::map< std::string, WHManager::LogFileData >::iterator it = lock->logs.find(logname);
                if (it != lock->logs.end()) // hmm, problem!
                {
                        it->second.logfile->Flush();
                        found_log = true;
                }
        }

        if (!found_log)
            Blex::ErrStream() << "Tried to flush non-existing log '" << logname << "'";

        iobuf->ResetForSending();
        iobuf->Write< uint32_t >(id);
        iobuf->Write< bool >(found_log);
        iobuf->FinishForRequesting(WHMResponseOpcode::FlushLogResult);

        return Database::RPCResponse::Respond;
}

Database::RPCResponse::Type Connection::RemoteSetSystemConfig(Database::IOBuffer *iobuf)
{
        DEBUGPRINT("Conn " << this << " Incoming RPC SetSystemConfig");

        std::pair<uint8_t const*, uint8_t const*> msgbuf = iobuf->ReadBinary();

        std::shared_ptr< Blex::PodVector< uint8_t > > config(new Blex::PodVector< uint8_t >());
        config->assign(msgbuf.first, msgbuf.second);

        {
                WHManager::LockedData::WriteRef lock(manager->data);
                lock->systemconfig = config;
        }

        BroadcastSystemConfig();
        return Database::RPCResponse::DontRespond;
}

void Connection::DumpRemoteToLocalId(std::string const &/*comment*/)
{
/*
        DEBUGONLY(
            std::ostringstream str;
            str << "[";

            for (std::map< uint32_t, uint64_t >::iterator it = remotetolocalid.begin(); it != remotetolocalid.end(); ++it)
            {
                    if (it != remotetolocalid.begin())
                        str << ", ";
                    str << "(" << it->first << ", " << it->second << ")";
            }
            str << "]";
            DEBUGPRINT("Conn " << this << " RTOL ("<<comment<<")" << str.str()));
*/
}

// -----------------------------------------------------------------------------
//
// EventTask
//

Database::RPCResponse::Type EventTask::HookExecuteTask(Database::IOBuffer *iobuf, bool *is_finished)
{
        iobuf->ResetForSending();
        iobuf->Write(eventname);
        iobuf->WriteBinary(msg.size(), &msg[0]);
        iobuf->FinishForRequesting(WHMResponseOpcode::IncomingEvent);

        DEBUGPRINT("Task, conn " << target << " Sending RPC IncomingEvent, eventname: '" << eventname << "'");

        *is_finished = true;
        return Database::RPCResponse::Respond;
}


Database::RPCResponse::Type EventTask::HookTaskFinished(Database::IOBuffer */*iobuf*/, bool /*success*/)
{
        return Database::RPCResponse::DontRespond;
}

// -----------------------------------------------------------------------------
//
// LinkOpenedTask
//

Database::RPCResponse::Type LinkOpenedTask::HookExecuteTask(Database::IOBuffer *iobuf, bool *is_finished)
{
        uint32_t target_linkid;
        {
                WHManager::LockedData::WriteRef lock(target->manager->data);

                std::map< uint64_t, std::shared_ptr< Link > >::iterator it = lock->links.find(locallinkid);
                if (it == lock->links.end())
                {
                        DEBUGPRINT("Task, conn " << target << " HookExecuteTask, link already gone, portname: " << portname << ", locallinkid: " << locallinkid);

                        *is_finished = true;
                        return Database::RPCResponse::DontRespond;
                }

                target_linkid = it->second->target_linkid = target->GetNewLinkId();
        }

        target->RegisterLink(target_linkid, locallinkid);
        target->DumpRemoteToLocalId("LinkOpenedTask::Target register");

        iobuf->ResetForSending();

        iobuf->Write(portname);
        iobuf->Write(target_linkid);
        iobuf->Write(msgid);
        iobuf->FinishForRequesting(WHMResponseOpcode::OpenLink);

        DEBUGPRINT("Task, conn " << target << " Sending RPC OpenLink, portname: " << portname << ", target_linkid: " << target_linkid << " (local: " << locallinkid << "), msgid: " << msgid);

        *is_finished = true;
        return Database::RPCResponse::Respond;
}

Database::RPCResponse::Type LinkOpenedTask::HookTaskFinished(Database::IOBuffer */*iobuf*/, bool /*success*/)
{
        return Database::RPCResponse::DontRespond;
}

// -----------------------------------------------------------------------------
//
// LinkEstablishedTask
//

Database::RPCResponse::Type LinkEstablishedTask::HookExecuteTask(Database::IOBuffer *iobuf, bool *is_finished)
{
        iobuf->ResetForSending();

        iobuf->Write(targetlinkid);
        iobuf->Write(replyto);
        iobuf->Write(success);
        iobuf->FinishForRequesting(WHMResponseOpcode::ConnectLinkResult);

        DEBUGPRINT("Task, conn " << target << " Sending RPC OpenLinkResult, target_linkid: " << targetlinkid << ", replyto: " << replyto << ", success: " << success);

        *is_finished = true;
        return Database::RPCResponse::Respond;
}


Database::RPCResponse::Type LinkEstablishedTask::HookTaskFinished(Database::IOBuffer */*iobuf*/, bool /*success*/)
{
        return Database::RPCResponse::DontRespond;
}

// -----------------------------------------------------------------------------
//
// LinkClosedTask
//

Database::RPCResponse::Type LinkClosedTask::HookExecuteTask(Database::IOBuffer *iobuf, bool *is_finished)
{
        // Unregister the remote id
        target->UnregisterLink(targetlinkid);

        iobuf->ResetForSending();

        iobuf->Write(targetlinkid);
        iobuf->FinishForRequesting(WHMResponseOpcode::LinkClosed);

        target->DumpRemoteToLocalId("LinkClosedTask::Target");

        DEBUGPRINT("Task, conn " << target << " Sending RPC LinkClosed, target_linkid: " << targetlinkid);

        *is_finished = true;
        return Database::RPCResponse::Respond;
}


Database::RPCResponse::Type LinkClosedTask::HookTaskFinished(Database::IOBuffer */*iobuf*/, bool /*success*/)
{
        return Database::RPCResponse::DontRespond;
}

// -----------------------------------------------------------------------------
//
// MessageTask
//

Database::RPCResponse::Type MessageTask::HookExecuteTask(Database::IOBuffer *iobuf, bool *is_finished)
{
        iobuf->ResetForSending();
        iobuf->Write(targetlinkid);
        iobuf->Write(msgid);
        iobuf->Write(replyto);
        iobuf->Write(lastpart);
        iobuf->WriteBinary(msg.size(), &msg[0]);
        iobuf->FinishForRequesting(WHMResponseOpcode::IncomingMessage);

        DEBUGPRINT("Task, conn " << target << " Sending RPC IncomingMessage, target_linkid: " << targetlinkid << ", msgid: " << msgid << ", replyto: " << replyto);

        *is_finished = true;
        return Database::RPCResponse::Respond;
}


Database::RPCResponse::Type MessageTask::HookTaskFinished(Database::IOBuffer */*iobuf*/, bool /*success*/)
{
        return Database::RPCResponse::DontRespond;
}

// -----------------------------------------------------------------------------
//
// SystemConfigTask
//

Database::RPCResponse::Type SystemConfigTask::HookExecuteTask(Database::IOBuffer *iobuf, bool *is_finished)
{
        uint8_t dummy = 0;
        iobuf->ResetForSending();
        iobuf->Write(have_debugger);
        if (config.get())
            iobuf->WriteBinary(config->size(), &(*config)[0]);
        else
            iobuf->WriteBinary(0, &dummy);
        iobuf->FinishForRequesting(WHMResponseOpcode::SystemConfig);

        DEBUGPRINT("Task, conn " << target << " Sending RPC SystemConfig, have_debugger: " << have_debugger << ", config: " << (config.get() ? "yes" : "no"));

        *is_finished = true;
        return Database::RPCResponse::Respond;
}


Database::RPCResponse::Type SystemConfigTask::HookTaskFinished(Database::IOBuffer */*iobuf*/, bool /*success*/)
{
        return Database::RPCResponse::DontRespond;
}

// -----------------------------------------------------------------------------
//
// WHManager
//

WHManager::WHManager()
: dispatcher(std::bind(&WHManager::CreateConnection, this, std::placeholders::_1))
{
}

WHManager::~WHManager()
{
}

Blex::Dispatcher::Connection *WHManager::CreateConnection(void *data)
{
        return new Connection(this, data);
}

void WHManager::SetNewLogConfiguration(std::vector< WHCore::LogConfig > const &newconfig, std::vector< bool > *results)
{
        // ADDME: apply only changes

        WHManager::LockedLogData::WriteRef lock(logdata);

        // Clear existing logs
        for (std::map< std::string, LogFileData >::iterator it = lock->logs.begin(); it != lock->logs.end(); ++it)
            it->second.logfile->CloseLogfile();
        lock->logs.clear();

        std::set< std::string > opened;

        // Build new logs
        for (std::vector< WHCore::LogConfig >::const_iterator it = newconfig.begin(); it != newconfig.end(); ++it)
        {
                std::string keyname = it->logroot + "#" + it->logname + "#" + it->logextension;
                bool result = false;
                if (!opened.count(keyname))
                {
                        LogFileData &data = lock->logs[it->tag];
                        data.config = *it;
                        data.logfile.reset(new Blex::Logfile);
                        result = data.logfile->OpenLogfile(it->logroot, it->logname, it->logextension, it->autoflush, it->rotates, it->with_mseconds);
                        if (result)
                            opened.insert(keyname);
                }
                if (results)
                {
                        results->push_back(result);
                }
                if (result)
                {
                        DEBUGPRINT("Opened log file, tag:'" << it->tag << "', root:'" << it->logroot << "', logname:'" << it->logname << "', ext:'" << it->logextension << "', flush:" << it->autoflush << ", rotates:" << it->rotates << ", msecs:" << it->with_mseconds);
                }
                else
                {
                        Blex::ErrStream() << "Could not open log file '" << it->tag << "', root:'" << it->logroot << "', logname:'" << it->logname << "', ext:'" << it->logextension << "', flush:" << it->autoflush << ", rotates:" << it->rotates << ", msecs:" << it->with_mseconds;
                }

                opened.insert(it->logroot + "#" + it->logname + "#" + it->logextension);
        }
}

class LogFlusher
{
    private:
        WHManager &whmanager;
        Blex::Thread thread;

        void ThreadFunction();
        void Stop();

    public:
        LogFlusher(WHManager &_whmanager);
        ~LogFlusher();
};

LogFlusher::LogFlusher(WHManager &_whmanager)
: whmanager(_whmanager)
, thread(std::bind(&LogFlusher::ThreadFunction, this))
{
        thread.Start();
}

LogFlusher::~LogFlusher()
{
        Stop();
}

void LogFlusher::Stop()
{
        WHManager::LockedLogData::WriteRef(whmanager.logdata)->abort_flushthread = true;
        whmanager.logdata.SignalOne();

        thread.WaitFinish();
}

void LogFlusher::ThreadFunction()
{
        WHManager::LockedLogData::WriteRef lock(whmanager.logdata);

        Blex::DateTime nextflush = Blex::DateTime::Now() + Blex::DateTime::Seconds(5);
        while (!lock->abort_flushthread)
        {
                lock.TimedWait(nextflush);

                Blex::DateTime now = Blex::DateTime::Now();
                if (now >= nextflush || lock->abort_flushthread)
                {
                        DEBUGPRINT("Flushing log files\n");
                        for (std::map< std::string, WHManager::LogFileData >::iterator it = lock->logs.begin(); it != lock->logs.end(); ++it)
                            it->second.logfile->Flush();
                        nextflush = now + Blex::DateTime::Seconds(5);
                }
        }
}

int WHManager::Execute (std::vector<std::string> const &args)
{
       Blex::OptionParser::Option optionlist[] =
        {
          Blex::OptionParser::Option::ListEnd()
        };

        Blex::OptionParser optparse(optionlist);
        WHCore::Connection::AddOptions(optparse);
        if (!optparse.Parse(args))
        {
                Blex::ErrStream() << optparse.GetErrorDescription();
                return EXIT_FAILURE;
        }

        WHCore::Connection conn(optparse, "whmanager", WHCore::WHManagerConnectionType::None);

        //Setup initial logconfiguration to prevent chicken/egg for core logging files
        std::vector<WHCore::LogConfig> logs;
        const char *logfiles[] = {"notice","debug","rpc","audit"};
        for(unsigned i=0; i < 4; ++i)
        {
                WHCore::LogConfig log;
                log.tag = "system:" + std::string(logfiles[i]);
                log.logroot = conn.GetLogRoot();
                log.logname = logfiles[i];
                log.logextension = ".log";
                log.autoflush = false;
                log.with_mseconds = true;
                log.rotates = 9999; //unconfigured, allow up to about 30 years of logs. TODO support an infinite rotation mode
                logs.push_back(log);
        }

        SetNewLogConfiguration(logs, nullptr);

        Blex::Dispatcher::ListenAddress ports[2];
        ports[0].sockaddr = conn.GetDbaseAddr();
        ports[0].sockaddr.SetPort(conn.GetDbaseAddr().GetPort()+2);

        DEBUGPRINT("Opening whmanager port");
        dispatcher.UpdateListenPorts(1, ports);
        if(!dispatcher.RebindSockets(NULL))
        {
                Blex::ErrStream()<<"Unable to bind to the whmanager port\n";
                return 1;
        }

        LogFlusher flusher(*this);

        Blex::SetInterruptHandler(std::bind(&Blex::Dispatcher::Dispatcher::InterruptHandler,&dispatcher,std::placeholders::_1),false);
        dispatcher.Start(5, -1 /* Infinite idle grace (ADDME: Better timout detection) */, true);

        Blex::ResetInterruptHandler();
        return EXIT_SUCCESS;
}

int UTF8Main(std::vector<std::string> const &args)
{
        WHManager myserver;
        int ret=myserver.Execute(args);
        return ret;
}

int main(int argc, char *argv[])
{
        return Blex::InvokeMyMain(argc,argv,&UTF8Main);
}
