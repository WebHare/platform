//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include "outputobject.h"
#include "hsvm_context.h"

namespace HareScript
{

const unsigned OutputObject::MaxReadChunkSize;

OutputObject::OutputObject(HSVM *_vm, const char *_type)
: type(_type)
, vm(0)
, wait_ignores_readbuffer(false)
, creationdate(Blex::DateTime::Invalid())
{
        id = Register(_vm);
}

int OutputObject::Register(HSVM *_vm)
{
        if (vm)
            Unregister();

        vm = _vm;
        id = 0;
        if (vm)
        {
                VirtualMachine *ownervm = GetVirtualMachine(vm);
                id = ownervm->outobjects.Set(this);
                stacktrace = ownervm->GetStackTraceForOutputObject();
                if (stacktrace.get())
                    creationdate = Blex::DateTime::Now();
        }

        return id;
}

void OutputObject::Unregister()
{
        if (vm)
        {
                GetVirtualMachine(vm)->outobjects.Erase(id);
                stacktrace.reset();
        }

        vm = 0;
        id = 0;
}

OutputObject::~OutputObject()
{
        Unregister();
}

void OutputObject::SetWaitIgnoresReadBuffer(bool newwait)
{
        wait_ignores_readbuffer = newwait;
}
std::pair< Blex::SocketError::Errors, unsigned > OutputObject::Read(unsigned , void *)
{
        return std::make_pair(Blex::SocketError::NoError, 0);
}
std::pair< Blex::SocketError::Errors, unsigned > OutputObject::Write(unsigned , const void *, bool /*allow_partial*/)
{
        return std::make_pair(Blex::SocketError::NoError, 0);
}

bool OutputObject::IsAtEOF()
{
        return true;
}

bool OutputObject::ShouldYieldAfterWrite()
{
        return false;
}

} // namespace HareScript
