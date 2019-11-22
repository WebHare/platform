#include <ap/libwebhare/allincludes.h>


#include "fieldsreader.h"

namespace Lucene
{

FieldsReader::FieldsReader(Blex::ComplexFileSystem * d, const std::string & segment, const FieldInfos & fn)
: fieldinfos(fn)
, fieldsstream(d->OpenFile(segment + ".fdt",false,false))
, indexstream(d->OpenFile(segment + ".fdx",false,false))
{
        if (!fieldsstream.get())
            throw LuceneException("Cannot open fields file "+segment + ".fdt",false);

        if (!indexstream.get())
            throw LuceneException("Cannot open index file "+segment + ".fdx",false);

        size = indexstream->GetFileLength() / 4; //ADDME: This is the sizeof the WriteLong in AddDOcument, replace this with a sizeof when possible...
}

uint32_t FieldsReader::Size()
{
        return size;
}

Document * FieldsReader::Doc(uint32_t n)
{
        if (n >= size)
            return NULL;

        indexstream->SetOffset(n * (uint32_t)4);
        fieldsstream->SetOffset(indexstream->ReadLsb<uint32_t>());

        std::unique_ptr<Document> doc (new Document);
        uint32_t numfields = fieldsstream->ReadLsb<uint32_t>();
        for (uint32_t i = 0; i < numfields; ++i)
        {
                uint32_t fieldnumber = fieldsstream->ReadLsb<uint32_t>();
                const FieldInfo * fi = fieldinfos.GetFieldInfo(fieldnumber);

                uint8_t bits = fieldsstream->ReadLsb<uint8_t>();

                Field f = Field(fi->name,
                    fieldsstream->ReadLsb<std::string>(),
                    true,
                    fi->isindexed,
                    (bits & 1) != 0);
                doc->Add(f);
        }
        return doc.release();
}

} // namespace Lucene

