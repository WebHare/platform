//---------------------------------------------------------------------------
#include <ap/libwebhare/allincludes.h>


//---------------------------------------------------------------------------

#include "powerpoint.h"
#include <blex/utils.h>
#include <harescript/vm/hsvm_dllinterface.h>
#include <harescript/vm/hsvm_context.h>

namespace Parsers
{

namespace Office
{

namespace Powerpoint
{

// -----------------------------------------------------------------------------
//
//   Context
//
//

/** INTEGER HS_PP_Open(BLOB filedata)
    @param filename Name of the powerpoint file to open */
void HS_PP_Open(HSVM *hsvm, HSVM_VariableId id_set)
{
        PPointContext *context = static_cast<PPointContext*>(HSVM_GetContext(hsvm,PPointContextId,true));

        try
        {
                // Create conversion with specified blob
                std::shared_ptr<PowerpointConversion> thisconversion(new PowerpointConversion(hsvm,HSVM_Arg(0)));
                int32_t conversionid = context->conversionlist.Set(HareScript::GetVirtualMachine(hsvm), thisconversion);

                // Return conversionid
                HSVM_IntegerSet(hsvm, id_set, conversionid);
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(hsvm, e.what());
        }


}

/** INTEGER HS_PP_Open(BLOB filedata)
    @param filename Name of the powerpoint file to open */
void HS_PP_Conversion(HSVM *hsvm, HSVM_VariableId id_set)
{
        PPointContext *context = static_cast<PPointContext*>(HSVM_GetContext(hsvm,PPointContextId,true));

        int32_t conversionid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));

        PPointContext::PowerpointConversionPtr *ppc = context->conversionlist.Get(conversionid);

        try
        {
                (*ppc)->DecodeFile();
        }
        catch(std::exception&e)
        {
                HSVM_ReportCustomError(hsvm, e.what());
        }


        // Return Something
        HSVM_BooleanSet(hsvm, id_set, 1);
}

/** INTEGER ARRAY HS_PP_GetSlideList(INTEGER id)
    @param id ID of the powerpoint file to get the slides from */
void HS_PP_GetSlideList(HSVM *hsvm, HSVM_VariableId id_set)
{
        PPointContext *context = static_cast<PPointContext*>(HSVM_GetContext(hsvm,PPointContextId,true));

        int32_t conversionid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));

        PPointContext::PowerpointConversionPtr *ppc = context->conversionlist.Get(conversionid);
        if (ppc == NULL)
        {
                HSVM_ReportCustomError(hsvm, "Referencing an unopened powerpoint document");
                return;
        }

        try
        {
                (*ppc)->GetSlideList(id_set);
        }
        catch(std::exception&e)
        {
                HSVM_ReportCustomError(hsvm, e.what());
        }
}

/** RECORD ARRAY HS_PP_GetSlideTexts(INTEGER id, INTEGER slideid)
    @param id ID of the powerpoint file to use
    @param slideid ID of slide to get the texts from */
void HS_PP_GetSlideTexts(HSVM *hsvm, HSVM_VariableId id_set)
{
        PPointContext *context = static_cast<PPointContext*>(HSVM_GetContext(hsvm,PPointContextId,true));

        int32_t conversionid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        uint32_t slideid = HSVM_IntegerGet(hsvm, HSVM_Arg(1));

        PPointContext::PowerpointConversionPtr *ppc = context->conversionlist.Get(conversionid);
        if (ppc == NULL)
        {
                HSVM_ReportCustomError(hsvm, "Referencing an unopened powerpoint document");
                return;
        }

        try
        {
                (*ppc)->GetSlideTexts(slideid, id_set);
        }
        catch(std::exception&e)
        {
                HSVM_ReportCustomError(hsvm, e.what());
        }
}

/** RECORD ARRAY HS_PP_GetCustomShows(INTEGER id)
    @param id ID of the powerpoint file to get the custom shows from */
void HS_PP_GetCustomShows(HSVM *hsvm, HSVM_VariableId id_set)
{
        PPointContext *context = static_cast<PPointContext*>(HSVM_GetContext(hsvm,PPointContextId,true));

        int32_t conversionid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));

        PPointContext::PowerpointConversionPtr *ppc = context->conversionlist.Get(conversionid);
        if (ppc == NULL)
        {
                HSVM_ReportCustomError(hsvm, "Referencing an unopened powerpoint document");
                return;
        }

        try
        {
                (*ppc)->GetCustomShows(id_set);
        }
        catch(std::exception&e)
        {
                HSVM_ReportCustomError(hsvm, e.what());
        }
}

extern "C" {
        typedef DrawLib::BitmapInterface* (*GetCanvasBitmapFunc)(HSVM *, int32_t);
}

/** MACRO HS_PP_RenderSlide(INTEGER slidenr, INTEGER canvasid)
    @param id ID of the powerpoint file to use
    @param slideid ID of the slide to render
    @param canvasid ID of the canvas to render to */
