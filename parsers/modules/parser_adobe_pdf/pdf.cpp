//---------------------------------------------------------------------------
#include <ap/libwebhare/allincludes.h>

//---------------------------------------------------------------------------

#include "pdf.h"
#include <blex/utils.h>

namespace Parsers
{

namespace Adobe
{

namespace PDF
{

PDFConversion::PDFConversion(HSVM *_hsvm, HSVM_VariableId filedata)
 : hsvm(_hsvm)
 , instr(_hsvm, filedata)
 , pdffile(instr)
{ }

PDFConversion::~PDFConversion()
{
}

void PDFConversion::OpenFile()
{
        pdffile.OpenFile();
}
void PDFConversion::Write(Blex::Stream &out)
{
        pdffile.WriteFile(out);
}

void PDFConversion::GetTextItemsOnPage(unsigned /*pagenr*/, HSVM_VariableId /*rec_array*/)
{
/*
       std::vector<TextItemPtr> text_items = pdffile->GetTextItemsOnPage(pagenr);

        HSVM_SetDefault(hsvm, rec_array, HSVM_VAR_RecordArray);
        for (std::vector<TextItemPtr>::const_iterator it = text_items.begin();
                it != text_items.end(); ++it)
        {
                HSVM_VariableId nextrecord = HSVM_ArrayAppend(hsvm, rec_array);

                HSVM_VariableId x_cell = HSVM_RecordCreate(hsvm, nextrecord, HSVM_GetColumnId(hsvm, "X"));
                HSVM_IntegerSet(hsvm, x_cell, (int32_t)(*it)->x);

                HSVM_VariableId y_cell = HSVM_RecordCreate(hsvm, nextrecord, HSVM_GetColumnId(hsvm, "Y"));
                HSVM_IntegerSet(hsvm, y_cell, (int32_t)(*it)->y);

                HSVM_VariableId parts_cell = HSVM_RecordCreate(hsvm, nextrecord, HSVM_GetColumnId(hsvm, "PARTS"));
                HSVM_SetDefault(hsvm, parts_cell, HSVM_VAR_RecordArray);

                for (std::vector<TextWordsPtr>::const_iterator it_words = (*it)->text_words.begin();
                        it_words != (*it)->text_words.end(); ++it_words)
                {
                        HSVM_VariableId subrecord = HSVM_ArrayAppend(hsvm, parts_cell);

                        HSVM_VariableId size_cell = HSVM_RecordCreate(hsvm, subrecord, HSVM_GetColumnId(hsvm, "SIZE"));
                        HSVM_IntegerSet(hsvm, size_cell, (int32_t)(*it_words)->fontsize);

                        HSVM_VariableId text_cell = HSVM_RecordCreate(hsvm, subrecord, HSVM_GetColumnId(hsvm, "TEXT"));
                        HSVM_StringSetSTD(hsvm, text_cell, (*it_words)->text);

//                        HSVM_VariableId font_cell = HSVM_RecordCreate(hsvm, subrecord, HSVM_GetColumnId(hsvm, "FONT"));
//                        HSVM_StringSetSTD(hsvm, font_cell, (*it_words)->fontname);

                        HSVM_VariableId italic_cell = HSVM_RecordCreate(hsvm, subrecord, HSVM_GetColumnId(hsvm, "ITALIC"));
                        HSVM_BooleanSet(hsvm, italic_cell, (*it_words)->italic);

                        HSVM_VariableId bold_cell = HSVM_RecordCreate(hsvm, subrecord, HSVM_GetColumnId(hsvm, "BOLD"));
                        HSVM_BooleanSet(hsvm, bold_cell, (*it_words)->bold);
                }
        }        */
}

void PDFConversion::GetMetaInfo(HSVM_VariableId id)
{
        std::map<std::string, std::string> meta_info = pdffile.GetMetaInfo();

        HSVM_SetDefault(hsvm, id, HSVM_VAR_Record);

        HSVM_VariableId title_cell = HSVM_RecordCreate(hsvm, id, HSVM_GetColumnId(hsvm, "TITLE"));
        HSVM_StringSetSTD(hsvm, title_cell, meta_info["Title"]);

        HSVM_VariableId author_cell = HSVM_RecordCreate(hsvm, id, HSVM_GetColumnId(hsvm, "AUTHOR"));
        HSVM_StringSetSTD(hsvm, author_cell, meta_info["Title"]);

        HSVM_VariableId subject_cell = HSVM_RecordCreate(hsvm, id, HSVM_GetColumnId(hsvm, "SUBJECT"));
        HSVM_StringSetSTD(hsvm, subject_cell, meta_info["Subject"]);

        HSVM_VariableId keywords_cell = HSVM_RecordCreate(hsvm, id, HSVM_GetColumnId(hsvm, "KEYWORDS"));
        HSVM_StringSetSTD(hsvm, keywords_cell, meta_info["Keywords"]);

        HSVM_VariableId creator_cell = HSVM_RecordCreate(hsvm, id, HSVM_GetColumnId(hsvm, "CREATOR"));
        HSVM_StringSetSTD(hsvm, creator_cell, meta_info["Creator"]);

        HSVM_VariableId producer_cell = HSVM_RecordCreate(hsvm, id, HSVM_GetColumnId(hsvm, "PRODUCER"));
        HSVM_StringSetSTD(hsvm, producer_cell, meta_info["Producer"]);

        HSVM_VariableId lang_cell = HSVM_RecordCreate(hsvm, id, HSVM_GetColumnId(hsvm, "LANG"));
        HSVM_StringSetSTD(hsvm, lang_cell, meta_info["Lang"]);

        // FIXME: These two should be encoded as datetime (in the pdffile probably as an internal date format)
        HSVM_VariableId creationdate_cell = HSVM_RecordCreate(hsvm, id, HSVM_GetColumnId(hsvm, "CREATIONDATE"));
        HSVM_StringSetSTD(hsvm, creationdate_cell, meta_info["CreationDate"]);

        HSVM_VariableId moddate_cell = HSVM_RecordCreate(hsvm, id, HSVM_GetColumnId(hsvm, "MODDATE"));
        HSVM_StringSetSTD(hsvm, moddate_cell, meta_info["ModDate"]);
}

void PDFConversion::StoreOutlineItems(std::vector<OutlineItemPtr> const &outline_items, HSVM_VariableId id)
{
        HSVM_ColumnId title = HSVM_GetColumnId(hsvm, "TITLE");
        HSVM_ColumnId bookmark = HSVM_GetColumnId(hsvm, "BOOKMARK");
        HSVM_ColumnId items = HSVM_GetColumnId(hsvm, "OUTLINE_ITEMS");

        for (std::vector<OutlineItemPtr>::const_iterator item = outline_items.begin();
            item != outline_items.end(); ++item)
        {
                HSVM_VariableId newitem = HSVM_ArrayAppend(hsvm, id);

                HSVM_VariableId cell = HSVM_RecordCreate(hsvm, newitem, title);
                HSVM_StringSetSTD(hsvm, cell, (*item)->GetTitle());

                cell = HSVM_RecordCreate(hsvm, newitem, bookmark);
                HSVM_StringSetSTD(hsvm, cell, (*item)->GetDest());

                cell = HSVM_RecordCreate(hsvm, newitem, items);
                HSVM_SetDefault(hsvm, cell, HSVM_VAR_RecordArray);
                StoreOutlineItems((*item)->GetOutlineItems(), cell);
        }
}

void PDFConversion::GetOutlineItems(HSVM_VariableId id)
{
        // Initialize record array to store outline into
        HSVM_SetDefault(hsvm, id, HSVM_VAR_RecordArray);

        const Outline *outline = pdffile.GetOutline();
        if (outline)
            StoreOutlineItems(outline->GetOutlineItems(), id);
}

// -----------------------------------------------------------------------------
//
//   Context
//
//

/** INTEGER HS_PDF_Open(BLOB filedata)
    @param filename Name of the PDF file to open */
void HS_PDF_Open(HSVM *hsvm, HSVM_VariableId id_set)
{
        PDFContext *context = static_cast<PDFContext*>(HSVM_GetContext(hsvm,PDFContextId,true));

        try
        {
                // Create conversion with specified blob
                std::shared_ptr<PDFConversion> thisconversion(new PDFConversion(hsvm,HSVM_Arg(0)));
                int32_t conversionid = context->conversionlist.Set(thisconversion);

                // Return conversionid
                HSVM_IntegerSet(hsvm, id_set, conversionid);
        }
        catch(std::exception &e)
        {
                //ADDME: Store error somewhere?
                DEBUGPRINT(e.what());
                HSVM_IntegerSet(hsvm, id_set, 0);
                //HSVM_ReportCustomError(hsvm, e.what());
        }
}

/** INTEGER HS_PDF_Conversion(INTEGER fileid)
    @param fileid ID of the PDF File to use*/
void HS_PDF_Conversion(HSVM *hsvm, HSVM_VariableId id_set)
{
        PDFContext *context = static_cast<PDFContext*>(HSVM_GetContext(hsvm,PDFContextId,true));

        int32_t conversionid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        PDFContext::PDFConversionPtr *ppc = context->conversionlist.Get(conversionid);

        bool success = true;
        context->last_error = "";
        try
        {
                if(!ppc)
                    throw std::runtime_error("Invalid PDF handle");

                (*ppc)->OpenFile();
        }
        catch(std::exception&e)
        {
                // We don't directly report this error using ReportCustomError, so the script
                // can continue to run. This function returns false when something happended,
                // use GetLastPDFError to obtain the error.
                context->last_error = e.what();
                success = false;
        }

        // Return Something
        HSVM_BooleanSet(hsvm, id_set, success);
}

/** STRING HS_PDF_GetLastError() */
void HS_PDF_GetLastError(HSVM *hsvm, HSVM_VariableId id_set)
{
        PDFContext *context = static_cast<PDFContext*>(HSVM_GetContext(hsvm,PDFContextId,true));
        HSVM_StringSetSTD(hsvm, id_set, context->last_error);
}

/** INTEGER HS_PDF_GetTextOnPage(INTEGER fileid, INTEGER pagenr)
    @param fileid ID of the PDF File to use*/
void HS_PDF_GetTextOnPage(HSVM *hsvm, HSVM_VariableId id_set)
{
        PDFContext *context = static_cast<PDFContext*>(HSVM_GetContext(hsvm,PDFContextId,true));

        int32_t conversionid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        int32_t pagenr = HSVM_IntegerGet(hsvm, HSVM_Arg(1));

        PDFContext::PDFConversionPtr *ppc = context->conversionlist.Get(conversionid);

        try
        {
                if(!ppc)
                    throw std::runtime_error("Invalid PDF handle");

                std::string text = (*ppc)->GetTextOnPage(pagenr);
                HSVM_StringSetSTD(hsvm, id_set, text);
        }
        catch(std::exception&e)
        {
                context->last_error = e.what();
                HSVM_StringSetSTD(hsvm, id_set, "");
     //                HSVM_ReportCustomError(hsvm, e.what());
        }
}

/** RECORD HS_PDF_GetMetaInfo(INTEGER fileid)
    @param fileid ID of the open PDF file to use */
void HS_PDF_GetMetaInfo(HSVM *hsvm, HSVM_VariableId id_set)
{
        PDFContext *context = static_cast<PDFContext*>(HSVM_GetContext(hsvm,PDFContextId,true));

        int32_t conversionid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));

