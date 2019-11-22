#include <ap/libwebhare/allincludes.h>


#include <iomanip>
#include <numeric>
#include <blex/utils.h>
#include "writer.h"

namespace Parsers {
namespace Formats {
namespace XML {

////////////////////////////////////////////////////////////////////////////////
//
// HTML Output context
//
HtmlWriter *GetWriter(HSVM *vm, int32_t id)
{
        HtmlContext &context = *static_cast<HtmlContext*>(HSVM_GetContext(vm,HtmlContextId,true));
        if (id < 1 || unsigned(id) > context.htmlwriters.size() || context.htmlwriters[id-1].get() == NULL)
        {
                HSVM_ReportCustomError(vm, ("No such HTML context #" + Blex::AnyToString(id)).c_str());
                return NULL;
        }
        return context.htmlwriters[id-1].get();
}

void PUBLISHER_OUTPUT_HTML_Create(HSVM *vm, HSVM_VariableId id_set)
{
        HtmlContext &context = *static_cast<HtmlContext*>(HSVM_GetContext(vm,HtmlContextId,true));
        int32_t level = HSVM_IntegerGet(vm, HSVM_Arg(0));
        bool strict = HSVM_BooleanGet(vm, HSVM_Arg(1));
        bool external_stylesheet = HSVM_BooleanGet(vm, HSVM_Arg(2));
        bool cssclasses = HSVM_BooleanGet(vm, HSVM_Arg(3));

        context.htmlwriters.push_back(HtmlContext::HtmlWriterPtr(new HtmlWriter((StandardLevels)level,strict,external_stylesheet,cssclasses)));
        HSVM_IntegerSet(vm,id_set, context.htmlwriters.size());
}
void PUBLISHER_OUTPUT_HTML_Close(HSVM *vm)
{
        int32_t id = HSVM_IntegerGet(vm, HSVM_Arg(0));
        HtmlContext &context = *static_cast<HtmlContext*>(HSVM_GetContext(vm,HtmlContextId,true));
        if (id < 1 || unsigned(id) > context.htmlwriters.size() || context.htmlwriters[id-1].get() == NULL)
        {
                HSVM_ReportCustomError(vm, ("No such HTML context #" + Blex::AnyToString(id)).c_str());
                return;
        }
        context.htmlwriters[id-1]->CloseAllOutputs(vm);
        context.htmlwriters[id-1].reset();
}
void PUBLISHER_OUTPUT_HTML_CreateFormatter(HSVM *vm, HSVM_VariableId id_set)
{
        HtmlWriter *writer = GetWriter(vm, HSVM_IntegerGet(vm, HSVM_Arg(0)));
        if (!writer)
            return;

        int32_t outputid = HSVM_IntegerGet(vm, HSVM_Arg(1));
        HSVM_IntegerSet(vm,id_set, writer->CreateOutput(vm, outputid));
}
void PUBLISHER_OUTPUT_HTML_CloseFormatter(HSVM *vm)
{
        HtmlWriter *writer = GetWriter(vm, HSVM_IntegerGet(vm, HSVM_Arg(0)));
        if (!writer)
            return;

        writer->CloseOutput(vm, HSVM_IntegerGet(vm, HSVM_Arg(1)));
}

void  PUBLISHER_OUTPUT_HTML_SetTableSize(HSVM *vm)
{
        HtmlWriter *writer = GetWriter(vm, HSVM_IntegerGet(vm, HSVM_Arg(0)));
        if (!writer)
            return;

        int32_t width = HSVM_IntegerGet(vm, HSVM_Arg(1));
        writer->GetPreferences().tablewidth = width<0 ? 0 : Blex::Bound<unsigned>(100,100000,width);
        writer->GetPreferences().tablewidth_forced = HSVM_BooleanGet(vm, HSVM_Arg(2));
}

void  PUBLISHER_OUTPUT_HTML_SetHTMLBgcolor(HSVM *vm)
{
        HtmlWriter *writer = GetWriter(vm, HSVM_IntegerGet(vm, HSVM_Arg(0)));
        if (!writer)
            return;

        writer->GetPreferences().bgcolor = HStoDrawlibPixel(HSVM_IntegerGet(vm, HSVM_Arg(1)));
}

void  PUBLISHER_OUTPUT_HTML_SetLanguage(HSVM *vm)
{
        HtmlWriter *writer = GetWriter(vm, HSVM_IntegerGet(vm, HSVM_Arg(0)));
        if (!writer)
            return;

        writer->GetPreferences().languagecode = HSVM_StringGetSTD(vm, HSVM_Arg(1));
}

void  PUBLISHER_OUTPUT_HTML_SetRelativeFonts(HSVM *vm)
{
        HtmlWriter *writer = GetWriter(vm, HSVM_IntegerGet(vm, HSVM_Arg(0)));
        if (!writer)
            return;

        int32_t width = HSVM_IntegerGet(vm, HSVM_Arg(1));
        writer->GetPreferences().basefontsize=Blex::Bound<unsigned>(0,100,width);
}

void  PUBLISHER_OUTPUT_HTML_SetTableBorders(HSVM *vm)
{
        HtmlWriter *writer = GetWriter(vm, HSVM_IntegerGet(vm, HSVM_Arg(0)));
        if (!writer)
            return;

        writer->GetPreferences().borderwidth = HSVM_IntegerGet(vm, HSVM_Arg(1));
        writer->GetPreferences().borderwidth_forced = HSVM_BooleanGet(vm, HSVM_Arg(2));
        writer->GetPreferences().pretty_borders = !HSVM_BooleanGet(vm, HSVM_Arg(3));

        int32_t color = HSVM_IntegerGet(vm, HSVM_Arg(4));
        if (color < 0)
            writer->GetPreferences().tablebordercolor = DrawLib::Pixel32::MakeTransparent();
        else
            writer->GetPreferences().tablebordercolor = DrawLib::Pixel32(uint8_t(color >> 16),uint8_t(color >> 8),uint8_t(color >> 0), 255);
}

void  PUBLISHER_OUTPUT_HTML_PrintStylesheet(HSVM *vm)
{
        HtmlWriter *writer = GetWriter(vm, HSVM_IntegerGet(vm, HSVM_Arg(0)));
        if (!writer)
            return;

        int32_t outputid = HSVM_IntegerGet(vm, HSVM_Arg(1));
        writer->PrintStyleSheet(vm, outputid);
}

void  PUBLISHER_OUTPUT_HTML_SuppressLinkMarkup(HSVM *vm)
{
        HtmlWriter *writer = GetWriter(vm, HSVM_IntegerGet(vm, HSVM_Arg(0)));
        if (!writer)
            return;

        writer->GetPreferences().suppress_hyperlink_formatting = HSVM_BooleanGet(vm, HSVM_Arg(1));
}

static void* CreateContext(void *)
{
        return new HtmlContext;
}
static void DestroyContext(void*, void *context_ptr)
{
        delete static_cast<HtmlContext*>(context_ptr);
}

} //end namespace XML
} //end namespace Formats
} //end namespace Parsers

