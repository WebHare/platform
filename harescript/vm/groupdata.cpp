#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------
#include "groupdata.h"
#include "hsvm_context.h"


// Show all job manager/port/message stuff
//#define SHOW_GROUPREFS

#if defined(SHOW_GROUPREFS) && defined(WHBUILD_DEBUG)
 #define GR_PRINT(x) DEBUGPRINT(x)
 #define GR_ONLY(x) DEBUGONLY(x)
#else
 #define GR_PRINT(x)
 #define GR_ONLY(x)
#endif


namespace HareScript
{

class VMGroup;

// -----------------------------------------------------------------------------
//
// JobManager
//

JobManagerGroupData::JobManagerGroupData()
: creationdate(Blex::DateTime::Now())
, state(RunningState::Startup)
, oldstate(RunningState::Locked)
, oldstatedebug(RunningState::Startup)
, reqstate(RunningState::Startup)
, waitingvm(0)
, id_set(0)
, iscancellable(false)
, iscancelled(false)
, reporterrors(false)
, run_timeout_seconds(0)
, is_running_for_timeout(true)
, running_timeout(Blex::DateTime::Max())
, current_run_start(Blex::DateTime::Min())
, total_running(Blex::DateTime::Min())
, highpriority(false)
{
}


// ----------------------------------------------------------------------------_
//
// VMGroupRef
//

/// Mutex to serialize modifying vm group reference counts
Blex::Mutex grouprefmutex;

VMGroupRef::VMGroupRef(VMGroup *_group, bool addref)
: group(_group)
{
        if (group && addref)
        {
                Blex::Mutex::AutoLock lock(grouprefmutex);
                ++group->refcount;
                GR_PRINT("^ref add " << this << " " << group << ":" << group->refcount - 1 << " -> " << group->refcount);
        }
}

VMGroupRef::VMGroupRef(VMGroupRef const &rhs)
: group(rhs.group)
{
        if (group)
        {
                Blex::Mutex::AutoLock lock(grouprefmutex);
                ++group->refcount;
                GR_PRINT("^ref add " << this << " " << group << ":" << group->refcount - 1 << " -> " << group->refcount);
        }
}

VMGroupRef::~VMGroupRef()
{
        VMGroup *delete_group(0);
        {
                Blex::Mutex::AutoLock lock(grouprefmutex);
                assert(!group || group->refcount != 0);
                if (group && --group->refcount == 0)
                    delete_group = group;
                GR_ONLY(if (group) GR_PRINT("^ref del " << this << " " << group << ":" << group->refcount + 1 << " -> " << group->refcount));
        }
        if (delete_group) // Delete outside lock
            delete delete_group;
}

VMGroupRef & VMGroupRef::operator =(VMGroupRef const &rhs)
{
        if (group == rhs.group)
            return *this;
        VMGroup *delete_group(0);
        {
                Blex::Mutex::AutoLock lock(grouprefmutex);
                if (group && --group->refcount == 0)
                    delete_group = group;
                GR_ONLY(if (group) GR_PRINT("^ref del " << this << " " << group << ":" << group->refcount + 1 << " -> " << group->refcount));
                group = rhs.group;
                if (group)
                    ++group->refcount;
                GR_ONLY(if (group) GR_PRINT("^ref add " << this << " " << group << ":" << group->refcount - 1 << " -> " << group->refcount));
        }
        if (delete_group) // Delete outside lock
            delete delete_group;
        return *this;
}
void VMGroupRef::reset(VMGroup *_group, bool addref)
{
        if (group != _group || !addref)
            *this = VMGroupRef(_group, addref);
}

void VMGroupRef::RemoveReference(VMGroup *group)
{
        VMGroup *delete_group(0);
        {
                Blex::Mutex::AutoLock lock(grouprefmutex);
                if (--group->refcount == 0)
                    delete_group = group;
                GR_PRINT("^ref del " << this << " " << group << ":" << group->refcount);
        }
        if (delete_group)
            delete delete_group;
}

} // namespace HareScript
