#include <ap/libwebhare/allincludes.h>


#include "terminfos.h"
#include "segmentreader.h"
#include "cache.h"

namespace Lucene
{

/*
TermInfo::TermInfo()
: docfreq(0)
, freqpointer(0)
, proxpointer(0)
{
}

TermInfo::TermInfo(uint32_t df, uint32_t fp, uint32_t pp)
{
        docfreq = df;
        freqpointer = fp;
        proxpointer = pp;
}

void TermInfo::Set(uint32_t df, uint32_t fp, uint32_t pp)
{
        docfreq = df;
        freqpointer = fp;
        proxpointer = pp;
}

void TermInfo::Set(const TermInfo & ti)
{
        docfreq = ti.docfreq;
        freqpointer = ti.freqpointer;
        proxpointer = ti.proxpointer;
}
*/

TermInfosReader::TermInfosReader(Blex::ComplexFileSystem &dir, const std::string & seg, SegmentCacheRef &_cacheref)
: cacheref(_cacheref)
, directory(dir)
{
        segment = seg;

//        indexterms.clear();
//        indexinfos.clear();
//        indexpointers.clear();

        enumerator.reset(new SegmentTermEnum(dir, seg+".tis", *cacheref->fieldinfos, false));
        size = enumerator->size;

//        ReadIndex();
}

uint32_t TermInfosReader::Size() const
{
        return size;
}

uint32_t TermInfosReader::GetIndexOffset(const Term & term) const
{
        SegmentCache const &cache = *cacheref;

        int32_t lo = 0;
        int32_t hi = cache.indexterms.size() - 1;

        while (hi >= lo)
        {
                int32_t mid = (hi + lo) >> 1;
                int32_t delta = term.CompareTo(cache.indexterms[mid]);
                if (delta < 0)
                    hi = mid - 1;
                else if (delta > 0)
                    lo = mid + 1;
                else
                    return mid;
        }

        return hi;
}

void TermInfosReader::SeekEnum(uint32_t indexoffset)
{
        enumerator->Seek(cacheref->indexpointers[indexoffset],
            (indexoffset * INDEX_INTERVAL) -1,
            cacheref->indexterms[indexoffset], cacheref->indexinfos[indexoffset]);
}

const TermInfo * TermInfosReader::Get(const Term & term)
{
        if (size == 0 || cacheref->indexterms.empty()) //ADDME: (arnold) Kris, heb dit toe moeten voegen omdat GetIndexOffset() het geval waarin indexterms leeg is incorrect afvangt. Ook in originele Java code, dus geen idee waar uberhaupt dit probleem vandaan komt
            return NULL;

        // optimize sequential access: first try scanning cached enumerator w/o seeking
        if (enumerator->GetTerm().Valid() && term.CompareTo(enumerator->GetTerm()) >= 0)
        {
                uint32_t enumoffset = (enumerator->position / INDEX_INTERVAL) + 1;
                if (enumoffset == cacheref->indexterms.size()
                    || term.CompareTo(cacheref->indexterms[enumoffset]) < 0)
                {
                        return ScanEnum(term);
                }
        }

        // random-access: must seek
        SeekEnum(GetIndexOffset(term));
        return ScanEnum(term);
}

Term TermInfosReader::GetTerm(int32_t position)
{
        if (size == 0)
            return Term();

        if ((enumerator.get() != NULL) && (enumerator->GetTerm().Valid()) &&
            (position >= enumerator->position) && (position < (enumerator->position + INDEX_INTERVAL)))
            return ScanEnum(position); // can avoid seek

        SeekEnum(position / INDEX_INTERVAL); // must seek
        return ScanEnum(position);
}

int32_t TermInfosReader::GetPosition(const Term & term)
{
        if (size == 0)
            return -1;

        uint32_t indexoffset = GetIndexOffset(term);
        SeekEnum(indexoffset);

        while ((term.CompareTo(enumerator->GetTerm()) > 0) && enumerator->Next())
        {}

        if (term.CompareTo(enumerator->GetTerm()) == 0)
            return enumerator->position;
        else
            return -1;
}

SegmentTermEnum * TermInfosReader::Terms()
{
        if (enumerator->position != -1)
            SeekEnum(0);
        return enumerator->Clone();
}

SegmentTermEnum * TermInfosReader::Terms(const Term & term)
{
        Get(term);
        return enumerator->Clone();
}
/*
void TermInfosReader::ReadIndex()
{
        SegmentTermEnum indexenum(directory, segment+".tii", *cacheref->fieldinfos, true);

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

        cacheref->indexterms = indexterms;
        cacheref->indexinfos = indexinfos;
        cacheref->indexpointers = indexpointers;
}
//*/

const TermInfo * TermInfosReader::ScanEnum(const Term & term)
{
        enumerator->LowerBound(term);
//        while (term.CompareTo(enumerator->GetTerm()) > 0 && enumerator->Next());
        if ((enumerator->GetTerm().Valid()) && (term.CompareTo(enumerator->GetTerm()) == 0))
            return enumerator->GetTermInfo();
        else
            return NULL;
}

Term TermInfosReader::ScanEnum(int32_t position)
{
        while(enumerator->position < position)
            if (!enumerator->Next())
                return Term();

        return enumerator->GetTerm();
}

TermInfosWriter::TermInfosWriter(Blex::ComplexFileSystem &directory, const std::string & segment, const FieldInfos & fis)
: fieldinfos(fis)
{
        Initialize(directory, segment, false);
        other_owner.reset(new TermInfosWriter(directory, segment, fis, true));

        other=other_owner.get(); //yes, it's a bit of a hack.. see header file for comments
        other->other = this;
}

TermInfosWriter::~TermInfosWriter()
{
        if (output.get())
        {
                output->SetOffset(0);
                output->WriteLsb<uint32_t>(size);
        }
}

bool TermInfosWriter::Add(const Term & term, const TermInfo & ti)
{
        if (!isindex && (term.CompareTo(lastterm) <= 0))
            return false;
        if (ti.freqpointer < lastti.freqpointer)
            return false;
        if (ti.proxpointer < lastti.proxpointer)
            return false;

        if (!isindex && (size % INDEX_INTERVAL == 0))
            other->Add(lastterm, lastti);

        WriteTerm(term);
        output->WriteLsb<uint32_t>(ti.docfreq);
        output->WriteLsb<uint32_t>(ti.freqpointer - lastti.freqpointer);
        output->WriteLsb<uint32_t>(ti.proxpointer - lastti.proxpointer);

        if (isindex)
        {
                output->WriteLsb<uint32_t>(other->output->GetOffset() - lastindexpointer);
                lastindexpointer = other->output->GetOffset();
        }

        lastti.Set(ti);
        size++;

        return true;
}

TermInfosWriter::TermInfosWriter(Blex::ComplexFileSystem &directory, const std::string & segment, const FieldInfos & fis, bool isindex)
: fieldinfos(fis)
{
        Initialize(directory, segment, isindex);
}

void TermInfosWriter::Initialize(Blex::ComplexFileSystem &directory, const std::string & segment, bool isi)
{
        lastterm = Term("", "");
        lastti = TermInfo();
        size = 0;
        lastindexpointer = 0;
        isindex = isi;

        output.reset(directory.OpenFile(segment + (isindex ? ".tii" : ".tis"),true,true));
        output->WriteLsb<uint32_t>(0); // Dummy term count, filled in later
}

void TermInfosWriter::WriteTerm(const Term & term)
{
        uint32_t start = StringDifference(lastterm.Text(), term.Text());
        uint32_t length = term.Text().size() - start;
        output->WriteLsb<uint32_t>(start);
        output->WriteLsb<uint32_t>(length);
        for (uint32_t i = 0; i < length; ++i)
            output->WriteLsb<uint8_t>(term.Text()[start+i]);
        output->WriteLsb<uint32_t>(fieldinfos.FieldNumber(term.Field()));
        lastterm = term;
}

uint32_t TermInfosWriter::StringDifference(const std::string & s1, const std::string & s2)
{
        uint32_t len1 = s1.size();
        uint32_t len2 = s2.size();
        uint32_t len = (len1 <= len2) ? len1 : len2;
        for (uint32_t i = 0; i < len; ++i)
            if (s1[i] != s2[i])
                return i;
        return len;
}

} // namespace Lucene