extern "C" {

int HSVM_ModuleEntryPoint(HSVM_RegData *regdata,void*)
{
        using namespace Parsers::Formats::XML;

        HSVM_RegisterContext (regdata, HtmlContextId, NULL, &CreateContext, &DestroyContext);
        HSVM_RegisterMacro(regdata, "SETHTMLDOCIMAGEBGCOLOR:PARSER_FORMAT_HTML::II",PUBLISHER_OUTPUT_HTML_SetHTMLBgcolor);
        HSVM_RegisterMacro(regdata, "SETHTMLDOCTABLESIZE:PARSER_FORMAT_HTML::IIB",PUBLISHER_OUTPUT_HTML_SetTableSize);
        HSVM_RegisterMacro(regdata, "SETHTMLDOCTABLEBORDERS:PARSER_FORMAT_HTML::IIBBI",PUBLISHER_OUTPUT_HTML_SetTableBorders);
        HSVM_RegisterMacro(regdata, "SETHTMLDOCRELATIVEFONTS:PARSER_FORMAT_HTML::II",PUBLISHER_OUTPUT_HTML_SetRelativeFonts);
        HSVM_RegisterMacro(regdata, "SETHTMLDOCLANGUAGECODE:PARSER_FORMAT_HTML::IS",PUBLISHER_OUTPUT_HTML_SetLanguage);
        HSVM_RegisterMacro(regdata, "SETHTMLDOCSUPPRESSLINKMARKUP:PARSER_FORMAT_HTML::IB",PUBLISHER_OUTPUT_HTML_SuppressLinkMarkup);
        HSVM_RegisterMacro(regdata, "PRINTHTMLDOCSTYLESHEET:PARSER_FORMAT_HTML::II",PUBLISHER_OUTPUT_HTML_PrintStylesheet);

        HSVM_RegisterFunction(regdata, "__PUBLISHER_OUTPUT_HTML_CREATE:PARSER_FORMAT_HTML:I:IBBB",PUBLISHER_OUTPUT_HTML_Create);
        HSVM_RegisterMacro(regdata, "__PUBLISHER_OUTPUT_HTML_CLOSE:PARSER_FORMAT_HTML::I",PUBLISHER_OUTPUT_HTML_Close);

        HSVM_RegisterFunction(regdata, "__PUBLISHER_OUTPUT_HTML_CREATEFORMATTER:PARSER_FORMAT_HTML:I:II",PUBLISHER_OUTPUT_HTML_CreateFormatter);
        HSVM_RegisterMacro(regdata, "__PUBLISHER_OUTPUT_HTML_CLOSEFORMATTER:PARSER_FORMAT_HTML::II",PUBLISHER_OUTPUT_HTML_CloseFormatter);
        return 1;
}

} //end extern "C"
