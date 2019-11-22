#include <ap/libwebhare/allincludes.h>


#include "segmentinfo.h"
#include "consilio.h"
#include "cache.h"

namespace Lucene
{

SegmentInfo::SegmentInfo(const std::string & _name, uint32_t _doccount, Blex::ComplexFileSystem * _dir)
: name(_name)
, doccount(_doccount)
, dir(_dir)
{
        if (name.empty())
            throw LuceneException("SegmentInfo: name.empty()",true);
}

const SegmentInfo & SegmentInfos::Info(uint32_t i)
{
        return segments[i];
}

SegmentInfos::SegmentInfos()
: counter(0)
, version(0)
{
}

void SegmentInfos::Read(Blex::ComplexFileSystem &directory,Blex::Mutex::AutoLock const &)
{
        std::shared_ptr<Blex::ComplexFileStream> input(directory.OpenFile("segments",false,false));
        if (!input.get())
            throw LuceneException("Cannot open segments file",false);

        indexversion = input->ReadLsb<uint32_t>();
        if (indexversion != INDEX_VERSION)
            throw LuceneException("SegmentInfo: Wrong index version",true);
        counter = input->ReadLsb<uint32_t>();
        uint32_t numsegments = input->ReadLsb<uint32_t>();
        for (uint32_t i = 0; i < numsegments; ++i)
        {
                std::string name = input->ReadLsb<std::string>();
                segments.push_back(SegmentInfo(name, input->ReadLsb<uint32_t>(), &directory));
        }
        version = input->ReadLsb<uint32_t>();
}

void SegmentInfos::Write(Blex::ComplexFileSystem &directory, SegmentsCache &cache, Blex::Mutex::AutoLock const &)
{
        std::vector< std::string > segmentnames;

        directory.DeletePath("segments.new"); //Remove any half-written segments file
        std::unique_ptr<Blex::ComplexFileStream> output(directory.OpenFile("segments.new",true,true));
        output->WriteLsb<uint32_t>(INDEX_VERSION);
        output->WriteLsb<uint32_t>(counter);
        output->WriteLsb<uint32_t>(segments.size());
        for (std::vector<SegmentInfo>::iterator it = segments.begin(); it != segments.end(); ++it)
        {
                DEBUGSEGMENTSPRINT("SegmentInfos::Write writing segment " << it->name << " (" << it->doccount << " docs)");
                output->WriteLsb<std::string>(it->name);
                output->WriteLsb<uint32_t>(it->doccount);

                segmentnames.push_back(it->name);
        }
        output->WriteLsb<uint32_t>(++version);
        output.reset();
        // Make sure all data of segments.new is written to disk
        directory.Flush();
        /*if (!*/directory.MovePath("segments.new", "segments");/*)*/ // FIXME: may move fail?
//            throw LuceneException("Unexpected rename failure: segments.new->segments",true);
        directory.Flush();

        cache.SetValidSegments(segmentnames);
}

uint32_t SegmentInfos::GetVersion()
{
        return version;
}

uint32_t SegmentInfos::ReadVersion(Blex::ComplexFileSystem * directory)
{
        std::shared_ptr<Blex::ComplexFileStream> input(directory->OpenFile("segments",false,false));
        if (!input.get())
            throw LuceneException("Cannot open segments file",false);

        input->ReadLsb<uint32_t>();
        input->ReadLsb<uint32_t>();
        uint32_t numsegments = input->ReadLsb<uint32_t>();
        for (uint32_t i = 0; i < numsegments; ++i)
        {
                input->ReadLsb<std::string>();
                input->ReadLsb<uint32_t>();
        }
        return input->ReadLsb<uint32_t>();
}

uint32_t SegmentInfos::DocCount()
{
        uint32_t doccount = 0;
        for (std::vector<SegmentInfo>::iterator it = segments.begin(); it != segments.end(); ++it)
            doccount += it->doccount;
        return doccount;
}

} // namespace Lucene