        PDFContext::PDFConversionPtr *ppc = context->conversionlist.Get(conversionid);
        try
        {
                if(!ppc)
                    throw std::runtime_error("Invalid PDF handle");

                (*ppc)->GetMetaInfo(id_set);
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(hsvm, e.what());
        }
}

/** RECORD ARRAY HS_PDF_GetTextItemsOnPage(INTEGER fileid, INTEGER pagenr)
    @param fileid ID of the open PDF file to use
    @param pagenr The page to get the textitems from */
void HS_PDF_GetTextItemsOnPage(HSVM *hsvm, HSVM_VariableId id_set)
{
        PDFContext *context = static_cast<PDFContext*>(HSVM_GetContext(hsvm,PDFContextId,true));

        int32_t conversionid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        int32_t pagenr = HSVM_IntegerGet(hsvm, HSVM_Arg(1));

        PDFContext::PDFConversionPtr *ppc = context->conversionlist.Get(conversionid);
        try
        {
                if(!ppc)
                    throw std::runtime_error("Invalid PDF handle");

                (*ppc)->GetTextItemsOnPage(pagenr, id_set);
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(hsvm, e.what());
        }
}

/** RECORD HS_PDF_GetNumberOfPages(INTEGER fileid)
    @param fileid ID of the open PDF file to use */
void HS_PDF_GetNumberOfPages(HSVM *hsvm, HSVM_VariableId id_set)
{
        PDFContext *context = static_cast<PDFContext*>(HSVM_GetContext(hsvm,PDFContextId,true));

        int32_t conversionid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));

        PDFContext::PDFConversionPtr *ppc = context->conversionlist.Get(conversionid);
        try
        {
                if(!ppc)
                    throw std::runtime_error("Invalid PDF handle");

                HSVM_IntegerSet(hsvm, id_set, (*ppc)->GetNumberOfPages());
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(hsvm, e.what());
        }
}

