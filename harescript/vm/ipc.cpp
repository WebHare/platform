//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include "ipc.h"
#include "hsvm_dllinterface.h"
#include "hsvm_context.h"
#include "errors.h"
#include "hsvm_processmgr.h"

// Show all job manager/port/message stuff
//#define SHOW_JOBMANAGER
//#define SHOW_PORTS
//#define SHOW_PORTS_EVENTS

#if defined(SHOW_JOBMANAGER) && defined(WHBUILD_DEBUG)
 #define PM_PRINT(x) DEBUGPRINT(x)
 #define PM_ONLY(x) x
#else
 #define PM_PRINT(x)
 #define PM_ONLY(x)
#endif

#if defined(SHOW_PORTS) && defined(WHBUILD_DEBUG)
 #define PO_PRINT(x) DEBUGPRINT(x)
 #define PO_ONLY(x) x
#else
 #define PO_PRINT(x)
 #define PO_ONLY(x)
#endif

#if defined(SHOW_PORTS_EVENTS) && defined(WHBUILD_DEBUG)
 #define POE_PRINT(x) DEBUGPRINT(x)
 #define POE_ONLY(x) x
#else
 #define POE_PRINT(x)
 #define POE_ONLY(x)
#endif

namespace HareScript
{

// -----------------------------------------------------------------------------
//
// IPCMessage2
//

IPCMessage2::~IPCMessage2()
{
}

void IPCMessage2::Reset()
{
        msgid = 0;
        replyto = 0;
        data.reset();
}

// -----------------------------------------------------------------------------
//
// IPCNamedPort
//

IPCNamedPort::IPCNamedPort(JobManager &_jobmgr)
: OutputObject(0, "IPC named port")
, jobmgr(_jobmgr)
{
}

IPCNamedPort::~IPCNamedPort()
{
        PO_PRINT("Destroying named port " << this << " (name: " << name << ")");

        BackLog backlog_erase;

        {
                JobManager::LockedJobData::WriteRef lock(jobmgr.jobdata);
                if (!name.empty())
                    lock->namedports.erase(name);

                backlog_erase.swap(backlog);
        }
}

bool IPCNamedPort::AddToWaiterRead(Blex::PipeWaiter &waiter)
{
        PM_PRINT("Adding named port " << this << " (name: " << name << ") to waiter (vm: " << vm << ") signalled " << (event.IsSignalled() ? "yes" : "no") << " event: " << &event);

        if (event.IsSignalled())
            return true;

        waiter.AddEvent(event);
        return false;
}

OutputObject::SignalledStatus IPCNamedPort::IsReadSignalled(Blex::PipeWaiter * /*waiter*/)
{
        PM_PRINT("Named port " << this << " (name: " << name << ") checking signalled " << (event.IsSignalled() ? "yes" : "no") << " event: " << &event);

        return event.IsSignalled() ? Signalled : NotSignalled;
}

void IPCNamedPort::RemoveFromWaiterRead(Blex::PipeWaiter &waiter)
{
        waiter.RemoveEvent(event);
        PM_PRINT("Removed name port " << this << " (name: " << name << ") from waiter (vm: " << vm << ") event: " << &event);
}

std::shared_ptr< IPCLinkEndPoint > IPCNamedPort::Accept()
{
        /// Endpoint from backlog. Keep the destruction out of the lock
        std::shared_ptr< IPCLinkEndPoint > endpoint;

        while (true)
        {
                // Get the first link from the backlog
                {
                        JobManager::LockedJobData::WriteRef lock(jobmgr.jobdata);
                        if (backlog.empty())
                        {
                                PO_PRINT("Port " << this << ": connection backlog is empty");
                                return endpoint;
                        }

                        endpoint = backlog.front();

                        PO_PRINT("Port " << this << ": accepting connection " << endpoint.get());

                        backlog.pop_front();
                        if (backlog.empty())
                            event.SetSignalled(false);
                }

                // If invalid: skip it (deletion is automagically, not registered as outputobj anyway)
                if (endpoint->IsBroken())
                {
                        // Keep destruction out of the lock
                        PO_PRINT("Port " << this << ": connection " << endpoint.get() << " has errors, dropping it");
                        endpoint.reset();
                        continue;
                }

                return endpoint;
        }
}


std::shared_ptr< IPCLinkEndPoint > IPCNamedPort::Connect()
{
        std::shared_ptr< IPCLinkEndPoint > result;
        std::shared_ptr< IPCLinkEndPoint > other;

        jobmgr.CreateIPCLink(&result, &other);

        JobManager::LockedJobData::WriteRef lock(jobmgr.jobdata);

        if (backlog.empty())
            event.SetSignalled(true);

        backlog.push_back(other);
        return result;
}

// -----------------------------------------------------------------------------
//
// IPCLinkData
//

IPCLinkData::IPCLinkData()
: event_false(*this, false)
, event_true(*this, true)
{
}

// -----------------------------------------------------------------------------
//
// IPCLinkData :: IPCLinkEvent
//

IPCLinkData::IPCLinkEvent::IPCLinkEvent(IPCLinkData &_link, bool _endpoint_side)
: link(_link)
, endpoint_side(_endpoint_side)
{
}

bool IPCLinkData::IPCLinkEvent::IsSignalled()
{
        bool is_signalled;
        POE_ONLY(IPCLinkEndPoint *ep;)
        {
                IPCLinkData::LockedData::WriteRef lock(link.data);

                is_signalled = lock->refcount != 2 || !lock->queues[endpoint_side].empty();
                POE_ONLY(ep = lock->endpoints[endpoint_side];)
        }
        POE_PRINT("Checking signalled for endpoint " << ep << ": " << is_signalled);

        return is_signalled;
}


// -----------------------------------------------------------------------------
//
// IPCLinkEndPoint
//

IPCLinkEndPoint::IPCLinkEndPoint(JobManager &_jobmgr, std::shared_ptr< IPCLinkData > const &_link, bool _endpoint_side)
: OutputObject(0, "IPC link endpoint")
, jobmgr(_jobmgr)
, link(_link)
, endpoint_side(_endpoint_side)
{
        POE_PRINT("Create endpoint " << this << ", event: " << &GetEvent());
}

IPCLinkEndPoint::~IPCLinkEndPoint()
{
        PO_PRINT("Destroying endpoint " << this);
        POE_ONLY(IPCLinkEndPoint *ep;);

        bool signal_other;
        {
                IPCLinkData::LockedData::WriteRef lock(link->data);

                signal_other = lock->refcount == 2 && lock->queues[!endpoint_side].empty();
                --lock->refcount;

                // Remove self from endpoint list
                lock->endpoints[endpoint_side] = 0;

                POE_ONLY(ep = lock->endpoints[!endpoint_side];)
        }

        // Set the other end to signalled if its queue was empty
        if (signal_other)
        {
                POE_ONLY(bool is_signalled = link->GetEvent(!endpoint_side).IsSignalled());
                link->GetEvent(!endpoint_side).StateChanged();
                POE_PRINT("Link endpoint closed, signalling endpoint " << ep << " to " << is_signalled);
        }
}


bool IPCLinkEndPoint::IsBroken()
{
        IPCLinkData::LockedData::WriteRef lock(link->data);

        // Link is broken when an endpoint is gone and no messages left in queue
        // FIXME: should we check the queue for expired messaged?
        return lock->refcount != 2 && lock->queues[endpoint_side].empty();
}

bool IPCLinkEndPoint::ReceiveMessage(std::shared_ptr< IPCMessage2 > *msg)
{
        // Reset the message ptr, so we won't return a valid msg when none was in queue.
        msg->reset();

        bool signal_change = false; ///< Whether the event changed state, and a StateChanged call is needed.
        bool got_message = false; ///< Whether we found a valid message
        bool have_other; ///< Whether the other link is still present

        POE_ONLY(unsigned pre_in_queue;)
        POE_ONLY(int nowqueue = 0;)

        // Signalling is done out of link lock, so the link lock must be contained in own scope.
        {
                IPCLinkData::LockedData::WriteRef lock(link->data);
                IPCLinkData::MessageQueue &queue = lock->queues[endpoint_side];

                PO_PRINT("Receiving message at endpoint " << this << " from " << lock->endpoints[!endpoint_side]);
                POE_ONLY(pre_in_queue = queue.size();)

                // Check if the other link is still present
                have_other = lock->refcount == 2;

                if (!queue.empty())
                {
                        // Pop the first message in the queue
                        msg->swap(queue.front());
                        queue.pop_front();

                        POE_PRINT("POP MSG ON " << this << " (queue: " << &queue << ")");
                        POE_ONLY(nowqueue = queue.size();)

                        // If that was the last message, and the other endpoint is still present, our event just got unsignalled.
                        if (queue.empty() && have_other)
                            signal_change = true;

                        got_message = true;
                }
        }

        if (signal_change)
        {
                // If the queue is now empty, broadcast the state-change of the event to the waiters
                POE_ONLY(bool is_signalled = link->GetEvent(endpoint_side).IsSignalled();)

                link->GetEvent(endpoint_side).StateChanged();
                POE_PRINT("Last message received, signalling endpoint " << this << " to " << is_signalled << ", got msg: " << (msg->get() ? "yes" : "no") << " " << got_message << " nq:" << nowqueue << " ha: " << have_other << " id: " << (*msg)->msgid);
        }
        POE_ONLY(else
        {
                if (msg->get())
                    POE_PRINT("Got message on endpoint " << this << ", more pending, id: " << (*msg)->msgid);
                else
                    POE_PRINT("Check for messages: none present on " << this << " pre: " << pre_in_queue);
        })

        return got_message;
}

std::pair< SendResult::Type, uint64_t > IPCLinkEndPoint::SendMessage(std::unique_ptr< IPCMessage2 > *msg, bool allow_flowcontrol)
{
        std::shared_ptr< IPCMessage2 > ptr;
        ptr.reset(msg->release());

        return SendMessage(&ptr, allow_flowcontrol);
}

std::pair< SendResult::Type, uint64_t > IPCLinkEndPoint::SendMessage(std::shared_ptr< IPCMessage2 > *ptr, bool allow_flowcontrol)
{
        bool was_empty;

        // Get a globally unique message id from the jobmanager if not pre-set
        uint64_t msgid = (*ptr)->msgid;
        if (!msgid)
        {
                JobManager::LockedMessagingData::WriteRef lock(jobmgr.messagingdata);
                msgid = ++lock->gen_id;
        }

        POE_ONLY(IPCLinkEndPoint *ep;)
        {
                IPCLinkData::LockedData::WriteRef lock(link->data);

                PO_PRINT("Sending message from endpoint " << this << " to " << lock->endpoints[!endpoint_side]);
                POE_ONLY(ep = lock->endpoints[!endpoint_side];)

                if (lock->refcount != 2)
                {
                        POE_PRINT("Refcount != 2, not sending message on " << this);
                        return std::make_pair(SendResult::Gone, 0);
                }

                (*ptr)->msgid = msgid;//++lock->gen_id;

                // Record if the queue was empty, the event will change state if so.
                was_empty = lock->queues[!endpoint_side].empty();

                if (allow_flowcontrol && lock->queues[!endpoint_side].size() >= 64)
                    return std::make_pair(SendResult::LinkFull, 0);

                // Insert the message into the queue. Avoid locks by swapping ptr to back of
                // queue. Has nice side effect that *ptr is cleared.
                lock->queues[!endpoint_side].push_back(std::shared_ptr< IPCMessage2 >());
                lock->queues[!endpoint_side].back().swap(*ptr);

                PO_PRINT(" Messages in queue at " << lock->endpoints[!endpoint_side] << ": " << lock->queues[!endpoint_side].size());
        }

        if (was_empty)
        {
                // The queue of the other was empty, so the event has become signalled now.
                // Call StateChanged now, out of the link-lock to avoid as much lock-contention as possible
                // (though StateChanged notifies waiters within a lock of its own, creating a contentionpoint again)

                POE_ONLY(bool is_signalled = link->GetEvent(!endpoint_side).IsSignalled();)
                link->GetEvent(!endpoint_side).StateChanged();
                POE_PRINT("First message sent, id: " << msgid << " signalling endpoint " << ep << " to " << is_signalled << " (from: " << this << ")");
        }
        else
        {
                POE_PRINT("Put message on endpoint " << ep << ", others pending, id: " << msgid);
        }

        return std::make_pair(SendResult::Sent, msgid);
}

bool IPCLinkEndPoint::AddToWaiterRead(Blex::PipeWaiter &waiter)
{
        Blex::Event &event = link->GetEvent(endpoint_side);

        // First add to event: signalled state can change.
        waiter.AddEvent(event);

        bool is_signalled = event.IsSignalled();

        PM_PRINT("Added endpoint " << this << " to waiter (vm: " << vm << ") signalled " << (is_signalled ? "yes" : "no") << " event: " << &event);

        if (is_signalled)
            return true;

        return false;
}

OutputObject::SignalledStatus IPCLinkEndPoint::IsReadSignalled(Blex::PipeWaiter *)
{
        Blex::Event &event = link->GetEvent(endpoint_side);

        bool is_signalled = event.IsSignalled();

        PM_PRINT("Endpoint " << this << " checking signalled " << (is_signalled ? "yes" : "no") << " event: " << &event);
        return is_signalled ? Signalled : NotSignalled;
}

void IPCLinkEndPoint::RemoveFromWaiterRead(Blex::PipeWaiter &waiter)
{
        Blex::Event &event = link->GetEvent(endpoint_side);
        waiter.RemoveEvent(event);

        PM_PRINT("Removed endpoint " << this << " from waiter (vm: " << vm << ") event: " << &event);
}

void CreateNamedIPCPort(VarId id_set, VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        if(!jobmgr)
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        std::string name = HSVM_StringGetSTD(*vm, HSVM_Arg(0));

        if (name.empty())
            throw VMRuntimeError(Error::InternalError, "Name of an IPC port may not be empty");

        std::shared_ptr< IPCNamedPort > port;
        port = jobmgr->CreateNamedPort(name);

        if (port.get())
        {
                port->Register(*vm);
                HSVM_IntegerSet(*vm, id_set, port->GetId());
                jmcontext->namedports.insert(std::make_pair(port->GetId(), port));
        }
        else
            HSVM_IntegerSet(*vm, id_set, 0);
}

void CloseNamedIPCPort(VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());

