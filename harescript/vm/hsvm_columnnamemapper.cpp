#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

//#define SHOWMAPPINGS

#ifdef SHOWMAPPINGS
 #define MAPPINGPRINT(x) DEBUGPRINT(x)
#else
 #define MAPPINGPRINT(x) (void)0
#endif


/* ADDME: The column name mapper introduces a few potential bottlenecks:
   - When linking libraries, the global map is locked/unlocked for every
     column name that is linked. Getting one lock, doing all links, and then
     releasing the lock would be a bit faster on SMPs.
   - Running libraries still want to see/touch global mappings. Every access to
     the global map costs us a lock - if these access are too frequent (profile)
     this may be a bottleneck
   - Copying maps isn't exactly the fastest possible operation :)
*/

#include "hsvm_columnnamemapper.h"

namespace HareScript
{
namespace ColumnNames
{

GlobalMapper::GlobalMapper()
{
        //ADDME? DEBUGONLY(data.SetupDebugging("Global columnname mapper"));
}

void GlobalMapper::GetDataCopy(MappingData *mapping) const
{
        *mapping = LockedData::ReadRef(data)->mappings;
}

ColumnNameId GlobalMapper::GetMapping(Blex::StringPair const &name, Blex::StringPair *stored)
{
        // Get the uppercase version of the string
        unsigned namelen = std::min< unsigned >(name.size(), HSVM_MaxColumnName - 1);
        char tempname[HSVM_MaxColumnName - 1];
        memcpy(tempname, name.begin, namelen);
        Blex::ToUppercase(tempname, tempname + namelen);
        Blex::StringPair upcasename(tempname, tempname + namelen);

        LockedData::WriteRef ref(data);

        Mappings::iterator it = ref->mappings.map.Find(upcasename);
        ColumnNameId id;
        if (it != ref->mappings.map.End())
        {
                id = it->second;
                if (stored)
                    *stored = it->first;
                upcasename = it->first;
        }
        else
        {
                ref->strings.push_back(upcasename.stl_str());
                upcasename = Blex::StringPair(ref->strings.back().begin(), ref->strings.back().end());

                id = ref->currentcounter++;
                ref->mappings.map.Insert(std::make_pair(upcasename,id));
                ref->mappings.rmap.Insert(std::make_pair(id,upcasename));
                MAPPINGPRINT("Created column-name mapping " << id << " <-> '" << name << "'");
                if (stored)
                    *stored = upcasename;
        }
        return id;
}

Blex::StringPair GlobalMapper::GetReverseMapping(ColumnNameId id)
{
        LockedData::WriteRef ref(data);
        ReverseMappings::iterator it = ref->mappings.rmap.Find(id);
        if (it != ref->mappings.rmap.End())
            return it->second;
        else
            return Blex::StringPair::ConstructEmpty();
}

void GlobalMapper::AllocateMappingCopy(std::shared_ptr< MappingData > *ptr)
{
        {
                LockedData::WriteRef ref(data);
                ++ref->copies_in_use;
                if (!ref->local_cache.empty())
                {
                        Data::LocalCache::iterator it = ref->local_cache.end();
                        --it;

                        MAPPINGPRINT("GM " << this << ": Allocated cached mapping copy, in use: " << ref->copies_in_use
                            << "( " << it->first << "/" << ref->mappings.map.Size() << ")");

                        *ptr = it->second;
                        ref->local_cache.erase(it);
                        return;
                }
                MAPPINGPRINT("GM " << this << ": Allocated new mapping copy, in use: " << ref->copies_in_use << " (" << ref->mappings.map.Size() << ")");
        }
        ptr->reset(new MappingData);
        GetDataCopy(ptr->get());
}

void GlobalMapper::ReleaseMappingCopy(std::shared_ptr< MappingData > *ptr)
{
        LockedData::WriteRef ref(data);
        --ref->copies_in_use;
        ref->local_cache.insert(std::make_pair((*ptr)->map.Size(), *ptr));
        if (ref->local_cache.size() > 16)
        {
                MAPPINGPRINT("GM " << this << ": Released mapping copy ("<<(*ptr)->map.Size()<<"), discarded smallest ("<<ref->local_cache.begin()->first<<"), in use: " << ref->copies_in_use);
                ref->local_cache.erase(ref->local_cache.begin());
        }
        else
        {
                MAPPINGPRINT("GM " << this << ": Released mapping copy ("<<(*ptr)->map.Size()<<"), in use: " << ref->copies_in_use);
        }
        ptr->reset();
}

LocalMapper::LocalMapper(GlobalMapper& globalmapper)
: globalmapper(globalmapper)
{
          globalmapper.AllocateMappingCopy(&localmapping);
}


LocalMapper::~LocalMapper()
{
          globalmapper.ReleaseMappingCopy(&localmapping);
}

ColumnNameId LocalMapper::GetMapping(char const *name)
{
        return GetMapping(strlen(name),name);
}

ColumnNameId LocalMapper::GetMapping(unsigned namelen, char const *namebegin)
{
        namelen=std::min<unsigned>(namelen, HSVM_MaxColumnName - 1);
        if (!Blex::IsUppercase(namebegin, namebegin+namelen))
        {
                //Reinvoke ourselves as the 'slow' version
                char tempname[HSVM_MaxColumnName - 1];
                memcpy(tempname, namebegin, namelen);
                Blex::ToUppercase(tempname, tempname + namelen);
                return GetMapping(namelen, tempname);
        }
        Blex::StringPair name(namebegin, namebegin + namelen);

        Mappings::iterator it = localmapping->map.Find(name);
        ColumnNameId id;
        if (it != localmapping->map.End())
        {
                id = it->second;
        }
        else
        {
                Blex::StringPair storeddata;
                id = globalmapper.GetMapping(name, &storeddata);
                localmapping->map.Insert(std::make_pair(storeddata,id));
                localmapping->rmap.Insert(std::make_pair(id,storeddata));
        }
        return id;
}

Blex::StringPair LocalMapper::GetReverseMapping(ColumnNameId id)
{
        ReverseMappings::iterator it = localmapping->rmap.Find(id);
        if (it != localmapping->rmap.End())
        {
                return it->second;
        }
        else
        {
                Blex::StringPair upcasename = globalmapper.GetReverseMapping(id);
                localmapping->map.Insert(std::make_pair(upcasename,id));
                localmapping->rmap.Insert(std::make_pair(id,upcasename));
                return upcasename;
        }
}

} // End of namespace ColumnNames
} // End of namespace HareScript