void HS_PDF_GetDocumentOutline(HSVM *hsvm, HSVM_VariableId id_set)
{
        PDFContext *context = static_cast<PDFContext*>(HSVM_GetContext(hsvm,PDFContextId,true));

        int32_t conversionid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));

        PDFContext::PDFConversionPtr *ppc = context->conversionlist.Get(conversionid);
        try
        {
                if(!ppc)
                    throw std::runtime_error("Invalid PDF handle");

                (*ppc)->GetOutlineItems(id_set);
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(hsvm, e.what());
        }
}

void HS_PDF_Write(HSVM *vm, HSVM_VariableId id_set)
{
        PDFContext *context = static_cast<PDFContext*>(HSVM_GetContext(vm,PDFContextId,true));
        int32_t conversionid = HSVM_IntegerGet(vm, HSVM_Arg(0));

        PDFContext::PDFConversionPtr *ppc = context->conversionlist.Get(conversionid);
        try
        {
                if(!ppc)
                    throw std::runtime_error("Invalid PDF handle");

                int32_t out = HSVM_CreateStream (vm);
                HareScript::Interface::OutputStream outstream(vm, out);
                (*ppc)->Write(outstream);
                HSVM_MakeBlobFromStream(vm, id_set, out);
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(vm, e.what());
        }

}

