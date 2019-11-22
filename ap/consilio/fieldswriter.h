#ifndef blex_consilio_index_fieldswriter
#define blex_consilio_index_fieldswriter

#include "fieldinfo.h"

namespace Lucene
{

/** The FieldsWriter writes stored Field values. */
class FieldsWriter
{
    public:
        /** Create a stored Field%s writer.
            @param d The Blex::ComplexFileSystem to read from
            @param segment The segment to read Field%s for
            @param fn Information about the Field%s */
        FieldsWriter(Blex::ComplexFileSystem &d, const std::string & segment, const FieldInfos & fn);

        /** Add the Field%s of a Document.
            @param doc The Document to add the stored Field%s from */
        void AddDocument(const Document & doc);

    private:
        /// Information about the Field%s
        const FieldInfos & fieldinfos;
        /// File to write stored Field%s to
        const std::unique_ptr<Blex::ComplexFileStream> fieldsstream;
        /// File to write ::fieldsstream offsets for each Document to
        const std::unique_ptr<Blex::ComplexFileStream> indexstream;
};

} // namespace Lucene

#endif

