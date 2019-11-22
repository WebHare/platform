#include <ap/libwebhare/allincludes.h>



#include "segmentsreader.h"

namespace Lucene
{

SegmentsReader::SegmentsReader(std::shared_ptr<SegmentInfos> sis, Blex::ComplexFileSystem * directory, SegmentList r)
: IndexReader(*directory)
{
        maxdoc = 0;
        numdocs = -1;
        hasdeletions = false;
        segmentinfos = sis;
        readers = r;
        starts.resize(readers.size()+1);
        for (uint32_t i = 0; i < readers.size(); ++i)
        {
                starts[i] = maxdoc;
                maxdoc += readers[i]->MaxDoc();
                if (readers[i]->HasDeletions())
                    hasdeletions = true;
        }
        starts[readers.size()] = maxdoc;
}

SegmentsReader::~SegmentsReader()
{
        for (SegmentList::iterator it = readers.begin(); it != readers.end(); ++it)
            delete *it;
}

uint32_t SegmentsReader::NumDocs()
{
        if (numdocs == -1)
        {
                numdocs = 0;
                for (uint32_t i = 0; i < readers.size(); ++i)
                    numdocs += readers[i]->NumDocs();
        }
        return numdocs;
}

uint32_t SegmentsReader::MaxDoc()
{
        return maxdoc;
}

Document * SegmentsReader::GetDocument(uint32_t n)
{
        uint32_t i = ReaderIndex(n);
        return readers[i]->GetDocument(n - starts[i]);
}

bool SegmentsReader::IsDeleted(uint32_t n)
{
        uint32_t i = ReaderIndex(n);
        return readers[i]->IsDeleted(n - starts[i]);
}

bool SegmentsReader::HasDeletions()
{
        return hasdeletions;
}

void SegmentsReader::DoDelete(uint32_t n)
{
        numdocs = -1;
        uint32_t i = ReaderIndex(n);
        readers[i]->DoDelete(n - starts[i]);
        hasdeletions = true;
}

uint32_t SegmentsReader::ReaderIndex(uint32_t n)
{
        uint32_t lo = 0;
        uint32_t hi = readers.size() - 1;

        uint32_t mid;
        uint32_t midvalue;
        while (hi >= lo)
        {
                mid = (lo + hi) >> 1;
                midvalue = starts[mid];
                if (n < midvalue)
                    hi = mid -1;
                else if (n > midvalue)
                    lo = mid + 1;
                else
                {
                        while ((mid+1 < readers.size()) && (starts[mid+1] == midvalue))
                            mid++; // scan to last match
                        return mid;
                }
        }
        return hi;
}

Blex::PodVector< uint8_t > const & SegmentsReader::Norms(const std::string & field)
{
        NormsMap::iterator cachedbytes = normscache.find(field);
        if (cachedbytes != normscache.end())
            return cachedbytes->second;

        normscache[field].resize(maxdoc);

        Blex::PodVector< uint8_t > &bytes(normscache[field]);

        for (uint32_t i = 0; i < readers.size(); ++i)
            readers[i]->Norms(field, &bytes, starts[i]);

        return bytes;
}

void SegmentsReader::SetNorm(uint32_t n, const std::string & field, uint8_t value)
{
        normscache.erase(field);
        uint32_t i = ReaderIndex(n);
        readers[i]->SetNorm(n - starts[i], field, value);
}

TermEnum * SegmentsReader::Terms()
{
        return new SegmentsTermEnum(readers, starts, Term());
}

TermEnum * SegmentsReader::Terms(const Term & term)
{
        return new SegmentsTermEnum(readers, starts, term);
}

TermDocs * SegmentsReader::GetTermDocs()
{
        return new SegmentsTermDocs(readers, starts, false);
}

std::shared_ptr<TermDocs> SegmentsReader::GetTermPositionsPtr()
{
        return std::shared_ptr<TermDocs>(GetTermPositions());
}

TermDocs * SegmentsReader::GetTermPositions()
{
        return new SegmentsTermDocs(readers, starts, true);
}

int32_t SegmentsReader::DocFreq(const Term & t)
{
        uint32_t total = 0;
        for (uint32_t i = 0; i < readers.size(); ++i)
            total += readers[i]->DocFreq(t);
        return total;
}

std::set<std::string> SegmentsReader::GetFieldNames()
{
        std::set<std::string> fieldset;
        for (uint32_t i = 0; i < readers.size(); ++i)
        {
                std::set<std::string> names = readers[i]->GetFieldNames();
                fieldset.insert(names.begin(), names.end());
        }
        return fieldset;
}

std::set<std::string> SegmentsReader::GetFieldNames(bool indexed)
{
        std::set<std::string> fieldset;
        fieldset.clear();
        for (uint32_t i = 0; i < readers.size(); ++i)
        {
                std::set<std::string> names = readers[i]->GetFieldNames(indexed);
                fieldset.insert(names.begin(), names.end());
        }
        return fieldset;
}

SegmentsTermEnum::SegmentsTermEnum(const SegmentList & readers, const std::vector<uint32_t> & starts, const Term & t)
{
        queue.clear();
        for (uint32_t i = 0; i < readers.size(); ++i)
        {
                SegmentTermEnum * termenum;
                if (t.Valid())
                    termenum = (SegmentTermEnum *)readers[i]->Terms(t);
                else
                    termenum = (SegmentTermEnum *)readers[i]->Terms();

                std::shared_ptr<SegmentMergeInfo> smi(new SegmentMergeInfo(starts[i], termenum, readers[i]));
                if (!t.Valid() ? smi->Next() : (termenum->GetTerm().Valid()))
                    queue.insert(smi);
        }

        if (t.Valid() && !queue.empty())
            Next();
}

SegmentsTermEnum::~SegmentsTermEnum()
{
}

bool SegmentsTermEnum::Next()
{
        if (queue.size() == 0)
        {
                term = Term();
                return false;
        }
        std::shared_ptr<SegmentMergeInfo> top = *queue.begin();

        term = top->term;
        docfreq = 0;

        while ((top.get()) && (term.CompareTo(top->term) == 0))
        {
                queue.erase(queue.begin());
                docfreq += top->termenum->DocFreq();
                if (top->Next())
                    queue.insert(top);
                if (queue.size() > 0)
                    top = *queue.begin();
                else
                    top.reset();
        }
        return true;
}

Term SegmentsTermEnum::GetTerm()
{
        return term;
}

int32_t SegmentsTermEnum::DocFreq()
{
        return docfreq;
}

SegmentsTermDocs::SegmentsTermDocs(const SegmentList & r, const std::vector<uint32_t> & s, bool _positions)
: Lucene::TermDocs(_positions)
, readers(r)
, starts(s)
{
        segtermdocs.resize(r.size(),NULL);
        Seek(Term());
}

SegmentsTermDocs::~SegmentsTermDocs()
{
        for (std::vector<SegmentTermDocs *>::iterator it = segtermdocs.begin(); it != segtermdocs.end(); ++it)
            delete *it;
}

uint32_t SegmentsTermDocs::Doc()
{
        return base + current->Doc();
}

uint32_t SegmentsTermDocs::Freq()
{
        return current->freq;
}

void SegmentsTermDocs::Seek(const Term & _term)
{
        term = _term;
        base = 0;
        pointer = 0;
        current = NULL;
}

void SegmentsTermDocs::Seek(TermEnum * termenum)
{
        Seek(termenum->GetTerm());
}

bool SegmentsTermDocs::Next()
{
        if ((current != NULL) && current->Next())
            return true;
        else if (pointer < readers.size())
        {
                base = starts[pointer];
                current = TermDocs(pointer++);
                return Next();
        }
        else
            return false;
}

uint32_t SegmentsTermDocs::NextPosition()
{
        if (!positions)
            throw LuceneException("No positions information", false);

        if (!current)
            throw LuceneException("NextPosition called without current SegmentsTermPositions", false);
        return current->NextPosition();
}

uint32_t SegmentsTermDocs::Read(std::vector<uint32_t> * docs, std::vector<uint32_t> * freqs)
{
        while (true)
        {
                while (current == NULL) {
                    if (pointer < readers.size())
                    {
                            base = starts[pointer];
                            current = TermDocs(pointer++);
                    }
                    else
                        return 0;
                }
                uint32_t end = current->Read(docs, freqs);
                if (end == 0)
                    current = NULL;
                else
                {
                    uint32_t b = base;
                    for (uint32_t i = 0; i < end; i++)
                        (*docs)[i] += b;
                    return end;
                }
        }
}

bool SegmentsTermDocs::SkipTo(uint32_t target)
{
        do
        {
                if (!Next())
                    return false;
        }
        while (target > Doc());
        return true;
}

SegmentTermDocs * SegmentsTermDocs::TermDocs(SegmentReader * reader)
{
        if (positions)
            return (SegmentTermDocs *)reader->GetTermPositions();
        else
            return (SegmentTermDocs *)reader->GetTermDocs();
}

SegmentTermDocs * SegmentsTermDocs::TermDocs(uint32_t i)
{
        if (!term.Valid())
          return NULL;
        SegmentTermDocs * result = segtermdocs[i];
        if (result == NULL)
        {
                segtermdocs[i] = TermDocs(readers[i]);
                result = segtermdocs[i];
        }
        result->Seek(term);
        return result;
}

} // namespace Lucene

