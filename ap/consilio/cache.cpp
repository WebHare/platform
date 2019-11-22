#include <ap/libwebhare/allincludes.h>


#include "cache.h"
#include "segmentreader.h"
#include "fieldsreader.h"

#define SHOW_CACHE_ACTIVITY



#ifdef SHOW_CACHE_ACTIVITY
 #define CA_PRINT(x) DEBUGPRINT(x)
#else
 #define CA_PRINT(x) 0
#endif

// -----------------------------------------------------------------------------
//
// SegmentCache
//

SegmentCache::SegmentCache(SegmentsCache *cache, std::string const &segname, Blex::ComplexFileSystem &directory)
: cache(cache)
, refcount(0)
, segment(segname)
{
        // This initialization is thread-safe
        InitializeFieldInfos(directory);
        InitializeIndex(directory);
        InitializeNorms(directory);
}

void SegmentCache::InitializeFieldInfos(Blex::ComplexFileSystem &directory)
{
        CA_PRINT("Creating fieldinfo for segment " << segment << ", cache: " << this);
        fieldinfos.reset(new Lucene::FieldInfos(directory, segment + ".fnm"));
}

void SegmentCache::InitializeIndex(Blex::ComplexFileSystem &directory)
{
        CA_PRINT("Creating index for segment " << segment << ", cache: " << this);

        Lucene::SegmentTermEnum indexenum(directory, segment+".tii", *fieldinfos, true);

        uint32_t indexsize = indexenum.size;
        indexterms.resize(indexsize);
        indexinfos.resize(indexsize);
        indexpointers.resize(indexsize);

        for (uint32_t i = 0; indexenum.Next(); ++i)
        {
                indexterms[i] = indexenum.GetTerm();
                indexinfos[i] = *indexenum.GetTermInfo();
                indexpointers[i] = indexenum.indexpointer;
        }
}

void SegmentCache::InitializeNorms(Blex::ComplexFileSystem &directory)
{
        {
                Lucene::FieldsReader fieldreader(&directory, segment, *fieldinfos);
                maxdoc = fieldreader.Size();
        }

        CA_PRINT("Creating norms for segment " << segment << ", cache: " << this);

        std::string filename = segment + ".nrm";
        normsstream.reset(directory.OpenFile(filename, false, false));

        if (!normsstream.get())
            throw LuceneException("Cannot open norms file: " + filename,false);

        for (uint32_t i = 0; i < fieldinfos->Size(); i++)
        {
                Lucene::FieldInfo const *fi = fieldinfos->GetFieldInfo(i);
                norms[fi->name] = Lucene::NormPtr(new Lucene::Norm);
        }
}

Blex::PodVector< uint8_t > const & SegmentCache::GetNorms(const std::string & field)
{
        Blex::Mutex::AutoLock lock(initmutex);

        Lucene::NormsMap::iterator norm = norms.find(field);
        if (field.empty() || norm == norms.end())
            return emptyvector;

        if (norm->second->bytes.empty())
        {
                Blex::PodVector< uint8_t > bytes(maxdoc);
                std::fill(bytes.begin(), bytes.end(), 0);
                std::string filename = segment + ".nrm";

                if (!normsstream.get())
                    throw LuceneException("Getting norms from cache before initializing norms for segment " + segment, true);

                // Skip to field position within norms file
                Lucene::FieldInfo const *fi = fieldinfos->GetFieldInfo(field);
                normsstream->DirectRead(fi->number * maxdoc, &bytes[0], maxdoc);

                norm->second->bytes.assign(bytes.begin(), bytes.end());
        }
        return norm->second->bytes;


}


// -----------------------------------------------------------------------------
//
// SegmentsCache
//

SegmentsCache::SegmentsCache()
{
        DEBUGPRINT("Create segmentscache " << this);
//        lockeddata.SetupDebugging("SegmentsCache " + Blex::AnyToString(this));
//        refmutex.SetupDebugging("SegmentCacheRef mutex " + Blex::AnyToString(this));
}

SegmentsCache::~SegmentsCache()
{
        DEBUGPRINT("Destroy segmentscache " << this);

        LockedData::WriteRef lock(lockeddata);
        lock->cache.clear();
}

SegmentCacheRef SegmentsCache::GetSegment(std::string const &segmentname, Blex::ComplexFileSystem &directory)
{
        LockedData::WriteRef lock(lockeddata);

        SegmentCacheRef &ref = lock->cache[segmentname];
        if (ref.Valid())
        {
                CA_PRINT("Satisfying segment request for " << segmentname << " with cache " << ref.get());
                return ref;
        }

        SegmentCache *segcache = new SegmentCache(this, segmentname, directory);
        ref.Set(segcache);

        CA_PRINT("Created new cache for segment " << segmentname << ", cache is " << ref.get());
        return ref;
}

void SegmentsCache::EvictSegment(std::string const &segmentname)
{
        LockedData::WriteRef lock(lockeddata);
        lock->cache.erase(segmentname);
}

void SegmentsCache::Clear()
{
        LockedData::WriteRef lock(lockeddata);
        lock->cache.clear();
}

void SegmentsCache::SetValidSegments(std::vector< std::string > const &segments)
{
        LockedData::WriteRef lock(lockeddata);

        for (std::map< std::string, SegmentCacheRef >::iterator it = lock->cache.begin(); it != lock->cache.end();)
        {
                if (std::find(segments.begin(), segments.end(), it->first) == segments.end())
                    lock->cache.erase(it++);
                else
                    ++it;
        }
}

// -----------------------------------------------------------------------------
//
// SegmentCacheRef
//

SegmentCacheRef::SegmentCacheRef()
: segment(0)
{
}

SegmentCacheRef::SegmentCacheRef(SegmentCache *rhs_segment)
{
        Set(rhs_segment);
}

void SegmentCacheRef::Set(SegmentCache *rhs_segment)
{
        segment = rhs_segment;

        SegmentsCache::MutexType::AutoLock lock(rhs_segment->cache->refmutex);
        ++rhs_segment->refcount;
}

SegmentCacheRef::~SegmentCacheRef()
{
        if (!segment)
            return;

        SegmentCache *delsegment = 0;
        {
                SegmentsCache::MutexType::AutoLock lock(segment->cache->refmutex);
                if (--segment->refcount == 0)
                    delsegment = segment;
        }
        if (delsegment)
            delete delsegment;

}

SegmentCacheRef::SegmentCacheRef(SegmentCacheRef const &rhs)
: segment(rhs.segment)
{
        if (segment)
        {
                SegmentsCache::MutexType::AutoLock lock(segment->cache->refmutex);
                ++segment->refcount;
        }
}

SegmentCacheRef & SegmentCacheRef::operator =(SegmentCacheRef const &rhs)
{
        SegmentCacheRef(rhs).Swap(*this);
        return *this;
}

void SegmentCacheRef::Swap(SegmentCacheRef &rhs)
{
        std::swap(segment, rhs.segment);
}