        int32_t portid = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        if (jmcontext->namedports.find(portid) == jmcontext->namedports.end())
            throw VMRuntimeError(Error::InternalError, "Cannot close an IPC port that does not exist");

        jmcontext->namedports.erase(portid);
}

void ConnectToIPCPort(VarId id_set, VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        if(!jobmgr)
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        std::string name = HSVM_StringGetSTD(*vm, HSVM_Arg(0));

        std::shared_ptr< IPCLinkEndPoint > endpoint;
        endpoint = jobmgr->ConnectToNamedPort(name);
        if (endpoint.get())
        {
                PO_PRINT("Connecting to named port " << name << ", created link " << endpoint.get());
                endpoint->Register(*vm);
                HSVM_IntegerSet(*vm, id_set, endpoint->GetId());
                jmcontext->linkendpoints.insert(std::make_pair(endpoint->GetId(), endpoint));
        }
        else
        {
                PO_PRINT("Tried to connecting to named port " << name << ", but it didn't exist");
                HSVM_IntegerSet(*vm, id_set, 0);
        }
}

void AcceptIPCConnection(VarId id_set, VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());
        int32_t namedport = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        std::map< int32_t, std::shared_ptr< IPCNamedPort > >::iterator it = jmcontext->namedports.find(namedport);

        if (it == jmcontext->namedports.end())
        {
                HSVM_IntegerSet(*vm, id_set, 0);
                return;
        }

        std::shared_ptr< IPCLinkEndPoint > endpoint;
        endpoint = it->second->Accept();

        if (endpoint.get())
        {
                endpoint->Register(*vm);
                HSVM_IntegerSet(*vm, id_set, endpoint->GetId());
                jmcontext->linkendpoints.insert(std::make_pair(endpoint->GetId(), endpoint));
        }
        else
            HSVM_IntegerSet(*vm, id_set, 0);
}

