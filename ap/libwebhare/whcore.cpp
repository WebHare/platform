#include <ap/libwebhare/allincludes.h>


#include "whcore.h"
#include "whcore_hs3.h"
#include <blex/path.h>
#include <blex/pipestream.h>
#include <blex/logfile.h>
#include <harescript/vm/hsvm_events.h>

#include <ap/libwebhare/dbase_client.h>
#include <iostream>

///ADDME perhaps: also fallback to default language/skin if specific skins lacks a specific definition

// Print communication with whmanager process
//#define PRINT_RPCCOMM

// Print module scan
//#define PRINT_MODULESCAN


#ifdef PRINT_RPCCOMM
 #define RPCCOMM_PRINT(x) DEBUGPRINT(x)
#else
 #define RPCCOMM_PRINT(x) (void)0
#endif

#if defined(PRINT_MODULESCAN)
 #define MODULESCAN_PRINT(x) DEBUGPRINT(x)
#else
 #define MODULESCAN_PRINT(x) BLEX_NOOP_STATEMENT
#endif


/*ADDME: Unused?
namespace
{
        const unsigned CacheTrust = 10; //seconds to wait before verifying a skin/language's file up-to-date-ness on disk
}
*/
namespace WHCore
{

bool ValidName(const char *namebegin, const char *nameend,bool slashes_ok)
{
        return Blex::IsSafeFilePath(namebegin, nameend, slashes_ok) && *namebegin!='^' && *namebegin!='!';
}

int StandardErrorWriter(void */*opaque_ptr*/, int numbytes, void const *data, int /*allow_partial*/, int *errorcode)
{
        std::cerr.write(static_cast<const char*>(data),numbytes);
        *errorcode = 0;
        return numbytes; //ADDME: Report # of bytes really writen
}

void Connection::AddOptions(Blex::OptionParser &optparser)
{
        optparser.AddOption(Blex::OptionParser::Option::StringOpt("debuglogfile"));
        optparser.AddOption(Blex::OptionParser::Option::StringOpt("preloadlibrary"));
        optparser.AddOption(Blex::OptionParser::Option::Switch("onlyshippedfonts", false));
}

void Connection::PrintGlobalOptions()
{
        //            --xxxxxxxxxxxxxxxxxxxxxxxxx  ddddddddddddddddddddddddddddddddddddddddddddddd\n
        std::cerr << "--debuglogfile <path>        Filename to write debugging information to\n";
        std::cerr << "--preloadlibrary <path>      Override the preload library\n";
        std::cerr << "--onlyshippedfonts           Use only font files that ship with WebHare\n";
}

namespace
{
std::string AppendSlashWhenMissing(std::string const &path)
{
        if (path.empty() || path[path.size() - 1] == '/')
            return path;

        return path + "/";
}
} // End of anonymous namespace

Connection::Connection(Blex::OptionParser const &options, std::string const &clientname, WHManagerConnectionType::Type connect_whmanager)
: clientname(clientname)
, mgrconn(*this, notificationeventmgr)
, softresetlistener(*this)
{
        unsigned baseport = Blex::DecodeUnsignedNumber<unsigned>(Blex::GetEnvironVariable("WEBHARE_BASEPORT"));
        basedatadir = AppendSlashWhenMissing(Blex::GetEnvironVariable("WEBHARE_DATAROOT"));
        installationroot = AppendSlashWhenMissing(Blex::GetEnvironVariable("WEBHARE_DIR"));

        if(baseport == 0)
            baseport = 13679; //default port, needed for backwards compatibility
        if(baseport < 1024 || baseport > 65500)
            throw std::runtime_error("Invalid WEBHARE_BASEPORT");
        if(basedatadir.empty())
            throw std::runtime_error("Invalid WEBHARE_DATAROOT");
        if(installationroot.empty())
            throw std::runtime_error("Cannot determine the WebHare installation root");

        dbaseaddr.SetIPAddress("127.0.0.1");
        dbaseaddr.SetPort(baseport);

        compilerloc.SetIPAddress("127.0.0.1");
        compilerloc.SetPort(baseport +1);

        consilioloc.SetIPAddress("127.0.0.1");
        consilioloc.SetPort(baseport + 3);

        dbaseptr.reset(new Database::TCPFrontend(GetDbaseAddr(), clientname));
        only_shipped_fonts = options.Switch("onlyshippedfonts");

        if(options.Exists("preloadlibrary"))
        {
                preloadlibrary = options.StringOpt("preloadlibrary");
                Blex::SetEnvironVariable("WEBHARE_PRELOADLIBRARY", preloadlibrary);
        }
        else
        {
                preloadlibrary = Blex::GetEnvironVariable("WEBHARE_PRELOADLIBRARY");
        }

        if(options.Exists("debuglogfile"))
        {
                std::string logfile = options.StringOpt("debuglogfile");
                Blex::ErrStream::SetTimestamping(true);
                Blex::ErrStream::SetThreadIds(true);
                if (logfile != "-" && !Blex::ErrStream::OpenLogFile(logfile))
                    Blex::ErrStream() << "Unable to open debug logfile: " << logfile;
        }

        moduledirs.push_back(basedatadir + "installedmodules/");

        std::string env_modulepaths = Blex::GetEnvironVariable("WEBHARE_MODULEPATHS");
        if(!env_modulepaths.empty())
        {
                std::vector<std::string> modulepaths;
                Blex::TokenizeString(env_modulepaths, ':', &modulepaths);
                for(auto itr = modulepaths.begin(); itr != modulepaths.end(); ++itr)
                  if(!itr->empty())
                    moduledirs.push_back(AppendSlashWhenMissing(*itr));
        }

        ReloadPluginConfig();

        if (connect_whmanager != WHManagerConnectionType::None)
        {
                // Send notifications directly to the whmanager
                notificationeventmgr.SetExportCallback(std::bind(&ManagerConnection::DistributeNotificationEvent, &mgrconn, std::placeholders::_1));

                mgrconn.Start();
                if (connect_whmanager != WHManagerConnectionType::RequireConnected)
                     mgrconn.WaitForConnection();
        }

        //socketbinder path used on linux/osx for port 80 and 443 binding
        Blex::AddSocketBinderPath("/var/run/socket_binder.socket");
}

Connection::~Connection()
{
        // Stop notification exports to mgrconn before the mgrconn is destroyed
        notificationeventmgr.SetExportCallback(nullptr);
}

std::string Connection::GetBinRoot() const
{
        return installationroot + "bin/";
}
std::string Connection::GetEphemeralRoot() const
{
        return basedatadir + "ephemeral/";
}
std::string Connection::GetCompileCache() const
{
        std::string compilecache = AppendSlashWhenMissing(Blex::GetEnvironVariable("WEBHARE_COMPILECACHE"));
        if(compilecache.empty())
                compilecache = basedatadir + "ephemeral/compilecache/";

        return compilecache;
}
std::string Connection::GetLogRoot() const
{
        return basedatadir + "log/";
}
std::string Connection::GetTmpRoot() const
{
        std::string tempdir = AppendSlashWhenMissing(Blex::GetEnvironVariable("WEBHARE_TEMP"));
        if(tempdir.empty())
                tempdir = basedatadir + "tmp/";

        return tempdir;
}

void Connection::ReloadPluginConfig() const
{
        ModuleMap newmodulemap;

        for(unsigned modidx = 0; modidx < moduledirs.size(); ++modidx)
                ScanModuleFolder(&newmodulemap, moduledirs[modidx], true, false);

        ScanModuleFolder(&newmodulemap, GetWebHareRoot() + "modules/", true, true);

        { // swap our new version in
                LockedConfig::WriteRef lock(moduleconfig);
                std::swap(lock->modulemap, newmodulemap);
        }
}

void Connection::ScanModuleFolder(ModuleMap *map, std::string const &folder, bool rootfolder, bool always_overwrites) const
{
        MODULESCAN_PRINT("Searching module root " << folder);
        for (Blex::Directory search(folder, "*");search;++search)
        {
                if (search.GetStatus().IsFile()
                    || search.CurrentFile()[0]=='.'
                    || Blex::StrCaseLike(search.CurrentFile(),"deleted"))
                    continue;

                Blex::DateTime creationdate = Blex::DateTime::FromDate(1970, 1, 1);

                ModuleData mdata;
                mdata.modpath = search.CurrentPath() + "/";

                if (!Blex::PathStatus(mdata.modpath + "moduledefinition.xml").Exists())
                {
                        if (rootfolder)
                            ScanModuleFolder(map, mdata.modpath, false, always_overwrites);
                        else
                            MODULESCAN_PRINT("Skipping folder " << mdata.modpath << ", it has no moduledefinition");

                        continue;
                }

                std::string currentfile = search.CurrentFile();
                if (Blex::StrCaseLike(currentfile, "*.*"))
                {
                        if (!Blex::StrCaseLike(currentfile, "*.20??????T??????Z"))
                            continue;

                        std::string::iterator pos = std::find(currentfile.begin(), currentfile.end(), '.');
                        if (pos != currentfile.end() - 17)
                        {
                                // Name is like blabla.blabla.datetimestamp
                                MODULESCAN_PRINT("Module name parse failure for " << currentfile << " " << std::distance(pos, currentfile.end() - 15));
                                continue;
                        }

                        std::string datestr = std::string(pos + 1, currentfile.end());
                        Blex::ToUppercase(datestr.begin(), datestr.end());

                        // Create an xxxx-xx-xxTyy:yy:yyZ
                        datestr.insert(13, ":");
                        datestr.insert(11, ":");
                        datestr.insert(6, "-");
                        datestr.insert(4, "-");
                        creationdate = Blex::DateTime::FromText(datestr);
                        if (creationdate == Blex::DateTime::Invalid())
                        {
                                MODULESCAN_PRINT("Module datetime parse failure for " << currentfile << " (" << datestr << ")");
                                continue;
                        }

                        //Strip timestamp
                        currentfile.resize(std::distance(currentfile.begin(), pos));
                }

                mdata.creationdate = creationdate;

                ModuleMap::iterator curpos = map->find(currentfile);

                if (curpos != map->end())
                {
                        if (always_overwrites || curpos->second.creationdate < mdata.creationdate)
                        {
                                MODULESCAN_PRINT("New module version found at " << mdata.modpath);
                                curpos->second = mdata;
                        }
                        else
                        {
                                MODULESCAN_PRINT("Older module version found at " << mdata.modpath);
                        }
                        continue;
                }

                MODULESCAN_PRINT("Found module " << currentfile << " at " << mdata.modpath);
                //currentfile is module name (ie directory name without timestamp)
                map->insert(std::make_pair(currentfile, mdata));
        }
}

void Connection::GetModuleNames(std::vector<std::string> *modules) const
{
        modules->clear();
        LockedConfig::ReadRef lock(moduleconfig);
        modules->reserve (lock->modulemap.size());
        for (ModuleMap::const_iterator modptr = lock->modulemap.begin(); modptr != lock->modulemap.end(); ++modptr)
                modules->push_back(modptr->first);
}

std::string Connection::GetModuleFolder(std::string const &modulename) const
{
        LockedConfig::ReadRef lock(moduleconfig);
        ModuleMap::const_iterator modinfo = lock->modulemap.find(modulename);
        std::string retval;
        if(modinfo != lock->modulemap.end())
            retval = modinfo->second.modpath;

        return retval;
}

void Connection::AddStandardArguments(std::vector<std::string> */*arglist*/)
{
        // No longer used, the vars here are now pushed through the environment
}

std::string Connection::GetConfigKey(Database::TransFrontend &trans, std::string const &name)
{
        if (trans.GetConfig().GetTableInfo(Blex::StringPair::FromStringConstant("SYSTEM.FLATREGISTRY")) == NULL)
            return "";

        static const char *columns[]={"DATA",0};

        Database::ClientScanner scan(trans, false, "WHCore: Get config key");
        scan.AddTable("SYSTEM.FLATREGISTRY", columns);
        scan.SetLimit(1);
        scan.AddStringSearch(0, "NAME", name.size(), &name[0], Database::SearchEqual, true);
        if (scan.NextRow())
            return scan.GetCell(0).String();
        return "";
}

void Connection::ConnectToWHManager()
{
        mgrconn.Start();
}

void Connection::InitDebugger()
{
        mgrconn.WaitForDebugInit();
}

SoftResetListener::SoftResetListener(Connection &_conn)
: NotificationEventReceiver(_conn.GetNotificationEventMgr())
, conn(_conn)
{
        Register();
}

SoftResetListener::~SoftResetListener()
{
        Unregister();
}

void SoftResetListener::ReceiveNotificationEvent(std::string const &event, uint8_t const */*hsvmdata*/, unsigned /*hsvmdatalen*/)
{
        if (event == "system:clearcaches")
        {
                // Ignore event data for now, just reload all
                HSVM_ClearCaches();
        }
        if (event == "system:softreset")
        {
                conn.ReloadPluginConfig();
        }
}

ManagerConnection::ManagerConnection (Connection &conn, Blex::NotificationEventManager &_notificationeventmgr)
: conn(conn)
, notificationeventmgr(_notificationeventmgr)
, localmapper(globalmapper)
, stackm(localmapper)
, marshaller(stackm, HareScript::MarshalMode::SimpleOnly)
, pending_debugger_connid(0)
, subthread(std::bind(&ManagerConnection::Thread, this))
{
        msgvar = stackm.NewHeapVariable();
        composevar = stackm.NewHeapVariable();
}

ManagerConnection::~ManagerConnection()
{
        Stop();
}


ManagerConnection::MgrData::MgrData()
: jobmgr(0)
, abort(false)
, connected(false)
, release_jobmgr(false)
, aborttimeout(Blex::DateTime::Max())
, processcode(0)
, have_debugger(0)
, wait_debuginit(false)
, conncounter(0)
, requestcounter(0)
{
}

ManagerConnection::IOBufferPtr ManagerConnection::GetIOBuffer()
{
        IOBufferPtr buf;
        if (!cache.empty())
        {
                buf = cache.front();
                cache.pop();
        }
        else
            buf.reset(new Database::IOBuffer);

        return buf;
}

void ManagerConnection::AddToCache(IOBufferPtr const &buf)
{
        if (cache.size() < 8)
            cache.push(buf);
}

void ManagerConnection::ClearPortData(bool jobmgr_too)
{
        extlinks.clear();
        controllinks.clear();

        if (jobmgr_too)
        {
                {
                        LockedMgrData::WriteRef lock(mgrdata);
                        lock->jobmgr = 0;
                        lock->release_jobmgr = false;
                        lock->wait_debuginit = false;
                }
                mgrdata.SignalAll();
        }
}

bool ManagerConnection::CheckAbort(LockedMgrData::ReadRef const &lock)
{
        if (lock->abort || lock->release_jobmgr)
            ClearPortData(true);

        return lock->abort;
}

void ManagerConnection::HandleLinks(
        Blex::PipeWaiter &waiter,
        std::shared_ptr< HareScript::IPCNamedPort > &port)
{
        std::shared_ptr< HareScript::IPCLinkEndPoint > newlink;
        std::shared_ptr< HareScript::IPCMessage2 > msg;

        // Check and handle port events
        if (port.get() && port->GetEvent().IsSignalled())
        {
                newlink = port->Accept();

                if (newlink.get())
                {
                        ManagerConnection::ControlLinkData data;
                        data.link = newlink;
                        data.connid = ++LockedMgrData::WriteRef(mgrdata)->conncounter;
                        controllinks.insert(std::make_pair(data.connid, data));

                        newlink->AddToWaiterRead(waiter);
                }

                newlink.reset();
        }

        // Check and handle control link messages/breakage
        for (std::map< uint32_t, ControlLinkData >::iterator it = controllinks.begin(), end = controllinks.end(); it != end;)
        {
                HareScript::IPCLinkEndPoint *link = it->second.link.get();

                if (link->GetEvent().IsSignalled())
                {
                        if (link->IsBroken())
                        {
                                for (std::set< std::string >::iterator it2 = it->second.registeredports.begin(); it2 != it->second.registeredports.end(); ++it2)
                                    SendRegisterPortRPC(it->second, 0, *it2, false, false); // no response

                                link->RemoveFromWaiterRead(waiter);
                                controllinks.erase(it++);
                                continue;
                        }

                        link->ReceiveMessage(&msg);
                        if (msg.get())
                        {
                                std::pair< bool, bool > res = HandleControlLinkMessage(it->second, *msg);
                                if (!res.first)
                                    link->RemoveFromWaiterRead(waiter);
                                if (!res.second)
                                {
                                        controllinks.erase(it++);
                                        continue;
                                }
                                // ADDME: give back 'msg' to jobmgr?
                        }
                }
                ++it;
        }

        // Check and handle external link messages/breakage
        for (std::map< uint32_t, ExtLinkData >::iterator it = extlinks.begin(), end = extlinks.end(); it != end;)
        {
                HareScript::IPCLinkEndPoint *link = it->second.link.get();

                if (link->GetEvent().IsSignalled())
                {
                        bool failed_send = false;
                        if (!link->IsBroken())
                        {
                                link->ReceiveMessage(&msg);
                                if (msg.get())
                                {
                                        failed_send = !HandleExtLinkMessage(waiter, it->second, *msg);
                                        // ADDME: give back msg to jobmgr?
                                }
                        }

                        if (failed_send || link->IsBroken())
                        {
                                // Deregister the link in the whmanager
                                IOBufferPtr iobuf;
                                iobuf = GetIOBuffer();
                                iobuf->ResetForSending();
                                iobuf->Write(it->second.linkid);
                                iobuf->FinishForRequesting(WHMRequestOpcode::DisconnectLink);
                                RPCCOMM_PRINT("Scheduling RPC DisconnectLink, linkid: " << it->second.linkid);
                                transmitqueue.push(std::make_pair(0, iobuf));

                                link->RemoveFromWaiterRead(waiter);
                                extlinks.erase(it++);
                                continue;
                        }
                }
                ++it;
        }
}

bool ManagerConnection::ScheduleQueuedPackets(LockedMgrData::WriteRef &lock)
{
        bool need_signal = false;

        // Move queued items into the transmit queue, not too many for flow control
        while (!lock->queue.empty() && transmitqueue.size() < 4)
        {
                // Queue push waits when 16+ items are in the queue, signal if 16 were there
                if (lock->queue.size() == 16)
                    need_signal = true;

                transmitqueue.push(std::make_pair(0, lock->queue.front()));
                lock->queue.pop();

                if (lock->queue.empty())
                    need_signal = true;
        }

        return need_signal;
}

/** Submits all items on the transmit queue, as long as they can be sent immediately.
*/
bool ManagerConnection::ProcessTransmitQueue(LockedMgrData::WriteRef &, Database::TCPConnection &tcpconn, Blex::PipeWaiter &waiter)
{
        RPCCOMM_PRINT("Enter ProcessTransmitQueue");

        // Try to send all messages in the queue until it blocks
        while (!transmitqueue.empty())
        {
                RPCCOMM_PRINT(" loop, hod: " << tcpconn.HasOutgoingData());
                if (tcpconn.HasOutgoingData() && !tcpconn.RetryAsyncSend())
                {
                        RPCCOMM_PRINT("Exit ProcessTransmitQueue, data in tcpconn buffer which can't be sent");
                        break;
                }

                // is the first this packet already
                if (transmitqueue.front().second)
                {
                        RPCCOMM_PRINT("Sending item from queue");

                        // Place the packet into the tcpconn outgoing data buffers
                        bool sent = tcpconn.AsyncSendPacket(*transmitqueue.front().second);
                        RPCCOMM_PRINT("ProcessTransmitQueue schedule packet, sent whole: " << sent);

                        // Recycle the buffer
                        AddToCache(transmitqueue.front().second);
                        transmitqueue.front().second.reset();

                        // has the whole packet been sent?
                        if (!sent)
                            break;
                }

                // Inv: all the data of the first item in the transmit queue has been sent
                // Inv: !transmitqueue.front().second
                if (transmitqueue.front().first)
                {
                        // Unthrottle links that have their transmit queue cleaned a bit
                        std::map< uint32_t, ExtLinkData >::iterator eit = extlinks.find(transmitqueue.front().first);
                        if (eit != extlinks.end())
                        {
                                --eit->second.scheduled_packets;
                                if (eit->second.scheduled_packets <= 4 && eit->second.throttled)
                                {
                                        DEBUGPRINT("Unthrottle link " << eit->first);
                                        eit->second.throttled = false;
                                        eit->second.link->AddToWaiterRead(waiter);
                                }
                        }
                }

                transmitqueue.pop();
                RPCCOMM_PRINT("Item has been sent");
        }

        return transmitqueue.empty();
}

void ManagerConnection::InitWHManagerPort(LockedMgrData::WriteRef &lock, Blex::PipeWaiter &waiter, std::shared_ptr< HareScript::IPCNamedPort > *port)
{
        // Allocate the port
        RPCCOMM_PRINT("Allocate whmanager port, have debugger: " << lock->have_debugger);
        (*port) = lock->jobmgr->CreateNamedPort("system:whmanager");
        (*port)->AddToWaiterRead(waiter);
}

bool ManagerConnection::LoopWithJobMgr(Database::TCPConnection &tcpconn)
{
        IOBufferPtr inbuf;
        std::shared_ptr< HareScript::IPCNamedPort > port;

        // Declare pipewaiter after port, so waiter is destroyed first
        Blex::PipeWaiter waiter;
        tcpconn.AddToWaiterRead(waiter);

        bool have_debugger_conn = false;
        bool must_abort = false;
        while (true)
        {
                if (!inbuf.get())
                    inbuf = GetIOBuffer();

                RPCCOMM_PRINT("Wait loop start entering lock");

                bool want_debugger_conn = false;
                bool got_input = false;
                bool need_signal = false;
                bool release_jobmgr = false;

                {
                        LockedMgrData::WriteRef lock(mgrdata);

                        // When jobmgr release is required, act immediately
                        release_jobmgr = lock->release_jobmgr;
                        if (release_jobmgr)
                            break;

                        // else send data if available, else wait until aborttimeout
                        if (!lock->abort && lock->jobmgr && !port.get())
                            this->InitWHManagerPort(lock, waiter, &port);

                        // Move queued items into the transmit queue, not too many for flow control
                        need_signal = ScheduleQueuedPackets(lock);

                        // submit everything from the queue and transmitqueue which can be sent immediately
                        bool all_sent = ProcessTransmitQueue(lock, tcpconn, waiter);

                        // can we send more from the queue immediately?
                        bool can_queue_more = all_sent && !lock->queue.empty();

                        // Try to receive from the tcpconn first, there might be a complete packet in the read buffer
                        got_input = tcpconn.ReceivePacket(inbuf.get(), Blex::DateTime::Invalid());
                        //Blex::ErrStream() << " loop io, gi:" << got_input << ", as: " << all_sent << ", tq: " << transmitqueue.empty();

                        if (lock->abort)
                        {
                                //Blex::ErrStream() << " in abort, clearing got_input";

                                // Ignore all incoming data
                                got_input = false;

                                // quit the loop when all outgoing data has been sent
                                if ((lock->queue.empty() && transmitqueue.empty()) || Blex::DateTime::Now() >= lock->aborttimeout)
                                {
                                        must_abort = true;
                                        break;
                                }
                                //else Blex::ErrStream() << " deferring abort while messages in queue";
                        }


                        want_debugger_conn = lock->have_debugger && lock->jobmgr;
                        bool init_debugger_conn = want_debugger_conn && !have_debugger_conn;

                        if (!got_input && !init_debugger_conn && !need_signal && !can_queue_more)
                        {
                                if (all_sent)
                                    tcpconn.AddToWaiterRead(waiter);
                                else
                                    tcpconn.AddToWaiterReadWrite(waiter);

                                RPCCOMM_PRINT("Waiting until " << lock->aborttimeout);
                                waiter.ConditionMutexWait(lock, lock->aborttimeout);
//                                bool is_read_signalled = tcpconn.IsReadSignalled(waiter); // addme: use to prevent syscalls
//                                bool is_write_signalled = tcpconn.IsWriteSignalled(waiter); // addme: use to prevent syscalls
                                RPCCOMM_PRINT("Got out of wait, signalled: " << tcpconn.IsReadSignalled(waiter) << " " << tcpconn.IsWriteSignalled(waiter));
                        }
                }

                if (need_signal)
                    mgrdata.SignalAll();

                if (must_abort || release_jobmgr)
                {
                        DEBUGPRINT("Exiting loop, must_abort: " << must_abort << ", release_jobmgr: " << release_jobmgr);
                        break;
                }

                if (want_debugger_conn && !have_debugger_conn)
                    this->InitDebuggerConnection(&waiter);
                have_debugger_conn = want_debugger_conn;

                // Handle received RPC if present (got_input is cleared when lock->abort is true)
                if (got_input)
                {
                        RPCCOMM_PRINT("Going to handle input");
                        HandleInput(&waiter, &inbuf);
                        got_input = false;
                }

                HandleLinks(waiter, port);
        }

        // abort or release_jobmgr are true
        waiter.Reset();
        port.reset();
        ClearPortData(true);

        return !must_abort;
}

void ManagerConnection::ConnectedLoop(Database::TCPConnection &tcpconn)
{
        RPCCOMM_PRINT("ManagerConnection Connected loop");

        // About aborts:
        // Normal, the disconnect RPC sent by stop will cause the connection to be broken by exception
        // otherwise a hard abort is done when the aborttimeout is reached.

        try
        {
                // If the jobmgr is released, all ports need to be cleared
                while (true)
                {
                        if (!LoopWithJobMgr(tcpconn))
                            break;
                }
        }
        catch (std::exception &e)
        {
                RPCCOMM_PRINT("Got exception " << typeid(e).name() << ": " << e.what());

                // Connection lost or other fault (waiter is already gone here)
                // But don't clear the jobmgr
                ClearPortData(false);
        }
}

std::pair< bool, bool > ManagerConnection::HandleControlLinkMessage(ControlLinkData &linkdata, HareScript::IPCMessage2 &msg)
{
        using namespace HareScript;

        marshaller.ReadMarshalPacket(msgvar, &msg.data);

        if (stackm.GetType(msgvar) != VariableTypes::Record)
            return std::make_pair(false, false);

        ColumnNameId col_type = localmapper.GetMapping("TYPE");
        VarId var_type = stackm.RecordCellGetByName(msgvar, col_type);
        if (!var_type || stackm.GetType(var_type) != VariableTypes::String)
            return std::make_pair(false, false);

        std::string type = stackm.GetSTLString(var_type);
        if (type == "register" || type == "unregister")
        {
                ColumnNameId col_port = localmapper.GetMapping("PORT");
                VarId var_port = stackm.RecordCellGetByName(msgvar, col_port);
                if (!var_port || stackm.GetType(var_port) != VariableTypes::String)
                    return std::make_pair(false, false);

                std::string port = stackm.GetSTLString(var_port);
                bool isregister = type == "register";

                if (isregister)
                {
                        if (linkdata.registeredports.count(port))
                        {
                                // Port already registered locally
                                SendRegisterPortResponseMessage(linkdata, msg.msgid, port, false);
                                return std::make_pair(true, true);
                        }
                        linkdata.registeredports.insert(port);
                }
                else
                {
                        // Already unregistered?
                        if (!linkdata.registeredports.count(port))
                            return std::make_pair(true, true);

                        linkdata.registeredports.erase(port);
                }

                // Need to undertake action
                SendRegisterPortRPC(linkdata, msg.msgid, port, isregister, true);
                return std::make_pair(true, true);
        }
        if (type == "connect")
        {
                ColumnNameId col_port = localmapper.GetMapping("PORT");
                VarId var_port = stackm.RecordCellGetByName(msgvar, col_port);
                if (!var_port || stackm.GetType(var_port) != VariableTypes::String)
                    return std::make_pair(false, false);

                if (!linkdata.registeredports.empty())
                {
                        SendSimpleResponseMessage(linkdata.link, msg.msgid, "notclean");
                        return std::make_pair(true, true);
                }

                ExtLinkData edata;
                edata.link = linkdata.link;
                edata.linkid = linkdata.connid;
                extlinks.insert(std::make_pair(edata.linkid, edata));

                std::string port = stackm.GetSTLString(var_port);

                IOBufferPtr iobuf;
                iobuf = GetIOBuffer();
                iobuf->ResetForSending();
                iobuf->Write(port);
                iobuf->Write(edata.linkid);
                iobuf->Write(msg.msgid);
                iobuf->FinishForRequesting(WHMRequestOpcode::ConnectLink);
                RPCCOMM_PRINT("Scheduling RPC ConnectLink, portname: " << port << ", linkid: " << edata.linkid << ", replyto " << msg.msgid);
                transmitqueue.push(std::make_pair(0, iobuf));

                // Delete the connlink, it is converted to extlink. Don't delete the waiter registration, though.
                return std::make_pair(true, false);
        }
        if (type == "getprocesslist")
        {
                IOBufferPtr iobuf;
                iobuf = GetIOBuffer();
                iobuf->ResetForSending();
                iobuf->FinishForRequesting(WHMRequestOpcode::GetProcessList);
                RPCCOMM_PRINT("Scheduling RPC GetProcessList");
                transmitqueue.push(std::make_pair(0, iobuf));

                linkdata.requested_processlists_replyids.push_back(msg.msgid);

                return std::make_pair(true, true);
        }


        // unknown message
        SendSimpleResponseMessage(linkdata.link, msg.msgid, "unknowncommand");
        return std::make_pair(true, true);
}

bool ManagerConnection::HandleExtLinkMessage(Blex::PipeWaiter &waiter, ExtLinkData &linkdata, HareScript::IPCMessage2 &msg)
{
        bool result = true;
        Blex::PodVector< uint8_t > msgdata;
        try
        {
                HareScript::GlobalBlobManager *blobmgr(0);
                {
                        LockedMgrData::WriteRef lock(mgrdata);
                        if (lock->jobmgr)
                            blobmgr = &lock->jobmgr->GetBlobManager();
                }

                msg.data->WriteToPodVector(&msgdata, blobmgr);
        }
        catch (HareScript::VMRuntimeError &e)
        {
                // Send an exception instead
                CreateException(e.what(), &msgdata);
                result = false;
        }

        unsigned maxsize = 511*1024;
        unsigned parts = 1 + msgdata.size() / maxsize;
        unsigned pos = 0;
        for (unsigned curpart = parts; curpart > 0; --curpart, pos += maxsize)
        {
                unsigned tosend = curpart == 1 ? msgdata.size() - pos : maxsize;

                IOBufferPtr iobuf;
                iobuf = GetIOBuffer();
                iobuf->ResetForSending();
                iobuf->Write(linkdata.linkid);
                iobuf->Write(msg.msgid);
                iobuf->Write(msg.replyto);
                iobuf->Write(curpart == 1);
                iobuf->WriteBinary(tosend, msgdata.begin() + pos);
                iobuf->FinishForRequesting(WHMRequestOpcode::SendMessageOverLink);
                RPCCOMM_PRINT("Scheduling RPC SendMessageOverLink, linkid: " << linkdata.linkid << ", msgid: " << msg.msgid << ", replyto " << msg.replyto << " part " << (parts-curpart+1) << "/" << parts);
                transmitqueue.push(std::make_pair(linkdata.linkid, iobuf));
        }

        linkdata.scheduled_packets += parts;
        if (linkdata.scheduled_packets >= 8 && !linkdata.throttled)
        {
                DEBUGPRINT("Throttle link " << linkdata.linkid << ", have " << linkdata.scheduled_packets << " packets in queue");
                linkdata.throttled = true;
                linkdata.link->RemoveFromWaiterRead(waiter);
        }
        return result;
}

void ManagerConnection::SendConnectedEvent()
{
        DEBUGPRINT("Sending WHManager connected event");

        using namespace HareScript;
        stackm.RecordInitializeEmpty(composevar);

        auto evt = std::make_shared< Blex::NotificationEvent >("system:whmanager.connected");
        marshaller.WriteToPodVector(composevar, &evt->payload);

        // Send a local event
        notificationeventmgr.QueueEventNoExport(evt);
}

void ManagerConnection::SendUpdatedSystemConfigEvent()
{
        DEBUGPRINT("Sending systemconfig updated event");

        using namespace HareScript;
        stackm.RecordInitializeEmpty(composevar);

        auto evt = std::make_shared< Blex::NotificationEvent >("system:systemconfig");
        marshaller.WriteToPodVector(composevar, &evt->payload);

        // Send a local event
        notificationeventmgr.QueueEventNoExport(evt);
}

void ManagerConnection::HandleInput(Blex::PipeWaiter *waiter, IOBufferPtr *iobufptr)
{
        Database::IOBuffer *iobuf = iobufptr->get();

        WHMResponseOpcode::Type opcode = static_cast< WHMResponseOpcode::Type > (iobuf->GetOpcode());

        switch (opcode)
        {
        case WHMResponseOpcode::IncomingEvent:
            {
                    //It's a broadcast!
                    std::string eventname = iobuf->Read<std::string>();
                    std::pair<uint8_t const*,uint8_t const *> eventdata = iobuf->ReadBinary();

                    RPCCOMM_PRINT("WHManager RPC IncomingEvent, eventname: '" << eventname << "'");

                    // Send the event locally
                    auto evt = std::make_shared< Blex::NotificationEvent >(eventname, eventdata.first, eventdata.second - eventdata.first);
                    notificationeventmgr.QueueEventNoExport(evt);
            } break;

        case WHMResponseOpcode::RegisterPortResult:
            {
                    std::string portname = iobuf->Read< std::string >();
                    uint32_t connid = iobuf->Read< uint32_t >();
                    uint64_t replyto = iobuf->Read< uint64_t >();
                    bool success = iobuf->Read< bool >();

                    RPCCOMM_PRINT("WHManager RPC CreatePortResponse, portname: '" << portname << "', connid: " << connid << ", replyto " << replyto << ", success: " << (success ? "yes" : "no"));

                    std::map< uint32_t, ControlLinkData >::iterator it = controllinks.find(connid);
                    if (it != controllinks.end())
                        SendRegisterPortResponseMessage(it->second, replyto, portname, success);

            } break;

        case WHMResponseOpcode::UnregisterPortResult:
            {
                    std::string portname = iobuf->Read< std::string >();
                    uint32_t connid = iobuf->Read< uint32_t >();
                    uint64_t replyto = iobuf->Read< uint64_t >();

                    RPCCOMM_PRINT("WHManager RPC UnregisterPortResult, portname: '" << portname << "', connid: " << connid << ", replyto " << replyto);

                    std::map< uint32_t, ControlLinkData >::iterator it = controllinks.find(connid);
                    if (it != controllinks.end())
                        SendUnregisterPortResponseMessage(it->second, replyto, portname);

            } break;

        case WHMResponseOpcode::OpenLink:
            {
                    std::string portname = iobuf->Read<std::string>();
                    uint32_t linkid = iobuf->Read< uint32_t >();
                    uint64_t msgid = iobuf->Read< uint64_t >();

                    RPCCOMM_PRINT("WHManager RPC OpenLink, portname: '" << portname << "', linkid: " << linkid);

                    std::shared_ptr< HareScript::IPCLinkEndPoint > link;

                    {
                            LockedMgrData::WriteRef lock(mgrdata);
                            if (lock->jobmgr)
                                link = lock->jobmgr->ConnectToNamedPort(portname);
                    }

                    if (link.get())
                    {
                            // Link established. Register and report back
                            ExtLinkData data;
                            data.link = link;
                            data.linkid = linkid;
                            extlinks.insert(std::make_pair(linkid, data));
                            link->AddToWaiterRead(*waiter);
                    }

                    iobuf->ResetForSending();
                    iobuf->Write(linkid);
                    iobuf->Write(msgid);
                    iobuf->Write(bool(link.get()));
                    iobuf->FinishForRequesting(WHMRequestOpcode::OpenLinkResult);
                    RPCCOMM_PRINT("Scheduling RPC OpenLinkResult, linkid: " << linkid << ", msgid: " << msgid << ", success: " << (link.get() ? "yes" : "no"));
                    transmitqueue.push(std::make_pair(0, *iobufptr));
                    iobufptr->reset();
            } break;

        case WHMResponseOpcode::ConnectLinkResult:
            {
                    // Link extablished on other side
                    uint32_t linkid = iobuf->Read< uint32_t >();
                    uint64_t replyto = iobuf->Read< uint64_t >();
                    bool success = iobuf->Read< bool >();

                    RPCCOMM_PRINT("WHManager RPC ConnectLinkResult, linkid: " << linkid << ", replyto: " << replyto << ", success: " << (success?"yes":"no"));

                    std::map< uint32_t, ExtLinkData >::iterator it = extlinks.find(linkid);
                    if (it != extlinks.end())
                    {
                            if (success)
                            {
                                    // Don't send this message to the debugger, it just confuses it
                                    if (pending_debugger_connid != linkid)
                                        SendSimpleResponseMessage(it->second.link, replyto, "ok");
                            }
                            else
                            {
                                    // Send 'nosuchport' response and close the link immediately
                                    SendSimpleResponseMessage(it->second.link, replyto, "nosuchport");

                                    it->second.link->RemoveFromWaiterRead(*waiter);
                                    extlinks.erase(it);
                            }
                    }

                    if (pending_debugger_connid == linkid)
                    {
                            if (success)
                            {
                                    LockedMgrData::WriteRef lock(mgrdata);
                                    if (lock->jobmgr)
                                    {
                                            std::string clientname = conn.GetClientName();
                                            std::string::iterator hosttypeend = std::find(clientname.begin(), clientname.end(), ' ');

                                            std::string hosttype(clientname.begin(), hosttypeend);

                                            lock->jobmgr->SetDebugLink(pending_debugger_link, hosttype, lock->processcode, clientname);
                                    }
                                    else
                                        success = false;
                            }
                            if (!success)
                            {
                                    bool val = false;
                                    std::swap(LockedMgrData::WriteRef(mgrdata)->wait_debuginit, val);
                                    if (val)
                                        mgrdata.SignalAll();
                            }
                            else
                            {
                                    // FIXME: should wait for debugger config to arrive
                                    LockedMgrData::WriteRef(mgrdata)->wait_debuginit = false;
                                    mgrdata.SignalAll();
                            }
                            pending_debugger_connid = 0;
                            pending_debugger_link.reset();
                    }
            } break;


        case WHMResponseOpcode::LinkClosed:
            {
                    uint32_t linkid = iobuf->Read< uint32_t >();

                    RPCCOMM_PRINT("WHManager RPC LinkClosed, linkid: " << linkid);

                    // Kill the extlink, will auto-close the link on HareScript end
                    std::map< uint32_t, ExtLinkData >::iterator it = extlinks.find(linkid);
                    if (it != extlinks.end())
                    {
                            it->second.link->RemoveFromWaiterRead(*waiter);
                            extlinks.erase(it);
                    }
            } break;

        case WHMResponseOpcode::IncomingMessage:
            {
                    uint32_t linkid = iobuf->Read< uint32_t >();
                    uint64_t msgid = iobuf->Read< uint64_t >();
                    uint64_t replyto = iobuf->Read< uint64_t >();
                    bool lastpart = iobuf->Read< bool >();
                    std::pair< uint8_t const*, uint8_t const * > marshaldata = iobuf->ReadBinary();

                    bool single_part = false;
                    std::map< uint32_t, ExtLinkData >::iterator it = extlinks.find(linkid);
                    if (it != extlinks.end())
                    {
                            RPCCOMM_PRINT("WHManager RPC IncomingMessage, linkid: " << linkid << ", msgid: " << msgid << ", replyto: " << replyto << ", lastpart " << lastpart);

                            if (it->second.part_data.empty())
                            {
                                    if (!lastpart)
                                    {
                                            it->second.part_data.assign(marshaldata.first, marshaldata.second);
                                            it->second.part_msgid = msgid;
                                    }
                                    else
                                        single_part = true;
                            }
                            else if (it->second.part_msgid != msgid)
                            {
                                    // Kill the extlink, will auto-close the link on HareScript end
                                    it->second.link->RemoveFromWaiterRead(*waiter);
                                    extlinks.erase(it);
                                    break;
                            }
                            else
                                it->second.part_data.insert(it->second.part_data.end(), marshaldata.first, marshaldata.second);

                            if (!lastpart)
                                break;

                            HareScript::GlobalBlobManager *blobmgr(0);
                            std::shared_ptr< HareScript::IPCMessage2 > msg;
                            {
                                    LockedMgrData::WriteRef lock(mgrdata);
                                    if (!lock->jobmgr)
                                        return;
                                    lock->jobmgr->AllocateMessage(&msg);
                                    blobmgr = &lock->jobmgr->GetBlobManager();
                            }

                            msg->msgid = msgid;
                            msg->replyto = replyto;

                            std::unique_ptr< HareScript::MarshalPacket > packet;
                            msg->data.reset(new HareScript::MarshalPacket);
                            if (single_part)
                                msg->data->Read(marshaldata.first, marshaldata.second, blobmgr);
                            else
                            {
                                    msg->data->Read(it->second.part_data.begin(), it->second.part_data.end(), blobmgr);
                                    it->second.part_data.clear();
                            }

                            it->second.link->SendMessage(&msg, false);

                    }
            } break;

        case WHMResponseOpcode::GetProcessListResult:
            {
                    std::map< uint64_t, std::string > processes;

                    uint32_t count = iobuf->Read< uint32_t >();
                    for (unsigned i = 0; i < count; ++i)
                    {
                            uint64_t processcode = iobuf->Read< uint64_t >();
                            std::string name = iobuf->Read< std::string >();

                            processes.insert(std::make_pair(processcode, name));
                    }

                    for (std::map< uint32_t, ControlLinkData >::iterator it = controllinks.begin(); it != controllinks.end(); ++it)
                    {
                            if (!it->second.requested_processlists_replyids.empty())
                            {
                                    uint64_t replyto = it->second.requested_processlists_replyids.front();
                                    it->second.requested_processlists_replyids.pop_front();

                                    SendProcessListMessage(it->second.link, replyto, processes);
                            }
                    }
            } break;

        case WHMResponseOpcode::ConfigureLogsResult:
            {
                    uint32_t id = iobuf->Read< uint32_t >();
                    uint32_t count = iobuf->Read< uint32_t >();
                    std::vector< bool > results;
                    for (unsigned i = 0; i < count; ++i)
                        results.push_back(iobuf->Read< bool >());
                    {
                            LockedMgrData::WriteRef lock(mgrdata);
                            lock->configurelogresults[id] = results;
                    }
                    mgrdata.SignalAll();
            } break;

        case WHMResponseOpcode::FlushLogResult:
            {
                    uint32_t id = iobuf->Read< uint32_t >();
                    bool result = iobuf->Read< bool >();

                    std::vector< bool > results;
                    results.push_back(result);

                    {
                            LockedMgrData::WriteRef lock(mgrdata);
                            lock->configurelogresults[id] = results;
                    }
                    mgrdata.SignalAll();
            } break;

        case WHMResponseOpcode::SystemConfig:
            {
                    bool have_debugger = iobuf->Read< bool >();
                    std::pair< uint8_t const*,uint8_t const * > systemconfigdata = iobuf->ReadBinary();
                    std::shared_ptr< Blex::PodVector< uint8_t > > systemconfig(new Blex::PodVector< uint8_t >());
                    systemconfig->assign(systemconfigdata.first, systemconfigdata.second);

                    {
                            LockedMgrData::WriteRef lock(mgrdata);
                            lock->have_debugger = have_debugger;
                            lock->systemconfig = systemconfig;
                    }

                    SendUpdatedSystemConfigEvent();
            } break;

        default:
            RPCCOMM_PRINT("Unrecognized ManagerConnection opcode " << (unsigned)iobuf->GetOpcode());
        }

        if (iobufptr->get())
            AddToCache(*iobufptr);
        iobufptr->reset();
}


void ManagerConnection::SendRegisterPortResponseMessage(ControlLinkData &linkdata, uint64_t replyto, std::string const &port, bool success)
{
            using namespace HareScript;
            stackm.RecordInitializeEmpty(composevar);

            ColumnNameId col_type = localmapper.GetMapping("TYPE");
            VarId var_type = stackm.RecordCellCreate(composevar, col_type);
            stackm.SetSTLString(var_type, "createportresponse");

            ColumnNameId col_port = localmapper.GetMapping("PORT");
            VarId var_port = stackm.RecordCellCreate(composevar, col_port);
            stackm.SetSTLString(var_port, port);

            ColumnNameId col_success = localmapper.GetMapping("SUCCESS");
            VarId var_success = stackm.RecordCellCreate(composevar, col_success);
            stackm.SetBoolean(var_success, success);

            std::shared_ptr< HareScript::IPCMessage2 > msg;
            {
                    LockedMgrData::WriteRef lock(mgrdata);
                    if (!lock->jobmgr)
                        return;
                    lock->jobmgr->AllocateMessage(&msg);
            }
            msg->replyto = replyto;
            msg->data.reset(marshaller.WriteToNewPacket(composevar));
            linkdata.link->SendMessage(&msg, false);
}

void ManagerConnection::SendUnregisterPortResponseMessage(ControlLinkData &linkdata, uint64_t replyto, std::string const &port)
{
            using namespace HareScript;
            stackm.RecordInitializeEmpty(composevar);

            ColumnNameId col_type = localmapper.GetMapping("TYPE");
            VarId var_type = stackm.RecordCellCreate(composevar, col_type);
            stackm.SetSTLString(var_type, "unregisterportresponse");

            ColumnNameId col_port = localmapper.GetMapping("PORT");
            VarId var_port = stackm.RecordCellCreate(composevar, col_port);
            stackm.SetSTLString(var_port, port);

            std::shared_ptr< HareScript::IPCMessage2 > msg;
            {
                    LockedMgrData::WriteRef lock(mgrdata);
                    if (lock->jobmgr)
                        lock->jobmgr->AllocateMessage(&msg);
            }
            msg->replyto = replyto;
            msg->data.reset(marshaller.WriteToNewPacket(composevar));
            linkdata.link->SendMessage(&msg, false);
}

void ManagerConnection::SendSimpleResponseMessage(std::shared_ptr< HareScript::IPCLinkEndPoint > const &link, uint64_t replyto, std::string const &status)
{
            using namespace HareScript;
            stackm.RecordInitializeEmpty(composevar);

            ColumnNameId col_type = localmapper.GetMapping("STATUS");
            VarId var_type = stackm.RecordCellCreate(composevar, col_type);
            stackm.SetSTLString(var_type, status);

            std::shared_ptr< HareScript::IPCMessage2 > msg;
            {
                    LockedMgrData::WriteRef lock(mgrdata);
                    if (!lock->jobmgr)
                        return;
                    lock->jobmgr->AllocateMessage(&msg);
            }

            msg->replyto = replyto;
            msg->data.reset(marshaller.WriteToNewPacket(composevar));
            link->SendMessage(&msg, false);
}

void ManagerConnection::SendProcessListMessage(std::shared_ptr< HareScript::IPCLinkEndPoint > const &link, uint64_t replyto, std::map< uint64_t, std::string > const &processes)
{
            using namespace HareScript;
            stackm.RecordInitializeEmpty(composevar);

            ColumnNameId col_processes = localmapper.GetMapping("PROCESSES");
            ColumnNameId col_code = localmapper.GetMapping("CODE");
            ColumnNameId col_name = localmapper.GetMapping("NAME");
            VarId var_processes = stackm.RecordCellCreate(composevar, col_processes);
            stackm.InitVariable(var_processes, HareScript::VariableTypes::RecordArray);

            for (std::map< uint64_t, std::string >::const_iterator it = processes.begin(); it != processes.end(); ++it)
            {
                    VarId var_process = stackm.ArrayElementAppend(var_processes);
                    stackm.InitVariable(var_process, HareScript::VariableTypes::Record);

                    VarId var_code = stackm.RecordCellCreate(var_process, col_code);
                    stackm.SetInteger64(var_code, it->first);
                    VarId var_name = stackm.RecordCellCreate(var_process, col_name);
                    stackm.SetSTLString(var_name, it->second);
            }

            std::shared_ptr< HareScript::IPCMessage2 > msg;
            {
                    LockedMgrData::WriteRef lock(mgrdata);
                    if (!lock->jobmgr)
                        return;
                    lock->jobmgr->AllocateMessage(&msg);
            }

            msg->replyto = replyto;
            msg->data.reset(marshaller.WriteToNewPacket(composevar));
            link->SendMessage(&msg, false);
}

void ManagerConnection::CreateException(std::string const &what, Blex::PodVector< uint8_t > *msgdata)
{
            using namespace HareScript;
            stackm.RecordInitializeEmpty(composevar);

            ColumnNameId col_exception = localmapper.GetMapping("__EXCEPTION");
            ColumnNameId col_type = localmapper.GetMapping("TYPE");
            ColumnNameId col_what = localmapper.GetMapping("WHAT");
            ColumnNameId col_trace = localmapper.GetMapping("TRACE");

            VarId var_exception = stackm.RecordCellCreate(composevar, col_exception);
            stackm.RecordInitializeEmpty(var_exception);

            stackm.SetSTLString(stackm.RecordCellCreate(var_exception, col_type), "exception");
            stackm.SetSTLString(stackm.RecordCellCreate(var_exception, col_what), what);
            stackm.InitVariable(stackm.RecordCellCreate(var_exception, col_trace), HareScript::VariableTypes::RecordArray);

            HareScript::GlobalBlobManager *blobmgr(0);
            {
                    LockedMgrData::WriteRef lock(mgrdata);
                    if (lock->jobmgr)
                        blobmgr = &lock->jobmgr->GetBlobManager();
            }

            std::unique_ptr< MarshalPacket > packet(marshaller.WriteToNewPacket(composevar));
            packet->WriteToPodVector(msgdata, blobmgr);
}

void ManagerConnection::SendRegisterPortRPC(ControlLinkData &linkdata, uint64_t msgid, std::string const &port, bool isregister, bool need_unregister_response)
{
        IOBufferPtr iobuf;
        iobuf = GetIOBuffer();
        iobuf->ResetForSending();
        iobuf->Write(port);
        iobuf->Write(linkdata.connid);
        iobuf->Write(msgid);
        if (!isregister)
            iobuf->Write(need_unregister_response);

        iobuf->FinishForRequesting(uint8_t(isregister ? WHMRequestOpcode::RegisterPort : WHMRequestOpcode::UnregisterPort));

        RPCCOMM_PRINT("Scheduling RPC " << (isregister ? "RegisterPort" : "UnregisterPort") << ", portname: " << port << ", connid: " << linkdata.connid << ", msgid: " << msgid);
        transmitqueue.push(std::make_pair(0, iobuf));
}

void ManagerConnection::RegisterSelf(Database::TCPConnection &tcpconn)
{
        uint64_t processcode = LockedMgrData::ReadRef(mgrdata)->processcode;

        IOBufferPtr iobuf;
        iobuf = GetIOBuffer();
        iobuf->ResetForSending();
        iobuf->Write(processcode);
        iobuf->Write< std::string >(conn.GetClientName());
        iobuf->FinishForRequesting(uint8_t(WHMRequestOpcode::RegisterProcess));

        RPCCOMM_PRINT("Sending RPC RegisterProcess, processcode: " << processcode << ", name: " << conn.GetClientName());
        tcpconn.SendPacket(*iobuf);

        tcpconn.ReceivePacket(&*iobuf, Blex::DateTime::Now() + Blex::DateTime::Seconds(10));
        if (iobuf->GetOpcode() != WHMResponseOpcode::RegisterProcessResult)
            throw std::runtime_error("Did not get wanted RegisterProcessResult");

        RPCCOMM_PRINT("Received RPC RegisterProcessResult, processcode: " << processcode);

        processcode = iobuf->Read< uint64_t >();
        bool have_debugger = iobuf->Read< bool >();
        std::pair< uint8_t const*,uint8_t const * > systemconfigdata = iobuf->ReadBinary();

        std::shared_ptr< Blex::PodVector< uint8_t > > systemconfig(new Blex::PodVector< uint8_t >());
        systemconfig->assign(systemconfigdata.first, systemconfigdata.second);

        {
                LockedMgrData::WriteRef lock(mgrdata);
                lock->processcode = processcode;
                lock->have_debugger = have_debugger;
                lock->systemconfig = systemconfig;
        }
}

void ManagerConnection::Thread()
{
        Blex::SocketAddress whmanagerserver;
        if(conn.GetDbaseAddr().GetPort())
        {
                whmanagerserver = conn.GetDbaseAddr();
                whmanagerserver.SetPort(conn.GetDbaseAddr().GetPort()+2);
        }
        else
        {
                whmanagerserver.SetIPAddress("127.0.0.1");
                whmanagerserver.SetPort(13681); //FIXME don't hardcode, allow to configure
        }

        while(true)
        {
                bool must_abort;
                bool release_jobmgr;
                {
                        LockedMgrData::ReadRef lock(mgrdata);
                        must_abort = lock->abort;
                        release_jobmgr = lock->release_jobmgr;
                }
                if (must_abort || release_jobmgr)
                    ClearPortData(true);
                if (must_abort)
                    return;

                try
                {
                       Database::TCPConnection newconn;

                        //Open a connection to the database (ADDME: Should be a non-blocking timed connect) (ADDME: Merge with dbase verison into whrpc)
                        //FIXME Timed connect, port specification, prevent spinning, allow immediate response to 'abort'
                        RPCCOMM_PRINT("Connecting to whmanager");
                        if (newconn.sock.Connect( whmanagerserver ) != Blex::SocketError::NoError)
                        {
                                // Wait 2 secs, keep sensitive for abort
                                Blex::DateTime until = Blex::DateTime::Now() + Blex::DateTime::Msecs(2000);
                                while (true)
                                {
                                        LockedMgrData::ReadRef lock(mgrdata);
                                        if (lock->abort || lock->release_jobmgr)
                                            break;
                                        if (!lock.TimedWait(until))
                                            break;
                                }
                                throw Database::Exception(Database::ErrorConnectionRefused,"Cannot connect to management server");
                        }

                        RPCCOMM_PRINT("Connected to whmanager");

                        //Make the socket non-blocking
                        newconn.sock.SetBlocking(false);
                        //And disable nagle, RPC packets need to go out immediately
                        newconn.sock.SetNagle(false);
                        //No unlimited buffering
                        newconn.SetBufferAllPackets(false);

                        //FIXME shake hands DoHandshake(newconn.get());
                        RegisterSelf(newconn);

                        RPCCOMM_PRINT("Registered self, now fully connected");
                        LockedMgrData::WriteRef(mgrdata)->connected = true;
                        mgrdata.SignalAll();

                        // Notify everybody that the whmanager is there
                        SendConnectedEvent();


                        // Go handle communications
                        ConnectedLoop(newconn);
                }
                catch(std::exception &e)
                {
                        RPCCOMM_PRINT("ManagerConnection Exception " << typeid(e).name() << ": " << e.what());

                        ClearPortData(false);
                }

                LockedMgrData::WriteRef(mgrdata)->connected = false;
                mgrdata.SignalAll();
        }
}

void ManagerConnection::Start()
{
        subthread.Start();
}

void ManagerConnection::Stop()
{
        RPCCOMM_PRINT("Stopping manager connection");
        {
                LockedMgrData::WriteRef lock(mgrdata);
                lock->abort=true;
                lock->aborttimeout = Blex::DateTime::Now() + Blex::DateTime::Seconds(3);

                IOBufferPtr iobuf(new Database::IOBuffer);
                iobuf->ResetForSending();
                iobuf->FinishForRequesting(WHMRequestOpcode::Disconnect);

                LockedPushIntoQueue(lock, &iobuf);
                RPCCOMM_PRINT("Pushed disconnect into queue: "<< lock->queue.size());
        }

        mgrdata.SignalAll();
        subthread.WaitFinish();
}

bool ManagerConnection::LockedPushIntoQueue(LockedMgrData::WriteRef &lock, IOBufferPtr *iobuf)
{
        if (lock->queue.size() >= 16)
        {
                if (!lock->connected)
                    return false;

                RPCCOMM_PRINT("Outgoing manager queue has 16+ items, waiting");
                do
                    lock.Wait();
                while (lock->queue.size() >= 16);
                RPCCOMM_PRINT("Wait finished");
        }
        lock->queue.push(*iobuf);
        iobuf->reset();
        return true;
}

void ManagerConnection::WaitForConnection()
{
        RPCCOMM_PRINT("Waiting for connection");
        Blex::DateTime until = Blex::DateTime::Now() + Blex::DateTime::Seconds(3);
        LockedMgrData::ReadRef lock(mgrdata);
        while (true)
        {
                if (lock->connected || lock->abort)
                    break;
                if (!lock.TimedWait(until))
                    break;
        }
}

void ManagerConnection::WaitForDebugInit()
{
        RPCCOMM_PRINT("Waiting for debug init");
        Blex::DateTime until = Blex::DateTime::Now() + Blex::DateTime::Seconds(3);
        LockedMgrData::ReadRef lock(mgrdata);
        while (true)
        {
                if (lock->abort || !lock->jobmgr || !lock->have_debugger || !lock->wait_debuginit)
                {
                        RPCCOMM_PRINT("Debug init wait result: " << !lock->wait_debuginit);
                        break;
                }
                if (!lock.TimedWait(until))
                {
                        RPCCOMM_PRINT("Debug init wait timeout");
                        break;
                }
                RPCCOMM_PRINT("Waiting for debug init (signalled, retest)");
        }
}

void ManagerConnection::DistributeNotificationEvent(std::shared_ptr< Blex::NotificationEvent > const &event)
{
        IOBufferPtr iobuf(new Database::IOBuffer);
        iobuf->ResetForSending();
        iobuf->Write(event->name);
        iobuf->WriteBinary(event->payload.size(), event->payload.begin());
        iobuf->FinishForRequesting(WHMRequestOpcode::SendEvent);

        {
                LockedMgrData::WriteRef lock(mgrdata);
                LockedPushIntoQueue(lock, &iobuf);
                RPCCOMM_PRINT("Pushed broadcast into queue: " << event->name << ": "<< lock->queue.size());
        }
        mgrdata.SignalAll();
}

bool ManagerConnection::ConfigureLogs(std::vector< LogConfig > const &config, std::vector< bool > *result)
{
        uint32_t requestid = ++LockedMgrData::WriteRef(mgrdata)->requestcounter;

        IOBufferPtr iobuf(new Database::IOBuffer);
        iobuf->ResetForSending();
        iobuf->Write<uint32_t>(requestid);
        iobuf->Write<uint32_t>(config.size());
        for (std::vector< LogConfig >::const_iterator it = config.begin(); it != config.end(); ++it)
        {
                iobuf->Write< std::string >(it->tag);
                iobuf->Write< std::string >(it->logroot);
                iobuf->Write< std::string >(it->logname);
                iobuf->Write< std::string >(it->logextension);
                iobuf->Write< bool >(it->autoflush);
                iobuf->Write< uint32_t >(it->rotates);
                iobuf->Write< bool >(it->with_mseconds);
        }
        iobuf->FinishForRequesting(WHMRequestOpcode::ConfigureLogs);

        {
                LockedMgrData::WriteRef lock(mgrdata);
                LockedPushIntoQueue(lock, &iobuf);
                RPCCOMM_PRINT("Pushed ConfigureLogs into queue: "<< lock->queue.size());
        }

        mgrdata.SignalAll();

        {
                LockedMgrData::WriteRef lock(mgrdata);
                while (lock->connected && !lock->configurelogresults.count(requestid))
                    lock.Wait();

                if (result && lock->connected)
                    *result = lock->configurelogresults[requestid];

                lock->configurelogresults.erase(requestid);
                return lock->connected;
        }
}

void ManagerConnection::Log(std::string const &logname, std::string const &logline)
{
        IOBufferPtr iobuf(new Database::IOBuffer);
        iobuf->ResetForSending();
        iobuf->Write(logname);
        iobuf->Write(logline);
        iobuf->FinishForRequesting(WHMRequestOpcode::Log);

        {
                LockedMgrData::WriteRef lock(mgrdata);
                LockedPushIntoQueue(lock, &iobuf);
                RPCCOMM_PRINT("Pushed Log into queue: " << logname << ": "<< lock->queue.size());
        }
        mgrdata.SignalAll();
}

bool ManagerConnection::FlushLog(std::string const &logname)
{
        uint32_t requestid = ++LockedMgrData::WriteRef(mgrdata)->requestcounter;

        IOBufferPtr iobuf(new Database::IOBuffer);
        iobuf->ResetForSending();
        iobuf->Write<uint32_t>(requestid);
        iobuf->Write<std::string>(logname);
        iobuf->FinishForRequesting(WHMRequestOpcode::FlushLog);

        {
                LockedMgrData::WriteRef lock(mgrdata);
                LockedPushIntoQueue(lock, &iobuf);
                RPCCOMM_PRINT("Pushed FlushLog into queue: "<< lock->queue.size());
        }

        mgrdata.SignalAll();

        std::vector< bool > result;
        {
                LockedMgrData::WriteRef lock(mgrdata);
                while (lock->connected && !lock->configurelogresults.count(requestid))
                    lock.Wait();

                if (lock->connected)
                    result = lock->configurelogresults[requestid];
                lock->configurelogresults.erase(requestid);
        }

        return !result.empty() && result[0];
}

void ManagerConnection::SetSystemConfig(uint8_t const *data, unsigned datalen)
{
        // Prepare local config and message to send to the whmanager
        std::shared_ptr< Blex::PodVector< uint8_t > > systemconfig(new Blex::PodVector< uint8_t >());
        systemconfig->assign(data, data + datalen);

        IOBufferPtr iobuf(new Database::IOBuffer);
        iobuf->ResetForSending();
        iobuf->WriteBinary(datalen, data);
        iobuf->FinishForRequesting(WHMRequestOpcode::SetSystemConfig);

        {
                LockedMgrData::WriteRef lock(mgrdata);

                // Overwrite the local system config
                lock->systemconfig = systemconfig;

                // Send to whmanager
                LockedPushIntoQueue(lock, &iobuf);
                RPCCOMM_PRINT("Pushed SetSystemConfig into queue: "<< lock->queue.size());
        }

        mgrdata.SignalAll();
}

void ManagerConnection::GetSystemConfig(std::shared_ptr< Blex::PodVector< uint8_t > const > *data)
{
        LockedMgrData::WriteRef lock(mgrdata);
        *data = lock->systemconfig;
}

void ManagerConnection::WaitSendQueueEmpty()
{
        {
                LockedMgrData::WriteRef lock(mgrdata);
                while (lock->connected && !lock->queue.empty())
                    lock.Wait();
        }
}


void ManagerConnection::SetJobMgr(HareScript::JobManager *jobmgr)
{
        {
                LockedMgrData::WriteRef lock(mgrdata);
                if (lock->jobmgr)
                    throw std::runtime_error("Jobmanager already set in ManagerConnection");
                lock->jobmgr = jobmgr;
                lock->wait_debuginit = jobmgr && lock->have_debugger;
        }
        mgrdata.SignalAll();
}

void ManagerConnection::ResetJobMgr()
{
        {
                LockedMgrData::WriteRef lock(mgrdata);
                if (!lock->jobmgr)
                    return;

                lock->release_jobmgr = true;
        }
        mgrdata.SignalAll();

        LockedMgrData::WriteRef lock(mgrdata);
        while (lock->jobmgr)
        {
                lock.Wait();
        }
}

bool ManagerConnection::InitDebuggerConnection(Blex::PipeWaiter *waiter)
{
        RPCCOMM_PRINT("InitDebuggerConnection");

        std::shared_ptr< HareScript::IPCLinkEndPoint > endpoint_1;

        ExtLinkData edata;

        {
                LockedMgrData::WriteRef lock(mgrdata);
                if (!lock->jobmgr || !lock->have_debugger)
                {
                        RPCCOMM_PRINT("InitDebugger: no jobmgr or no debugger present");
                        return false;
                }

                RPCCOMM_PRINT("InitDebugger: Have jobmanager and debugger");

                // Create the link to the debugger
                lock->jobmgr->CreateIPCLink(&endpoint_1, &edata.link);
                edata.linkid = ++lock->conncounter;
        }

        edata.link->AddToWaiterRead(*waiter);
        extlinks.insert(std::make_pair(edata.linkid, edata));

        std::string port = "wh:debugmgr_internal";

        IOBufferPtr iobuf;
        iobuf = GetIOBuffer();
        iobuf->ResetForSending();
        iobuf->Write(port);
        iobuf->Write(edata.linkid);
        iobuf->Write< uint64_t >(1);
        iobuf->FinishForRequesting(WHMRequestOpcode::ConnectLink);
        RPCCOMM_PRINT("Scheduling RPC ConnectLink, portname: " << port << ", linkid: " << edata.linkid << ", replyto 1");
        transmitqueue.push(std::make_pair(0, iobuf));

        pending_debugger_connid = edata.linkid;
        pending_debugger_link = endpoint_1;

        return true;
}

ManagerConnection::AutoJobMgrRegistrar::AutoJobMgrRegistrar(ManagerConnection &_conn, HareScript::JobManager *jobmgr)
: conn(_conn)
{
        DEBUGPRINT("AutoJobMgrRegistrar constructor");
        conn.SetJobMgr(jobmgr);
}

ManagerConnection::AutoJobMgrRegistrar::~AutoJobMgrRegistrar()
{
        DEBUGPRINT("AutoJobMgrRegistrar destructor");
        conn.ResetJobMgr();
}

} //end of namespace WHCore
