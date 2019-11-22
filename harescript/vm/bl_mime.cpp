#include <harescript/vm/allincludes.h>


#include <blex/docfile.h>
#include "baselibs.h"
#include "hsvm_context.h"

namespace HareScript {
namespace Baselibs {

MimeDecodeStore::MimeDecodeStore(HSVM *vm,
                                          std::string const &toptype,
                                          std::string const &topencoding,
                                          std::string const &topdescription,
                                          std::string const &topdisposition,
                                          std::string const &topcontentid,
                                          std::string const &defaultcontenttype,
                                          Blex::FileOffset data_part,
                                          Blex::FileOffset part_start,
                                          Blex::FileOffset body_start)
: tempstream(0)
, vm(vm)
, toppart(0)
, counter(0)
, decoder(*this, defaultcontenttype)
{
        decoder.Start(toptype,topencoding,topdescription,topdisposition,topcontentid,data_part,part_start,body_start);
}

void MimeDecodeStore::StartPart(std::string const &contenttype, std::string const &encoding, std::string const &description, std::string const &disposition, std::string const &content_id, std::string const &original_charset, Blex::FileOffset part_start, Blex::FileOffset body_start)
{
        //Flush data?
        if (tempstream)
        {
                HSVM_MakeBlobFromStream(vm, partstack.top().celldata, tempstream);
                tempstream=0;
        }

        Part newpart;

        //Append to a part list?
        if (!partstack.empty())
        {
                newpart.thisrec = HSVM_ArrayAppend(vm, partstack.top().cellparts);
        }
        else
        {
                toppart = HSVM_AllocateVariable(vm);
                newpart.thisrec = toppart;
                HSVM_SetDefault(vm, toppart, HSVM_VAR_Record);
        }

        //Look up the column ids
        HSVM_ColumnId col_partid = HSVM_GetColumnId(vm, "ID");
        HSVM_ColumnId col_mimetype = HSVM_GetColumnId(vm, "MIMETYPE");
        HSVM_ColumnId col_encoding = HSVM_GetColumnId(vm, "ENCODING");
        HSVM_ColumnId col_description = HSVM_GetColumnId(vm, "DESCRIPTION");
        HSVM_ColumnId col_data = HSVM_GetColumnId(vm, "DATA");
        HSVM_ColumnId col_subparts = HSVM_GetColumnId(vm, "SUBPARTS");
        HSVM_ColumnId col_contentid = HSVM_GetColumnId(vm, "CONTENTID");
        HSVM_ColumnId col_ofs_partstart = HSVM_GetColumnId(vm, "OFS_PARTSTART");
        HSVM_ColumnId col_ofs_bodystart = HSVM_GetColumnId(vm, "OFS_BODYSTART");
        HSVM_ColumnId col_original_charset = HSVM_GetColumnId(vm, "ORIGINAL_CHARSET");
        HSVM_ColumnId col_disposition = HSVM_GetColumnId(vm, "DISPOSITION");

        //Create the record and allocate the variable Ids
        HSVM_VariableId cell_partid = HSVM_RecordCreate(vm, newpart.thisrec, col_partid);
        HSVM_VariableId cell_mimetype = HSVM_RecordCreate(vm, newpart.thisrec, col_mimetype);
        HSVM_VariableId cell_encoding = HSVM_RecordCreate(vm, newpart.thisrec, col_encoding);
        HSVM_VariableId cell_description = HSVM_RecordCreate(vm, newpart.thisrec, col_description);
        newpart.celldata = HSVM_RecordCreate(vm, newpart.thisrec, col_data);
        newpart.cellparts = HSVM_RecordCreate(vm, newpart.thisrec, col_subparts);
        HSVM_VariableId cell_contentid = HSVM_RecordCreate(vm, newpart.thisrec, col_contentid);
        HSVM_VariableId cell_ofs_partstart = HSVM_RecordCreate(vm, newpart.thisrec, col_ofs_partstart);
        HSVM_VariableId cell_ofs_bodystart = HSVM_RecordCreate(vm, newpart.thisrec, col_ofs_bodystart);
        HSVM_VariableId cell_original_charset = HSVM_RecordCreate(vm, newpart.thisrec, col_original_charset);
        HSVM_VariableId cell_disposition = HSVM_RecordCreate(vm, newpart.thisrec, col_disposition);

        //Init the part variable
        HSVM_IntegerSet(vm, cell_partid, ++counter);
        HSVM_StringSetSTD(vm, cell_mimetype, contenttype);
        HSVM_StringSetSTD(vm, cell_encoding, encoding);
        HSVM_StringSetSTD(vm, cell_description, description);
        HSVM_SetDefault(vm, newpart.celldata, HSVM_VAR_Blob);
        HSVM_SetDefault(vm, newpart.cellparts, HSVM_VAR_RecordArray);
        HSVM_StringSetSTD(vm, cell_contentid, content_id);
        HSVM_IntegerSet(vm, cell_ofs_partstart, part_start);
        HSVM_IntegerSet(vm, cell_ofs_bodystart, body_start);
        HSVM_StringSetSTD(vm, cell_original_charset, original_charset);
        HSVM_StringSetSTD(vm, cell_disposition, disposition);

        partstack.push(newpart);
}
void MimeDecodeStore::EndPart(Blex::FileOffset body_end, Blex::FileOffset part_end, unsigned linecount)
{
        if (partstack.empty())
            throw VMRuntimeError(Error::InternalError,"Got a mime closure without any open parts");

        //Flush data?
        if (tempstream)
        {
                HSVM_MakeBlobFromStream(vm, partstack.top().celldata, tempstream);
                tempstream=0;
        }

        HSVM_ColumnId col_bodyend = HSVM_GetColumnId(vm, "OFS_BODYEND");
        HSVM_ColumnId col_partend = HSVM_GetColumnId(vm, "OFS_PARTEND");
        HSVM_ColumnId col_lines = HSVM_GetColumnId(vm, "LINES");

        HSVM_VariableId cell_bodyend = HSVM_RecordCreate(vm, partstack.top().thisrec, col_bodyend);
        HSVM_VariableId cell_partend = HSVM_RecordCreate(vm, partstack.top().thisrec, col_partend);
        HSVM_VariableId cell_lines = HSVM_RecordCreate(vm, partstack.top().thisrec, col_lines);

        HSVM_IntegerSet(vm, cell_bodyend, body_end);
        HSVM_IntegerSet(vm, cell_partend, part_end);
        HSVM_IntegerSet(vm, cell_lines, linecount);

        partstack.pop();
}
void MimeDecodeStore::ReceiveData(const void *databuffer, unsigned buflen)
{
        if (partstack.empty())
            throw VMRuntimeError(Error::InternalError,"Got mime data without any open parts");

        if (tempstream == 0)
        {
                tempstream = HSVM_CreateStream(vm);
                if (tempstream <= 0)
                    throw VMRuntimeError(Error::IOError);
        }
        if (!HSVM_PrintTo(vm, tempstream, buflen, databuffer))
            throw VMRuntimeError(Error::IOError);
}

int FeedMimeData(void *opaque_ptr, int numbytes, void const *data, int /*allow_partial*/, int *error_code)
{
        MimeDecodeStore *mds = static_cast<MimeDecodeStore *>(opaque_ptr);
        //ADDME scratchpad can be removed if HSVM does not reallocate sharedpools away under the mime decoder
        mds->scratchpad.assign(static_cast<uint8_t const*>(data), static_cast<uint8_t const*>(data) + numbytes);
        mds->decoder.ProcessData(mds->scratchpad.begin(), mds->scratchpad.size());
        *error_code = 0;
        return numbytes;
}

void HS_CreateMimeDecoder(HSVM *vm, HSVM_VariableId id_set)
{
        Baselibs::SystemContext context(HareScript::GetVirtualMachine(vm)->GetContextKeeper());

        std::string toptype = HSVM_StringGetSTD(vm, HSVM_Arg(0));
        std::string topencoding = HSVM_StringGetSTD(vm, HSVM_Arg(1));
        std::string topdescription = HSVM_StringGetSTD(vm, HSVM_Arg(2));
        std::string topdisposition = HSVM_StringGetSTD(vm, HSVM_Arg(3));
        std::string topcontentid = HSVM_StringGetSTD(vm, HSVM_Arg(4));
        std::string defaultcontenttype = HSVM_StringGetSTD(vm, HSVM_Arg(5));
        int32_t data_start = HSVM_IntegerGet(vm, HSVM_Arg(6));
        int32_t part_start = HSVM_IntegerGet(vm, HSVM_Arg(7));
        int32_t body_start = HSVM_IntegerGet(vm, HSVM_Arg(8));

        MimeDecodeStorePtr newdecoder(new MimeDecodeStore(vm, toptype, topencoding, topdescription, topdisposition, topcontentid, defaultcontenttype, data_start, part_start, body_start));
        int fileid = HSVM_RegisterIOObject(vm, newdecoder.get(), NULL, &FeedMimeData, NULL, NULL);
        context->decoders[fileid] = newdecoder;
        HSVM_IntegerSet(vm, id_set, fileid);
}

void HS_FinishMimeData(HSVM *vm, HSVM_VariableId id_set)
{
        Baselibs::SystemContext context(HareScript::GetVirtualMachine(vm)->GetContextKeeper());

        HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);

