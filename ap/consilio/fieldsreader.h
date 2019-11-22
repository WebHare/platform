#ifndef blex_consilio_index_fieldsreader
#define blex_consilio_index_fieldsreader

#include "fieldinfo.h"
#include "document.h"

namespace Lucene
{

/** The FieldsReader reads stored Field values. */
class FieldsReader
{
    public:
        /** Create a stored Field%s reader.
            @param d The Blex::ComplexFileSystem to read from
            @param segment The segment to read Field%s for
            @param fn Information about the Field%s */
        FieldsReader(Blex::ComplexFileSystem* d, const std::string & segment, const FieldInfos & fn);

        /** Get the total number of Document%s in the segment, which is not necessarily
            the number of Document%s for which Field%s are stored.
            @return The number of Documents */
        uint32_t Size();

        /** Get the stored Field%s for a Document, or NULL when @c n is out of
            bounds.
            @param n The Document number to retrieve the Field%s for */
        Document * Doc(uint32_t n);

    private:
        /// Information about the Field%s
        const FieldInfos & fieldinfos;
        /// File to read stored Field%s from
        const std::unique_ptr<Blex::ComplexFileStream> fieldsstream;
        /// File to read ::fieldsstream offsets for each Document from
        const std::unique_ptr<Blex::ComplexFileStream> indexstream;
        /// Number of Document%s
        uint32_t size;
};

} // namespace Lucene

#endif