void HS_PP_RenderSlide(HSVM *hsvm)
{
        PPointContext *context = static_cast<PPointContext*>(HSVM_GetContext(hsvm,PPointContextId,true));

        int32_t conversionid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        int32_t slideid = HSVM_IntegerGet(hsvm, HSVM_Arg(1));
        int32_t canvasid = HSVM_IntegerGet(hsvm, HSVM_Arg(2));

        // Get the canvas exporting function
        Blex::DynamicFunction exportfunc = HSVM_GetModuleDynamicFunction(hsvm, "whmod_graphics", "HSDRAWLIBINTERFACE_GetCanvasBitmap");
        if (!exportfunc)
           HSVM_ReportCustomError(hsvm, "Unable to find the bitmap hook in the hsm_whmod_graphics module");

        //We've found the exporting module! Get the canvas
        GetCanvasBitmapFunc bitmapfunc = reinterpret_cast<GetCanvasBitmapFunc>(exportfunc);
        DrawLib::BitmapInterface *bitmap = (*bitmapfunc)(hsvm,canvasid);
        if (!bitmap)
           HSVM_ReportCustomError(hsvm, "No such canvas");

        PPointContext::PowerpointConversionPtr *ppc = context->conversionlist.Get(conversionid);
        if (ppc == NULL)
        {
                HSVM_ReportCustomError(hsvm, "Referencing an unopened powerpoint document");
                return;
        }

        try
        {
                (*ppc)->RenderSlide(slideid, *bitmap);
        }
        catch(std::exception&e)
        {
                HSVM_ReportCustomError(hsvm, e.what());
        }
}

/** MACRO HS_PP_RenderNotes(INTEGER slideid, INTEGER canvasid)
    @param id ID of the powerpoint file to use
    @param slideid ID of the slide to render the notes from
    @param canvasid ID of the canvas to render to */
void HS_PP_RenderNotes(HSVM *hsvm)
{
        PPointContext *context = static_cast<PPointContext*>(HSVM_GetContext(hsvm,PPointContextId,true));

        int32_t conversionid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        int32_t slideid = HSVM_IntegerGet(hsvm, HSVM_Arg(1));
        int32_t canvasid = HSVM_IntegerGet(hsvm, HSVM_Arg(2));

        // Get the canvas exporting function
        Blex::DynamicFunction exportfunc = HSVM_GetModuleDynamicFunction(hsvm, "whmod_graphics", "HSDRAWLIBINTERFACE_GetCanvasBitmap");
        if (!exportfunc)
           HSVM_ReportCustomError(hsvm, "Unable to find the bitmap hook in the hsm_whmod_graphics module");

        //We've found the exporting module! Get the canvas
        GetCanvasBitmapFunc bitmapfunc = reinterpret_cast<GetCanvasBitmapFunc>(exportfunc);
        DrawLib::BitmapInterface *bitmap = (*bitmapfunc)(hsvm,canvasid);
        if (!bitmap)
           HSVM_ReportCustomError(hsvm, "No such canvas");

        PPointContext::PowerpointConversionPtr *ppc = context->conversionlist.Get(conversionid);
        if (ppc == NULL)
        {
                HSVM_ReportCustomError(hsvm, "Referencing an unopened powerpoint document");
                return;
        }

        try
        {
                (*ppc)->RenderNotes(slideid, *bitmap);
        }
        catch(std::exception&e)
        {
                HSVM_ReportCustomError(hsvm, e.what());
        }
}

PPointContext::PPointContext()
: conversionlist("Powerpoint conversion")
{
}

PPointContext::~PPointContext()
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
        return new Parsers::Office::Powerpoint::PPointContext;
}
static void DestroyContext(void*, void *context_ptr)
{
        delete static_cast<Parsers::Office::Powerpoint::PPointContext*>(context_ptr);
}

int HSVM_ModuleEntryPoint(HSVM_RegData *regdata,void*)
{
        HSVM_RegisterFunction(regdata, "OPENPOWERPOINTFILE:PARSER_OFFICE_POWERPOINT:I:X", Parsers::Office::Powerpoint::HS_PP_Open);
        HSVM_RegisterFunction(regdata, "DOPOWERPOINTCONVERSION:PARSER_OFFICE_POWERPOINT:B:I", Parsers::Office::Powerpoint::HS_PP_Conversion);
        HSVM_RegisterFunction(regdata, "GETPOWERPOINTSLIDELIST:PARSER_OFFICE_POWERPOINT:IA:I", Parsers::Office::Powerpoint::HS_PP_GetSlideList);
        HSVM_RegisterFunction(regdata, "GETPOWERPOINTSLIDETEXTS:PARSER_OFFICE_POWERPOINT:RA:II", Parsers::Office::Powerpoint::HS_PP_GetSlideTexts);
        HSVM_RegisterFunction(regdata, "GETPOWERPOINTCUSTOMSHOWS:PARSER_OFFICE_POWERPOINT:RA:I", Parsers::Office::Powerpoint::HS_PP_GetCustomShows);
        HSVM_RegisterMacro(regdata, "RENDERPOWERPOINTSLIDE:PARSER_OFFICE_POWERPOINT::III", Parsers::Office::Powerpoint::HS_PP_RenderSlide);
        HSVM_RegisterMacro(regdata, "RENDERPOWERPOINTNOTES:PARSER_OFFICE_POWERPOINT::III", Parsers::Office::Powerpoint::HS_PP_RenderNotes);

        HSVM_RegisterContext (regdata, Parsers::Office::Powerpoint::PPointContextId, NULL, &CreateContext, &DestroyContext);
        return 1;
}

} //end extenr "C"
