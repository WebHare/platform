#include <ap/libwebhare/allincludes.h>


#include <blex/path.h>
#include "indexreader.h"
#include "segmentreader.h"
#include "segmentsreader.h"
#include "similarity.h"

namespace Lucene
{

IndexReader * IndexReader::Open(Blex::Mutex &commit_lock, Blex::ComplexFileSystem & directory, SegmentsCache &cache)
{
        std::unique_ptr<IndexReader> result;
        {
                Blex::Mutex::AutoLock lock(commit_lock);
                DEBUGSEGMENTSPRINT("IndexReader::Open got commit lock");
                std::shared_ptr<SegmentInfos> infos(new SegmentInfos());
                infos->Read(directory, lock);
                if (infos->segments.size() == 1)
                {
                        DEBUGSEGMENTSPRINT("IndexReader::Open opening segment " << infos->Info(0).name);
                        result.reset(new SegmentReader(commit_lock, infos, infos->Info(0), cache));
                }
                else
                {
                        SegmentList readers;
                        for (uint32_t i = 0; i < infos->segments.size(); ++i)
                        {
                                DEBUGSEGMENTSPRINT("IndexReader::Open opening segment " << infos->Info(i).name << " (" << i << " of " << infos->segments.size() << ")");
                                readers.push_back(new SegmentReader(commit_lock, infos, infos->Info(i), cache));
                        }
                        result.reset(new SegmentsReader(infos, &directory, readers));
                }
                DEBUGSEGMENTSPRINT("IndexReader::Open releasing commit lock");
        }
        return result.release();
}

IndexReader::~IndexReader()
{
}

IndexReader::IndexReader(Blex::ComplexFileSystem &_directory)
: directory(_directory)
{
        stale = false;
}

void IndexReader::SetNorm(uint32_t doc, const std::string & field, float value)
{
        SetNorm(doc, field, Similarity::EncodeNorm(value));
}

TermDocs * IndexReader::GetTermDocs(const Term & term)
{
        TermDocs * termdocs = GetTermDocs();
        termdocs->Seek(term);
        return termdocs;
}

std::shared_ptr<TermDocs> IndexReader::GetTermPositionsPtr(const Term & term)
{
        return std::shared_ptr<TermDocs>(GetTermPositions(term));
}

TermDocs * IndexReader::GetTermPositions(const Term & term)
{
        TermDocs * termpositions = GetTermPositions();
        termpositions->Seek(term);
        return termpositions;
}

void IndexReader::Delete(uint32_t docnum)
{
        if (stale)
            return;

        if ((segmentinfos != NULL) && (SegmentInfos::ReadVersion(&directory) > segmentinfos->GetVersion()))
        {
                stale = true;
                return;
        }
        DoDelete(docnum);
}

uint32_t IndexReader::Delete(const Term & term)
{
        const std::unique_ptr<TermDocs> docs(GetTermDocs(term));
        if (!docs.get())
            return 0;

        uint32_t n = 0;
        while (docs->Next())
        {
                Delete(docs->Doc());
                n++;
        }
        return n;
}

TermEnum::~TermEnum()
{
}

TermDocs::TermDocs(bool _positions)
{
        positions = _positions;
}

TermDocs::~TermDocs()
{
}

} // namespace Lucene

