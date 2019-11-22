#ifndef blex_consilio_search_termrangequery
#define blex_consilio_search_termrangequery

#include "filteredtermenum.h"
#include "multitermquery.h"

namespace Lucene
{

class TermRangeQuery : public MultiTermQuery
{
    public:
        TermRangeQuery(const std::string &fieldname,
                       const std::string &lowertermtext, const std::string &uppertermtext,
                       bool includelower, bool includeupper);

    protected:
        virtual std::shared_ptr<FilteredTermEnum> GetEnum(IndexReader * reader);

    private:
        std::string fieldname;
        std::string lowertermtext;
        std::string uppertermtext;
        bool includelower;
        bool includeupper;

        friend class RangeFilter;
};

class TermRangeTermEnum : public FilteredTermEnum
{
    public:
        TermRangeTermEnum(IndexReader *reader, const std::string &fieldname,
                          const std::string &lowertermtext, const std::string &uppertermtext,
                          bool includelower, bool includeupper);

        virtual float Difference();
        virtual bool TermCompare(const Term & term);
        virtual bool EndEnum();

    private:
        bool endenum;
        std::string fieldname;
        std::string lowertermtext;
        std::string uppertermtext;
        bool includelower;
        bool includeupper;
};

} // namespace Lucene

#endif
