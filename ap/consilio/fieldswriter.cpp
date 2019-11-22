#include <ap/libwebhare/allincludes.h>




#include "fieldswriter.h"

namespace Lucene
{

FieldsWriter::FieldsWriter(Blex::ComplexFileSystem &d, const std::string & segment, const FieldInfos & fn)
: fieldinfos(fn)
, fieldsstream(d.OpenFile(segment + ".fdt",true,true))
, indexstream(d.OpenFile(segment + ".fdx",true,true))
{
        if (!fieldsstream.get() || !indexstream.get())
            throw std::runtime_error("Unable to create field writers files for segment " + segment);
}

void FieldsWriter::AddDocument(const Document & doc)
{
//        fieldsstream->Flush();
        indexstream->WriteLsb<uint32_t>(fieldsstream->GetOffset());

        uint32_t storedcount = 0;
        for (DocumentFieldList::const_iterator it = doc.Fields().begin(); it != doc.Fields().end(); ++it)
            if (it->IsStored())
                storedcount++;
        fieldsstream->WriteLsb<uint32_t>(storedcount);

        for (DocumentFieldList::const_iterator it = doc.Fields().begin(); it != doc.Fields().end(); ++it)
            if (it->IsStored())
        {
                fieldsstream->WriteLsb<uint32_t>(fieldinfos.FieldNumber(it->Name()));

                uint8_t bits = 0;
                if (it->IsTokenized())
                    bits |= 1;
                fieldsstream->WriteLsb<uint8_t>(bits);

                fieldsstream->WriteLsb<std::string>(it->StringValue());
        }
}

} // namespace Lucene