void CloseIPCEndPoint(VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());

        int32_t portid = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        if (jmcontext->linkendpoints.find(portid) == jmcontext->linkendpoints.end())
            throw VMRuntimeError(Error::InternalError, "Cannot close an IPC link endpoint that does not exist");

        jmcontext->linkendpoints.erase(portid);
}


void SendIPCMessage2(VarId id_set, VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        StackMachine &stackm = vm->GetStackMachine();

        int32_t endpointid = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        VarId msgvar = HSVM_Arg(1);
        uint64_t replyto = stackm.GetInteger64(HSVM_Arg(2));

        std::map< int32_t, std::shared_ptr< IPCLinkEndPoint > >::iterator it = jmcontext->linkendpoints.find(endpointid);

        if (it == jmcontext->linkendpoints.end())
        {
                jobmgr->SetSimpleErrorStatus(vm, id_set, "error");
                return;
        }

        std::shared_ptr< IPCMessage2 > msg;
        jobmgr->AllocateMessage(&msg);

        msg->replyto = replyto;
        msg->data.reset(vm->GetIPCMarshaller().WriteToNewPacket(msgvar));
        std::pair< SendResult::Type, uint64_t > res = it->second->SendMessage(&msg, true);

        if (res.first == SendResult::Gone)
        {
                jobmgr->SetSimpleErrorStatus(vm, id_set, "gone");
                return;
        }
        if (res.first == SendResult::LinkFull)
        {
                jobmgr->SetSimpleErrorStatus(vm, id_set, "linkfull");
                return;
        }

        jobmgr->SetOkStatus2(vm, id_set, res.second);
}

