#ifndef blex_parsers_office_excel_exceldoc
#define blex_parsers_office_excel_exceldoc
//---------------------------------------------------------------------------

#include <blex/docfile.h>
#include <blex/stream.h>
#include <blex/datetime.h>
#include <drawlib/drawlibv2/drawobject.h>

namespace Parsers {
namespace Office {
namespace Excel {

class ExcelDoc
{
public:
        explicit ExcelDoc(Blex::Stream &src);
        ~ExcelDoc();

        std::string GetAllLabelText();

private:
        struct JumpTable
        {
                uint16_t type; //record type
                unsigned minrecsize; //minimum data size
                void (ExcelDoc::*processor)(std::vector<uint8_t> const &data);
        };

        static const JumpTable jumptable[];
        void ProcessRecord(uint16_t type, std::vector<uint8_t> const &data);

        void ProcessBIFF8_BOF(std::vector<uint8_t> const &data);
        void Process_EOF(std::vector<uint8_t> const &data);
        void Process_ROW(std::vector<uint8_t> const &data);
        void Process_DBCELL(std::vector<uint8_t> const &data);
        void Process_LABELSST(std::vector<uint8_t> const &data);
        void Process_SST(std::vector<uint8_t> const &data);

        Blex::MemoryRWStream blobstream;
        std::unique_ptr<Blex::Docfile> excelfile;
        std::unique_ptr<Blex::RandomStream> workbook;

        std::string GetStringByIndex(unsigned idx);
        std::vector<std::string> stringtable;

//ADDME: I guess there are more elegant ways of storing the Excel file contents,
//       but for the moment I'm only interested in label text to index
std::string all_label_text;
};


} //end namespace Excel
} //end namespace Office
} //end namespace Parsers

#endif


