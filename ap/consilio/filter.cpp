#include <ap/libwebhare/allincludes.h>



#include "filter.h"
#include "rangequery.h"

namespace Lucene
{

Filter::~Filter()
{
}

std::string Filter::ToString()
{
        return "()";
}

MultiFilter::MultiFilter(bool _all, bool _none)
: all(_all)
, none(_none)
{
}

void MultiFilter::Add(FilterPtr filter)
{
        if (!filter.get())
            throw LuceneException("Cannot add empty filter to MultiFilter", false);
        filters.push_back(filter);
}

std::shared_ptr<BitVector> MultiFilter::Bits(IndexReader *reader)
{
        std::shared_ptr<BitVector> bits(new BitVector(reader->MaxDoc()));
        if (filters.size() == 0)
            return bits;

        // Set bits for first filter
        std::vector<FilterPtr>::iterator filter = filters.begin();
        bits = (*filter)->Bits(reader);
        if (none)
            bits->Not();

        // Add the other filters
        while (++filter != filters.end())
        {
                std::shared_ptr<BitVector> addbits = (*filter)->Bits(reader);
                if (none)
                    addbits->Not();
                for (uint32_t i = 0; i < bits->Size(); ++i)
                    if (all || none)
                        bits->And(i, addbits->Get(i));
                    else
                        bits->Or(i, addbits->Get(i));
        }
        return bits;
}

std::string MultiFilter::ToString()
{
        std::string s = "(";
        for (std::vector<FilterPtr>::iterator filter = filters.begin(); filter != filters.end(); ++filter)
            s += (filter != filters.begin() ? "," : "") + (*filter)->ToString();
        return s + ")";
}

InitialValueFilter::InitialValueFilter(Term const &_initialterm)
{
        if (!_initialterm.Valid() || _initialterm.Field().empty() || _initialterm.Text().empty())
            throw LuceneException("Invalid initial term for InitialValueFilter",false);
        initialterm = _initialterm;
}

std::shared_ptr<BitVector> InitialValueFilter::Bits(IndexReader *reader)
{
        std::shared_ptr<BitVector> bits(new BitVector(reader->MaxDoc()));
        const std::unique_ptr<TermEnum> enumerator(reader->Terms(initialterm));
        const std::unique_ptr<TermDocs> termdocs(reader->GetTermDocs());
        if (!enumerator->GetTerm().Valid())
            return bits;

        while (enumerator->GetTerm().StartsWith(initialterm))
        {
                termdocs->Seek(enumerator->GetTerm());
                while (termdocs->Next())
                    bits->Set(termdocs->Doc());
                if (!enumerator->Next())
                    break;
        }
        return bits;
}

std::string InitialValueFilter::ToString()
{
        return "(" + initialterm.ToString() + "*)";
}

void GenerateTermDocs(IndexReader *reader, TermEnum *enumerator, BitVector *bitset)
{
        std::vector<uint32_t> docs;
        std::vector<uint32_t> freqs;
        docs.resize(32);
        freqs.resize(32);

        const std::unique_ptr<TermDocs> termdocs(reader->GetTermDocs());
        do
        {
                Term term = enumerator->GetTerm();
                if (!term.Valid())
                    break;

                termdocs->Seek(term);
                while (true)
                {
                        uint32_t count = termdocs->Read(&docs, &freqs);
                        if (count > 0)
                        {
                                for (uint32_t i=0; i<count; ++i)
                                    bitset->Set(docs[i]);
                        }
                        else
                            break;
                }
        }
        while (enumerator->Next());
}

MultiTermQueryWrapperFilter::MultiTermQueryWrapperFilter(QueryPtr _query)
: query(_query)
{
        multitermquery = dynamic_cast<MultiTermQuery *>(query.get());
        if (!multitermquery)
            throw LuceneException("MultiTermQuery needed for MultiTermQueryWrapperFilter",false);
}

std::shared_ptr<BitVector> MultiTermQueryWrapperFilter::Bits(IndexReader *reader)
{
        std::shared_ptr<FilteredTermEnum> enumerator = multitermquery->GetEnum(reader);
        std::shared_ptr<BitVector> bits(new BitVector(reader->MaxDoc()));
        GenerateTermDocs(reader, enumerator.get(), bits.get());
        return bits;
}

RangeFilter::RangeFilter(const std::string &fieldname,
                         const std::string &lowerterm, const std::string &upperterm,
                         bool includelower, bool includeupper)
: MultiTermQueryWrapperFilter(QueryPtr(new TermRangeQuery(fieldname, lowerterm, upperterm, includelower, includeupper)))
{
}

std::string RangeFilter::ToString()
{
        TermRangeQuery *rangequery = (TermRangeQuery *)query.get();
        return "("
             + rangequery->fieldname + ":"
             + (rangequery->includelower ? "[" : "{")
             + rangequery->lowertermtext + "," + rangequery->uppertermtext
             + (rangequery->includeupper ? "]" : "}")
             + ")";
}

} // namespace Lucene