void ReceiveIPCMessage2(VarId id_set, VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        StackMachine &stackm = vm->GetStackMachine();

        int32_t endpointid = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        std::map< int32_t, std::shared_ptr< IPCLinkEndPoint > >::iterator it = jmcontext->linkendpoints.find(endpointid);

        if (it == jmcontext->linkendpoints.end())
        {
                jobmgr->SetSimpleErrorStatus(vm, id_set, "error");
                return;
        }

        std::shared_ptr< IPCMessage2 > msg;
        if (!it->second->ReceiveMessage(&msg))
        {
                if (!it->second->IsBroken())
                    jobmgr->SetSimpleErrorStatus(vm, id_set, "none");
                else
                    jobmgr->SetSimpleErrorStatus(vm, id_set, "gone");
                return;
        }

        jmcontext->CheckColumnMappings(vm);

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);

        stackm.SetString(HSVM_RecordCreate(*vm, id_set, jmcontext->col_status), Blex::StringPair::FromStringConstant("ok"));
        stackm.SetInteger64(HSVM_RecordCreate(*vm, id_set, jmcontext->col_msgid), msg->msgid);
        stackm.SetInteger64(HSVM_RecordCreate(*vm, id_set, jmcontext->col_replyto), msg->replyto);
        vm->GetIPCMarshaller().ReadMarshalPacket(HSVM_RecordCreate(*vm, id_set, jmcontext->col_msg), &msg->data);

        jobmgr->DiscardMessage(&msg);
}

