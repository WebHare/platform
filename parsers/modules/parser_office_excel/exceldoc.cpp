//---------------------------------------------------------------------------
#include <ap/libwebhare/allincludes.h>

//---------------------------------------------------------------------------
#include "exceldoc.h"

namespace Parsers {
namespace Office {
namespace Excel {

const ExcelDoc::JumpTable ExcelDoc::jumptable[]=
{ { 0x0809, 16, &ExcelDoc::ProcessBIFF8_BOF }
, {     10,  0, &ExcelDoc::Process_EOF }
#ifdef DEBUG
, { 0x0208,  16, &ExcelDoc::Process_ROW }
, { 0x00D7,   4, &ExcelDoc::Process_DBCELL }
#endif
, { 0x00FC,   8, &ExcelDoc::Process_SST }
, { 0x00FD,  10, &ExcelDoc::Process_LABELSST }
};

//ADDME: Force parent to guarantee stream lifetime and use it srandomstream ?
ExcelDoc::ExcelDoc(Blex::Stream &src)
{
        src.SendAllTo(blobstream);
        excelfile.reset(new Blex::Docfile(blobstream));

        Blex::Docfile::File const *workbookfile = excelfile->FindFile(excelfile->GetRoot(),"Workbook");
        if (workbookfile==NULL)
            throw std::runtime_error("This does not appear to be a proper Excel file");

        workbook.reset(excelfile->OpenOleFile(workbookfile));
        if (!workbook.get())
            throw std::runtime_error("This does not appear to be a proper Excel file");

        std::vector<uint8_t> data;

        unsigned offset=0;
        while(offset<workbook->GetFileLength())
        {
                uint8_t hdr[4];
                workbook->DirectRead(offset,hdr,4);

                uint16_t type = Blex::getu16lsb(hdr);
                data.resize(Blex::getu16lsb(hdr+2));

                if (!data.empty())
                    workbook->DirectRead(offset+4, &data[0], data.size());

                ProcessRecord(type, data);
                offset+=4+data.size();
        }

}

ExcelDoc::~ExcelDoc()
{
}

std::string ExcelDoc::GetAllLabelText()
{
        return all_label_text;
}

void ExcelDoc::ProcessRecord(uint16_t type, std::vector<uint8_t> const &data)
{
        /* look up the record in the jump table */
        for (unsigned i=0;i<sizeof (jumptable)/sizeof(jumptable[0]);++i)
          if(jumptable[i].type == type)
          {
                /* Match! */
                if (data.size() < jumptable[i].minrecsize)
                {
                        DEBUGPRINT("Record of type " << type << " has size " << data.size() << " but minimum is " << jumptable[i].minrecsize);
                        return;
                }
                (this->*jumptable[i].processor)(data);
                return;
        }

        DEBUGPRINT("Unhandled " << type << " len " << data.size());
}

void ExcelDoc::ProcessBIFF8_BOF(std::vector<uint8_t> const &data)
{
        DEBUGPRINT("BOF (BIFF8) version= " << Blex::getu16lsb(&data[0])
                           << " type=" << Blex::getu16lsb(&data[2])
                           << " buildid=" << Blex::getu16lsb(&data[4])
                           << " buildyear=" << Blex::getu16lsb(&data[6])
                           << " historyflags=" << Blex::getu16lsb(&data[8])
                           << " lowestversion=" << Blex::getu16lsb(&data[10]));

        switch(Blex::getu16lsb(&data[2]))
        {
        case 5:
                DEBUGPRINT("-- Workbook globals --");
                break;
        case 6:
                DEBUGPRINT("-- VB module --");
                break;
        case 0x10:
                DEBUGPRINT("-- Worksheet --");
                break;
        case 0x20:
                DEBUGPRINT("-- Chart --");
                break;
        case 0x40:
                DEBUGPRINT("-- Macro sheet --");
                break;
        case 0x100:
                DEBUGPRINT("-- Workspace file --");
                break;
        default:
                DEBUGPRINT("-- UNKNOWN TYPE OF DATA FOLLOWS --");
                break;
        }

}

void ExcelDoc::Process_EOF(std::vector<uint8_t> const &)
{
        DEBUGPRINT("-- End of data --");
}

#ifdef DEBUG
void ExcelDoc::Process_ROW(std::vector<uint8_t> const &data) //Note: we support only BIFF5+ format
{
        unsigned index=Blex::getu16lsb(&data[0]);
        unsigned firstcell=Blex::getu16lsb(&data[2]);
        unsigned limitcell=Blex::getu16lsb(&data[4]);
        unsigned heightinfo=Blex::getu16lsb(&data[6]); //bit 15: 1,default height,0,custom, bits0-14: height in twips

        /* data[10..11] In BIFF3-BIFF4 this field contains a relative offset to calculate stream position of the first
        cell record for this row (.5.7.1). In BIFF5-BIFF8 this field is not used anymore, but the
        DBCELL record (.6.26) instead. */
        /* data[12..15] formatting info and index to default XF record */

        DEBUGPRINT("Row index " << index << " described " << firstcell << " until " << limitcell << " size " << data.size() << " heightinfo " << heightinfo);
}
void ExcelDoc::Process_DBCELL(std::vector<uint8_t> const &data)
{
        DEBUGPRINT("Relative offset to first row: " << Blex::getu32lsb(&data[0]));
        //also contains some offsets, which we might not yet need?
}
#endif

void ExcelDoc::Process_SST(std::vector<uint8_t> const &data)
{
        unsigned numstrings = Blex::getu32lsb(&data[4]);
        DEBUGPRINT("Shared string table: total " << Blex::getu32lsb(&data[0]) << " unique " << numstrings);

        /* Parse the string table */
        stringtable.resize(numstrings);

        unsigned idx=0, offset=8;
        while(offset+3<data.size() && idx < data.size())
        {
                uint16_t len = Blex::getu16lsb(&data[offset]);
                uint16_t rt = 0;
                uint8_t options = data[offset+2];

                if (options & (0xFF-0x9)) //We only support option bits 0x1 (compression) and 0x8 (rich text)
                {
                        DEBUGPRINT("Cannot interpret string with options " << (uint32_t)(options) << " at " << offset);
                        return;
                }
                if (options & 0x8) //This record contains Rich-Text settings
                {
                        rt = Blex::getu16lsb(&data[offset+3]);
                        offset+=2;
                }
                if ((options & 0x1) == 0) //This is an 8 bit string (FIXME: charset to UTF-8 conversion)
                {
                        if (offset+3+len > data.size())
                        {
                                DEBUGPRINT("Too large 8bit string at " << offset);
                                return;
                        }
                        stringtable[idx].assign(&data[offset+3], &data[offset+3+len]);
                        offset+=3+len;
                }
                else //a 16 bit string (FIXME: UTF16 to UTF-8 conversion)
                {
                        if (offset+3+len*2 > data.size())
                        {
                                DEBUGPRINT("Too large 16bit string at " << offset);
                                return;
                        }
                        Blex::UTF8Decode(reinterpret_cast<uint16_t const *>(&data[offset+3])
                                        ,reinterpret_cast<uint16_t const *>(&data[offset+3+len*2])
                                        ,std::back_inserter(stringtable[idx]));
                        offset+=3+len*2;
                }
                offset+=rt*4; //Skip Rich-Text formatting runs
                ++idx;
        }
}
void ExcelDoc::Process_LABELSST(std::vector<uint8_t> const &data)
{
        unsigned idx = Blex::getu32lsb(&data[6]);
        DEBUGPRINT("Label row " << Blex::getu16lsb(&data[0])
                   << " column " << Blex::getu16lsb(&data[2])
                   << " xf " << Blex::getu16lsb(&data[4])
                   << " sst " << idx
                   << " data '" << GetStringByIndex(idx) << "'");
        all_label_text += (all_label_text.empty() ? "" : " ") + GetStringByIndex(idx);
}

std::string ExcelDoc::GetStringByIndex(unsigned idx)
{
        if(idx<stringtable.size())
            return stringtable[idx];
        else
            return "";
}

} //end namespace Excel
} //end namespace Office
} //end namespace Parsers
