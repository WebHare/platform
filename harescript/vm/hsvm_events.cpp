//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>


#include "baselibs.h"
#include "hsvm_context.h"
#include "hsvm_events.h"

// Show all events debugging stuff
#define SHOW_EVENTS

#if defined(SHOW_EVENTS) && defined(DEBUG)
 #define EVT_PRINT(x) DEBUGPRINT(x)
 #define EVT_ONLY(x) x
#else
 #define EVT_PRINT(x)
 #define EVT_ONLY(x)
#endif

//---------------------------------------------------------------------------
//
// This library adds backend support functions for events
//
//---------------------------------------------------------------------------
namespace HareScript {


Baselibs::EventStream::EventStream(HSVM *vm, Blex::NotificationEventManager &eventmgr)
: OutputObject(vm, "Event stream")
, queue(eventmgr)
{
}

Baselibs::EventStream::~EventStream()
{
}

bool Baselibs::EventStream::AddToWaiterRead(Blex::PipeWaiter &waiter)
{
        if (queue.IsSignalled())
            return true;

        waiter.AddEvent(queue);
        return false;
}

void Baselibs::EventStream::RemoveFromWaiterRead(Blex::PipeWaiter &waiter)
{
        waiter.RemoveEvent(queue);
}

OutputObject::SignalledStatus Baselibs::EventStream::IsReadSignalled(Blex::PipeWaiter *)
{
        return queue.IsSignalled() ? Signalled : NotSignalled;
}

void Baselibs::EventStream::TryRead(HSVM_VariableId id_set)
{
        HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);
        auto evt = queue.ShiftEvent();

        if (evt)
        {
                auto myvm = GetVirtualMachine(vm);
                StackMachine &stackm = myvm->GetStackMachine();
                stackm.SetSTLString(stackm.RecordCellCreate(id_set, myvm->cn_cache.col_name), evt->name);
                VarId value = stackm.RecordCellCreate(id_set, myvm->cn_cache.col_value);

                myvm->event_marshaller.ReadFromVector(value, evt->payload);
        }
}

void HS_Event_CreateStream(VarId id_set, VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());

        Blex::NotificationEventManager &eventmgr = vm->environment.GetNotificationEventMgr();

        auto ptr = std::make_shared< Baselibs::EventStream >(*vm, eventmgr);
        context->eventstreams[ptr->GetId()] = ptr;

        HSVM_IntegerSet(*vm, id_set, ptr->GetId());
}

void HS_Event_CloseStream(VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        uint32_t id = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        auto itr = context->eventstreams.find(id);
        if (itr != context->eventstreams.end())
            context->eventstreams.erase(itr);
}

void HS_Event_StreamModifySubscriptions(VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        StackMachine &stackm = vm->GetStackMachine();
        uint32_t id = stackm.GetInteger(HSVM_Arg(0));

        std::vector< std::string > masks;
        uint32_t add_size = stackm.ArraySize(HSVM_Arg(1));
        uint32_t remove_size = stackm.ArraySize(HSVM_Arg(2));
        bool reset = stackm.GetBoolean(HSVM_Arg(3));

        masks.reserve(add_size + remove_size);
        for (uint32_t idx = 0; idx < add_size; ++idx)
            masks.push_back(stackm.GetSTLString(stackm.ArrayElementGet(HSVM_Arg(1), idx)));
        for (uint32_t idx = 0; idx < remove_size; ++idx)
            masks.push_back(stackm.GetSTLString(stackm.ArrayElementGet(HSVM_Arg(2), idx)));

        auto itr = context->eventstreams.find(id);
        if (itr == context->eventstreams.end())
        {
                HSVM_ThrowException(*vm, ("Could not find an event stream with id #" + Blex::AnyToString(id)).c_str());
                return;
        }

        auto middle = masks.begin() + add_size;
        itr->second->ModifySubscriptions(masks.begin(), middle, middle, masks.end(), reset);
}

void HS_Event_StreamRead(VarId id_set, VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        uint32_t id = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        auto itr = context->eventstreams.find(id);
        if (itr == context->eventstreams.end())
        {
                HSVM_ThrowException(*vm, ("Could not find an event stream with id #" + Blex::AnyToString(id)).c_str());
                return;
        }

        itr->second->TryRead(id_set);
}

Baselibs::EventCollector::EventCollector(HSVM *vm, Blex::NotificationEventManager &eventmgr)
: OutputObject(vm, "Event collector")
, collector(eventmgr)
{
}

Baselibs::EventCollector::~EventCollector()
{
}

bool Baselibs::EventCollector::AddToWaiterRead(Blex::PipeWaiter &waiter)
{
        if (collector.IsSignalled())
            return true;

        waiter.AddEvent(collector);
        return false;
}

void Baselibs::EventCollector::RemoveFromWaiterRead(Blex::PipeWaiter &waiter)
{
        waiter.RemoveEvent(collector);
}