void IsIPCLinkValid(VarId id_set, VirtualMachine *vm)
{
        JobManagerContext jmcontext(vm->GetContextKeeper());

        int32_t endpointid = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        std::map< int32_t, std::shared_ptr< IPCLinkEndPoint > >::iterator it = jmcontext->linkendpoints.find(endpointid);

        if (it == jmcontext->linkendpoints.end())
        {
                HSVM_BooleanSet(*vm, id_set, false);
                return;
        }

        HSVM_BooleanSet(*vm, id_set, !it->second->IsBroken());
}

void GetIPCLinkToParent(VarId id_set, VirtualMachine *vm)
{
        if(!vm->GetVMGroup()->GetJobManager())
        {
                HSVM_IntegerSet(*vm, id_set, 0);
                return;
//            throw VMRuntimeError(Error::InternalError, "Job management not available");
        }

        JobManagerContext jmcontext(vm->GetContextKeeper());

        VMGroup *group = vm->GetVMGroup();

        if (group->parentipclink.get())
        {
                group->parentipclink->Register(*vm);
                HSVM_IntegerSet(*vm, id_set, group->parentipclink->GetId());
                jmcontext->linkendpoints.insert(std::make_pair(group->parentipclink->GetId(), group->parentipclink));
                group->parentipclink.reset();
        }
        else
            HSVM_IntegerSet(*vm, id_set, 0);
}

void GetIPCLinkToJob(VarId id_set, VirtualMachine *vm)
{
        if(!vm->GetVMGroup()->GetJobManager())
            throw VMRuntimeError(Error::InternalError, "Job management not available");

        int32_t handle = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        JobManagerContext jmcontext(vm->GetContextKeeper());

        std::map< int32_t, std::shared_ptr< Job > >::iterator it = jmcontext->jobs.find(handle);
        if (it == jmcontext->jobs.end())
            throw VMRuntimeError(Error::InternalError, "Job with this id does not exist");

        if (it->second->childipclink.get())
        {
                std::shared_ptr< IPCLinkEndPoint > &endpoint = it->second->childipclink;

                endpoint->Register(*vm);
                HSVM_IntegerSet(*vm, id_set, endpoint->GetId());
                jmcontext->linkendpoints.insert(std::make_pair(endpoint->GetId(), endpoint));

                it->second->childipclink.reset();
        }
        else
            HSVM_IntegerSet(*vm, id_set, 0);
}

void InitIPC(Blex::ContextRegistrator &, BuiltinFunctionsRegistrator &bifreg)
{
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_CREATENAMEDIPCPORT::I:SB", CreateNamedIPCPort));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_CLOSENAMEDIPCPORT:::I", CloseNamedIPCPort));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_CONNECTTOIPCPORT::I:S", ConnectToIPCPort));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_ACCEPTIPCCONNECTION::I:I", AcceptIPCConnection));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_CLOSEIPCENDPOINT:::I", CloseIPCEndPoint));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SENDIPCMESSAGE::R:IV6", SendIPCMessage2));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_RECEIVEIPCMESSAGE::R:I", ReceiveIPCMessage2));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_ISIPCLINKVALID::B:I", IsIPCLinkValid));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_GETIPCLINKTOPARENT::I:", GetIPCLinkToParent));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_GETIPCLINKTOJOB::I:I", GetIPCLinkToJob));
}

} // End of namespace HareScript
