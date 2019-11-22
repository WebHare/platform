//---------------------------------------------------------------------------
#include <ap/libwebhare/allincludes.h>

//---------------------------------------------------------------------------

#include "excel.h"
#include <blex/utils.h>
#include <harescript/vm/hsvm_dllinterface.h>
#include <harescript/vm/hsvm_dllinterface_blex.h>

namespace Parsers {
namespace Office {
namespace Excel {

// -----------------------------------------------------------------------------
//
//   Context
//
//

void HS_EX_Open(HSVM *hsvm, HSVM_VariableId id_set)
{
        GlobalExcelContext *context = static_cast<GlobalExcelContext*>(HSVM_GetContext(hsvm,ExcelContextId,true));

        int32_t conversionid = 0;
        context->last_error = "";
        try
        {
                std::unique_ptr<Blex::Stream> input(new HareScript::Interface::InputStream(hsvm,HSVM_Arg(0)));
                // Create conversion with specified blob
                GlobalExcelContext::ExcelDocPtr thisconversion(new ExcelDoc(*input));
                conversionid = context->conversionlist.Set(thisconversion);
        }
        catch(std::exception &e)
        {
                context->last_error = e.what();
        }

        // Return conversionid
        HSVM_IntegerSet(hsvm, id_set, conversionid);
}

void HS_EX_GetAllLabelText(HSVM *hsvm, HSVM_VariableId id_set)
{
        GlobalExcelContext *context = static_cast<GlobalExcelContext*>(HSVM_GetContext(hsvm,ExcelContextId,true));

        int32_t conversionid = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        GlobalExcelContext::ExcelDocPtr *exceldoc = context->conversionlist.Get(conversionid);

        try
        {
                if (!exceldoc || !exceldoc->get())
                    throw std::runtime_error("Excel doc not found");
                HSVM_StringSetSTD(hsvm, id_set, (*exceldoc)->GetAllLabelText());
        }
        catch(std::exception &e)
        {
                context->last_error = e.what();
                HSVM_StringSetSTD(hsvm, id_set, "");
        }
}

void HS_EX_GetLastError(HSVM *hsvm, HSVM_VariableId id_set)
{
        GlobalExcelContext *context = static_cast<GlobalExcelContext*>(HSVM_GetContext(hsvm,ExcelContextId,true));
        HSVM_StringSetSTD(hsvm, id_set, context->last_error);
}

GlobalExcelContext::GlobalExcelContext()
{
}

GlobalExcelContext::~GlobalExcelContext()
{
}

} //end namespace Excel
} //end namespace Office
} //end namespace Parsers

//---------------------------------------------------------------------------
extern "C"
{

static void* CreateContext(void *)
{
        return new Parsers::Office::Excel::GlobalExcelContext;
}
static void DestroyContext(void*, void *context_ptr)
{
        delete static_cast<Parsers::Office::Excel::GlobalExcelContext*>(context_ptr);
}

int HSVM_ModuleEntryPoint(HSVM_RegData *regdata,void*)
{
        HSVM_RegisterFunction(regdata, "OPENEXCELFILE:PARSER_OFFICE_EXCEL:I:X", Parsers::Office::Excel::HS_EX_Open);
        HSVM_RegisterFunction(regdata, "GETALLEXCELLABELTEXT:PARSER_OFFICE_EXCEL:S:I", Parsers::Office::Excel::HS_EX_GetAllLabelText);
        HSVM_RegisterFunction(regdata, "GETLASTEXCELERROR:PARSER_OFFICE_EXCEL:S:", Parsers::Office::Excel::HS_EX_GetLastError);
        HSVM_RegisterContext (regdata, Parsers::Office::Excel::ExcelContextId, NULL, &CreateContext, &DestroyContext);
        return 1;
}

} //end extenr "C"