OutputObject::SignalledStatus Baselibs::EventCollector::IsReadSignalled(Blex::PipeWaiter *)
{
        return collector.IsSignalled() ? Signalled : NotSignalled;
}

void Baselibs::EventCollector::GetItems(HSVM_VariableId id_set)
{
        auto myvm = GetVirtualMachine(vm);
        StackMachine &stackm = myvm->GetStackMachine();

        HSVM_SetDefault(vm, id_set, HSVM_VAR_StringArray);

        std::set< std::string > events = collector.GetEvents();
        for (auto &itr: events)
            stackm.SetSTLString(stackm.ArrayElementAppend(id_set), itr);
}

void HS_Event_CreateCollector(VarId id_set, VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        StackMachine &stackm = vm->GetStackMachine();
        Blex::NotificationEventManager &eventmgr = vm->environment.GetNotificationEventMgr();

        std::vector< std::string > masks;
        uint32_t add_size = stackm.ArraySize(HSVM_Arg(0));
        masks.reserve(add_size);
        for (uint32_t idx = 0; idx < add_size; ++idx)
            masks.push_back(stackm.GetSTLString(stackm.ArrayElementGet(HSVM_Arg(0), idx)));

        auto ptr = std::make_shared< Baselibs::EventCollector >(*vm, eventmgr);
        ptr->ModifySubscriptions(masks.begin(), masks.end(), masks.end(), masks.end(), true);
        context->eventcollectors[ptr->GetId()] = ptr;

        HSVM_IntegerSet(*vm, id_set, ptr->GetId());
}

void HS_Event_CloseCollector(VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        uint32_t id = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        auto itr = context->eventcollectors.find(id);
        if (itr != context->eventcollectors.end())
            context->eventcollectors.erase(itr);
}

void HS_Event_CollectorModifySubscriptions(VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        StackMachine &stackm = vm->GetStackMachine();
        uint32_t id = stackm.GetInteger(HSVM_Arg(0));

        std::vector< std::string > masks;
        uint32_t add_size = stackm.ArraySize(HSVM_Arg(1));
        uint32_t remove_size = stackm.ArraySize(HSVM_Arg(2));
        bool reset = stackm.GetBoolean(HSVM_Arg(3));

        masks.reserve(add_size + remove_size);
        for (uint32_t idx = 0; idx < add_size; ++idx)
            masks.push_back(stackm.GetSTLString(stackm.ArrayElementGet(HSVM_Arg(1), idx)));
        for (uint32_t idx = 0; idx < remove_size; ++idx)
            masks.push_back(stackm.GetSTLString(stackm.ArrayElementGet(HSVM_Arg(2), idx)));

        auto itr = context->eventcollectors.find(id);
        if (itr == context->eventcollectors.end())
        {
                HSVM_ThrowException(*vm, ("Could not find an event collector with id #" + Blex::AnyToString(id)).c_str());
                return;
        }

        auto middle = masks.begin() + add_size;
        itr->second->ModifySubscriptions(masks.begin(), middle, middle, masks.end(), reset);
}

void HS_Event_CollectorRead(VarId id_set, VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        uint32_t id = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        auto itr = context->eventcollectors.find(id);
        if (itr == context->eventcollectors.end())
        {
                HSVM_ThrowException(*vm, ("Could not find an event collector with id #" + Blex::AnyToString(id)).c_str());
                return;
        }

        itr->second->GetItems(id_set);
}

void HS_Event_Broadcast(VirtualMachine *vm)
{
        auto evt = std::make_shared< Blex::NotificationEvent >();
        evt->name = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
        vm->event_marshaller.WriteToPodVector(HSVM_Arg(1), &evt->payload);
        bool local = HSVM_BooleanGet(*vm, HSVM_Arg(2));

        Blex::NotificationEventManager &eventmgr = vm->environment.GetNotificationEventMgr();
        if (local)
            eventmgr.QueueEventNoExport(evt);
        else
            eventmgr.QueueEvent(evt);
}

void InitEvents(BuiltinFunctionsRegistrator &bifreg)
{
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_EVENT_CREATESTREAM::I:",HS_Event_CreateStream));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_EVENT_CLOSESTREAM:::I",HS_Event_CloseStream));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_EVENT_STREAMMODIFYSUBSCRIPTIONS:::ISASAB", HS_Event_StreamModifySubscriptions));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_EVENT_STREAMREAD::R:I",HS_Event_StreamRead));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_EVENT_CREATECOLLECTOR::I:SA",HS_Event_CreateCollector));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_EVENT_CLOSECOLLECTOR:::I",HS_Event_CloseCollector));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_EVENT_COLLECTORMODIFYSUBSCRIPTIONS:::ISASAB", HS_Event_CollectorModifySubscriptions));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_EVENT_COLLECTORREAD::SA:I",HS_Event_CollectorRead));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_EVENT_BROADCAST:::SRB",HS_Event_Broadcast));
}

} // End of namespace HareScript
