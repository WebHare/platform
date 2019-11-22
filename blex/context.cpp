#include <blex/blexlib.h>


#include "context.h"
#include "threads.h"

namespace Blex
{

ContextRegistrator::ContextRegistrator()
{
}

ContextRegistrator::~ContextRegistrator()
{
}

void ContextRegistrator::RegisterContext(unsigned id, CreateContextFunc create, DestroyContextFunc destroy, void const *extra_parameter)
{
        LockedData::WriteRef ref(lockeddata);
        if (ref->find(id) != ref->end())
            throw std::logic_error("RegisterContext: Duplicate context registration");

        ref->insert(std::make_pair(id, ExternalContextType(create, destroy, extra_parameter)));
}

void* ContextRegistrator::CreateContext(unsigned id) const
{
        CreateContextFunc createfunc;
        void *extra_parameter;
        {
                LockedData::ReadRef ref(lockeddata);

                ExternalContextTypes::const_iterator it = ref->find(id);
                if (it == ref->end() || (!it->second.createfunc))
                    return NULL;

                createfunc = it->second.createfunc;
                extra_parameter = it->second.extra_parameter;
        }
        // Get createfunc out of lock - creation might be a costly operation
        return createfunc(extra_parameter);
}

void ContextRegistrator::FreeContext(unsigned id, void *contextptr) const
{
        DestroyContextFunc destroyfunc;
        void *opaque_ptr;
        {
                LockedData::ReadRef ref(lockeddata);

                ExternalContextTypes::const_iterator it = ref->find(id);
                if (it == ref->end() || (!it->second.destroyfunc))
                    return;
                destroyfunc = it->second.destroyfunc;
                opaque_ptr = it->second.extra_parameter;
        }
        destroyfunc(opaque_ptr,contextptr);
}

//---------------------------------------------------------------------------
//
// External contexts, mediator
//
//---------------------------------------------------------------------------
ContextKeeper::ContextKeeper(ContextRegistrator const &_registrator)
: registrator(_registrator)
{
}

ContextKeeper::~ContextKeeper()
{
        Reset();
}

ContextKeeper::RegisteredContext * ContextKeeper::FindContext(unsigned id)
{
        //See if the context is already available, and if so, return it
        for (std::vector<RegisteredContext>::iterator itr=contexts.begin();
             itr!=contexts.end();
             ++itr)
        {
                if (itr->id==id)
                    return &*itr;
        }
        return NULL;
}

ContextKeeper::RegisteredContext const * ContextKeeper::FindContext(unsigned id) const
{
        //See if the context is already available, and if so, return it
        for (std::vector<RegisteredContext>::const_iterator itr=contexts.begin();
             itr!=contexts.end();
             ++itr)
        {
                if (itr->id==id)
                    return &*itr;
        }
        return NULL;
}


void * ContextKeeper::GetContext(unsigned id, bool autocreate)
{
        //See if the context is already available, and if so, return it
        RegisteredContext *context = FindContext(id);
        if (context)
            return context->ptr;
        if (!autocreate)
            return NULL;

        //The context is new, so construct it!
        contexts.reserve(contexts.size()+1); //make push_back exception safe
        void *newptr = registrator.CreateContext(id);
        if (newptr == 0)
            return NULL; //ADDME: Shouldn't we throw? noone expects a NULL, at least not from the Context() constructor

        //Add it to our list. This is exception safe because of the reserve,
        //so we don't need to bother about destroying 'newptr'
        RegisteredContext newcontext;
        newcontext.id = id;
        newcontext.ptr = newptr;
        contexts.push_back(newcontext);

        return newptr;
}

void const * ContextKeeper::GetConstContext(unsigned id) const
{
        //See if the context is already available, and if so, return it
        RegisteredContext const *context = FindContext(id);
        if (context)
            return context->ptr;

        return NULL;
}

void ContextKeeper::AddContext(unsigned id, void *ptr)
{
         if (FindContext(id))
             throw std::logic_error("Already existing context re-added");

        contexts.reserve(contexts.size()+1); //make push_back exception safe
        RegisteredContext newcontext;
        newcontext.id = id;
        newcontext.ptr = ptr;
        contexts.push_back(newcontext);
}

void ContextKeeper::RemoveContext(unsigned id)
{
        for (std::vector<RegisteredContext>::iterator itr = contexts.begin(); itr != contexts.end(); ++itr)
          if (itr->id==id)
          {
                RegisteredContext backup=*itr;
                contexts.erase(itr);
                registrator.FreeContext(backup.id, backup.ptr);
                return;
          }
        return;
}

void ContextKeeper::Reset()
{
        // Delete all contexts
        while(!contexts.empty())
        {
                RegisteredContext backup=contexts.back();
                contexts.erase(contexts.end()-1);
                registrator.FreeContext(backup.id, backup.ptr);
        }
}

void ContextKeeper::Swap(ContextKeeper &rhs)
{
        if (&registrator != &rhs.registrator)
             throw std::logic_error("Swapping contextkeepers with different registrators");

        std::swap(contexts, rhs.contexts);
}



} // End of namespace Blex