PDFContext::PDFContext()
{
}

PDFContext::~PDFContext()
{
}


}
}
}

//---------------------------------------------------------------------------
extern "C"
{

static void* CreateContext(void *)
{
        return new Parsers::Adobe::PDF::PDFContext;
}
static void DestroyContext(void*, void *context_ptr)
{
        delete static_cast<Parsers::Adobe::PDF::PDFContext*>(context_ptr);
}

int HSVM_ModuleEntryPoint(HSVM_RegData *regdata,void*)
{
        HSVM_RegisterFunction(regdata, "OPENPDFFILE:PARSER_ADOBE_PDF:I:X", Parsers::Adobe::PDF::HS_PDF_Open);
        HSVM_RegisterFunction(regdata, "DOPDFCONVERSION:PARSER_ADOBE_PDF:B:I", Parsers::Adobe::PDF::HS_PDF_Conversion);
        HSVM_RegisterFunction(regdata, "GETLASTPDFERROR:PARSER_ADOBE_PDF:S:", Parsers::Adobe::PDF::HS_PDF_GetLastError);
        HSVM_RegisterFunction(regdata, "GETTEXTONPDFPAGE:PARSER_ADOBE_PDF:S:II", Parsers::Adobe::PDF::HS_PDF_GetTextOnPage);
        HSVM_RegisterFunction(regdata, "GETTEXTITEMSONPDFPAGE:PARSER_ADOBE_PDF:RA:II", Parsers::Adobe::PDF::HS_PDF_GetTextItemsOnPage);
        HSVM_RegisterFunction(regdata, "GETNUMBEROFPDFPAGES:PARSER_ADOBE_PDF:I:I", Parsers::Adobe::PDF::HS_PDF_GetNumberOfPages);
        HSVM_RegisterFunction(regdata, "GETPDFDOCUMENTOUTLINE:PARSER_ADOBE_PDF:RA:I", Parsers::Adobe::PDF::HS_PDF_GetDocumentOutline);
        HSVM_RegisterFunction(regdata, "GETPDFMETAINFO:PARSER_ADOBE_PDF:R:I", Parsers::Adobe::PDF::HS_PDF_GetMetaInfo);
        HSVM_RegisterFunction(regdata, "WRITEPDFFILE:PARSER_ADOBE_PDF:X:I", Parsers::Adobe::PDF::HS_PDF_Write);

        HSVM_RegisterContext (regdata, Parsers::Adobe::PDF::PDFContextId, NULL, &CreateContext, &DestroyContext);
        return 1;
}

} //end extern "C"

/*
r:\final\runscript.exe
--moduledir R:\final --bindir R:\final X:/development/Parsers/PDF/pdf.whscr "X:/development/Parsers/PDF/PDF docs/wiley.pdf"

--moduledir R:\final --bindir R:\final modulescript::consilio/fetcher.whscr 11364 6

--config Q:\webhare\whtree\etc --moduledir R:\whbuild\bin --bindir R:\whbuild\bin "X:\data\Ontwikkeling\File formats\PDF\pdf.whscr" "C:/temp/council.pdf"

MINGW
/q/webhare/whtree/bin/runscript --moduledir /q/whbuild32/debug/bin --config /q/webhare/whtree/etc "/x/data/Ontwikkeling/file formats/PDF/pdf.whscr" /z/Desktop/temp/Toolkit_organiseren_MaS_markt.pdf

*/
