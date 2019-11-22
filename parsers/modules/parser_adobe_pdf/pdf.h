#ifndef blex_harescript_modules_pdf
#define blex_harescript_modules_pdf
//---------------------------------------------------------------------------

//#include <harescript/vm/hsvm_dllinterface.h>
#include <harescript/vm/hsvm_idmapstorage.h>
#include <harescript/vm/hsvm_dllinterface_blex.h>

#include <blex/unicode.h>
#include <blex/stream.h>
#include <blex/blexlib.h>
#include <blex/crypto.h>

#include "pdf_file.h"

namespace Parsers
{

namespace Adobe
{

namespace PDF
{


class PDFConversion
{
        HSVM *hsvm;
        HareScript::Interface::InputStream instr;
        PDFfile pdffile;

        void StoreOutlineItems(std::vector<OutlineItemPtr> const &outline_items, HSVM_VariableId id);
public:

        PDFConversion(HSVM *hsvm, HSVM_VariableId filedata);
        ~PDFConversion();

        void OpenFile();

        unsigned GetNumberOfPages()
        {
                return pdffile.GetRootPageTree().GetNumPages();
        }

        std::string GetTextOnPage(unsigned pagenr) const
        {
                PlainTextRenderer renderer;

                DEBUGPRINT("Get text on page page " << (pagenr-1));
                Page const &page = pdffile.GetRootPageTree().FindPage(pagenr - 1);
                page.Render(&renderer);

                return renderer.GetText();
        }

        void GetTextItemsOnPage(unsigned pagenr, HSVM_VariableId id);
        void GetMetaInfo(HSVM_VariableId id);
        void GetOutlineItems(HSVM_VariableId id);
        void Write(Blex::Stream &out);
};

/** Global PDF data, per VM */
class PDFContext
{
        public:
        PDFContext();
        ~PDFContext();

        typedef std::shared_ptr<PDFConversion> PDFConversionPtr;
        HareScript::IdMapStorage<PDFConversionPtr> conversionlist;
        std::string last_error;

};

/////////////////////////////////////////////////////
// Some (globally) used debug functions:

const unsigned PDFContextId = 519;

}
}
}

//---------------------------------------------------------------------------
#endif