        int32_t fileid = HSVM_IntegerGet(vm, HSVM_Arg(0));
        std::map<int, MimeDecodeStorePtr>::iterator itr = context->decoders.find(fileid);
        if (itr != context->decoders.end())
        {
                itr->second->decoder.Finish();
                if (itr->second->toppart != 0)
                {
                        HSVM_CopyFrom(vm, id_set, itr->second->toppart);
                        HSVM_DeallocateVariable(vm, itr->second->toppart);
                }
                context->decoders.erase(itr);
                HSVM_UnregisterIOObject(vm, fileid);
        }
}

void HS_DecodeMimeEncodedWords(HSVM *vm, HSVM_VariableId id_set)
{
        Blex::StringPair instring;
        HSVM_StringGet(vm, HSVM_Arg(0), &instring.begin, &instring.end);

        std::string out;
        Blex::Mime::DecodeEncodedWords(instring.size(),instring.begin,&out);

        HSVM_StringSetSTD(vm, id_set,out);
}
void HS_EncodeMimeWords(HSVM *vm, HSVM_VariableId id_set)
{
        Blex::StringPair instring;
        HSVM_StringGet(vm, HSVM_Arg(0), &instring.begin, &instring.end);


        std::string out;
        Blex::Mime::EncodeWords(instring.size(),instring.begin,&out);

        HSVM_StringSetSTD(vm, id_set,out);
}

void HS_GetBestCharacterset(HSVM *vm, HSVM_VariableId id_set)
{
        Blex::StringPair instring;
        HSVM_StringGet(vm, HSVM_Arg(0), &instring.begin, &instring.end);

        Blex::Charsets::Charset suggested = Blex::GetBestCharacterset(instring.begin,instring.end);
        HSVM_StringSetSTD(vm, id_set,Blex::GetCharsetName(suggested));
}

void HS_DecodeCharset(HSVM *vm, HSVM_VariableId id_set)
{
        Blex::StringPair instring;
        HSVM_StringGet(vm, HSVM_Arg(0), &instring.begin, &instring.end);

        Blex::StringPair charsetname;
        HSVM_StringGet(vm, HSVM_Arg(1), &charsetname.begin, &charsetname.end);

        Blex::Charsets::Charset charset = Blex::FindCharacterset(charsetname.begin,charsetname.end);
        std::string outstring;
        if (charset != Blex::Charsets::Unknown)
            Blex::ConvertCharsetToUTF8(instring.begin, instring.end, charset, &outstring);
        else
            HSVM_ThrowException(vm, ("Unknown charset '" + charsetname.stl_str() + "'").c_str());

        HSVM_StringSetSTD(vm, id_set, outstring);
}

void HS_EncodeCharset(HSVM *vm, HSVM_VariableId id_set)
{
        Blex::StringPair instring;
        HSVM_StringGet(vm, HSVM_Arg(0), &instring.begin, &instring.end);

        Blex::StringPair charsetname;
        HSVM_StringGet(vm, HSVM_Arg(1), &charsetname.begin, &charsetname.end);

        Blex::Charsets::Charset charset = Blex::FindCharacterset(charsetname.begin,charsetname.end);
        std::string outstring;
        outstring.reserve(instring.size());

        if (charset != Blex::Charsets::Unknown)
            Blex::ConvertUTF8ToCharset(instring.begin, instring.end, charset, &outstring);
        else
            HSVM_ThrowException(vm, ("Unknown charset '" + charsetname.stl_str() + "'").c_str());

        HSVM_StringSetSTD(vm, id_set, outstring);
}

void HS_IsValidUTF8(HSVM *vm, HSVM_VariableId id_set)
{
        Blex::StringPair instring;
        HSVM_StringGet(vm, HSVM_Arg(0), &instring.begin, &instring.end);
        HSVM_BooleanSet(vm, id_set, Blex::IsValidUTF8(instring.begin, instring.end, HSVM_BooleanGet(vm, HSVM_Arg(1))));
}

void HS_IsPrintableASCII(HSVM *vm, HSVM_VariableId id_set)
{
        Blex::StringPair instring;
        HSVM_StringGet(vm, HSVM_Arg(0), &instring.begin, &instring.end);
        for (const char *ptr=instring.begin; ptr!=instring.end; ++ptr)
          if (*ptr<32 || *ptr>126)
          {
            HSVM_BooleanSet(vm, id_set, false);
            return;
          }
        HSVM_BooleanSet(vm, id_set, true);
}

void InitMime(struct HSVM_RegData *regdata)
{
        HSVM_RegisterFunction(regdata, "__CREATEMIMEDECODER::I:SSSSSSIII",HS_CreateMimeDecoder);
        HSVM_RegisterFunction(regdata, "DECODECHARSET::S:SS",HS_DecodeCharset);
        HSVM_RegisterFunction(regdata, "DECODEMIMEENCODEDWORDS::S:S",HS_DecodeMimeEncodedWords);
        HSVM_RegisterFunction(regdata, "ENCODECHARSET::S:SS",HS_EncodeCharset);
        HSVM_RegisterFunction(regdata, "ENCODEMIMEWORDS::S:S",HS_EncodeMimeWords);
        HSVM_RegisterFunction(regdata, "FINISHMIMEDATA::R:I",HS_FinishMimeData);
        HSVM_RegisterFunction(regdata, "GETBESTCHARACTERSET::S:S",HS_GetBestCharacterset);
        HSVM_RegisterFunction(regdata, "ISVALIDUTF8::B:SB",HS_IsValidUTF8);
        HSVM_RegisterFunction(regdata, "ISPRINTABLEASCII::B:S",HS_IsPrintableASCII);
}

} // End of namespace Baselibs
} // End of namespace HareScript
