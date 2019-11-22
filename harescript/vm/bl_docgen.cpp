#include <harescript/vm/allincludes.h>


#include <harescript/vm/hsvm_dllinterface.h>
#include <harescript/vm/hs_lexer.h>

namespace HareScript
{
namespace Docgen
{
const unsigned ContextId = 14; //DocGen context id

struct DocGenOpenFile
{
        DocGenOpenFile();
        HareScript::ErrorHandler dummy;
        HareScript::Lexer lexer;
        std::vector<char> filedata;
        const char *rawtokenstart;
};
DocGenOpenFile::DocGenOpenFile()
: lexer(&dummy)
{
}

typedef std::shared_ptr<DocGenOpenFile> DocGenOpenFilePtr;

/** Docgen context data */
struct DocgenContext
{
        std::vector< DocGenOpenFilePtr > openfiles;
};

void OpenHareScriptFile(HSVM *vm, HSVM_VariableId id_set)
{
        DocgenContext *context = static_cast<DocgenContext*>(HSVM_GetContext(vm, ContextId, true));

        //Load the file and set up the lexer
        DocGenOpenFilePtr newfile(new DocGenOpenFile);
        int blobhandle = HSVM_BlobOpen(vm, HSVM_Arg(0));
        int bloblength = HSVM_BlobLength(vm, HSVM_Arg(0));
        newfile->filedata.resize(bloblength+1,0); //add space for '0' byte

        if (HSVM_BlobRead(vm, blobhandle, bloblength, &newfile->filedata[0]) != bloblength)
        {
                HSVM_ReportCustomError(vm, "I/O error reading library");
                return;
        }
        HSVM_BlobClose(vm, blobhandle);

        newfile->lexer.StartLexer(reinterpret_cast<uint8_t*>(&newfile->filedata[0]),newfile->filedata.size()-1);
        newfile->rawtokenstart = &newfile->filedata[0];
        newfile->lexer.MovetoNextToken();

        //Create a handle
        context->openfiles.push_back(newfile);
        HSVM_IntegerSet(vm, id_set, context->openfiles.size());
}
void GetHareScriptFileToken(HSVM *vm, HSVM_VariableId id_set)
{
        DocgenContext *context = static_cast<DocgenContext*>(HSVM_GetContext(vm, ContextId, true));
        int32_t id = HSVM_IntegerGet(vm, HSVM_Arg(0));
        HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);

        if (id<=0 || id > static_cast< int32_t >(context->openfiles.size()) || !context->openfiles[id-1].get())
            return;

        DocGenOpenFile &file = *context->openfiles[id-1];

        /* The lexer only returns non-whitespace tokens. The space between the last token limit and the current token start
           is whitespace. So, if the limit and start are not equal, return the characters in between as whitespace.

           file.rawtokenstart is the expected start of the current token (when no whitespace would be present).
        */
        //Get the token
        bool is_whitespace = file.rawtokenstart != file.lexer.RawTokenData();
        const char *rawtokenlimit = is_whitespace ? file.lexer.RawTokenData() : file.lexer.RawTokenData() + file.lexer.RawTokenLength();

        if (file.lexer.GetToken() == Lexer::Eof && !is_whitespace)
            return;

        Blex::Lexer::LineColumn position = is_whitespace ? file.lexer.GetWhitespacePosition() : file.lexer.GetPosition();

        HSVM_VariableId col_rawtoken       = HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "RAWTOKEN"));
        HSVM_VariableId col_token          = HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "TOKEN"));
        HSVM_VariableId col_iswhitespace   = HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "ISWHITESPACE"));
        HSVM_VariableId col_istype         = HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "ISTYPE"));
        HSVM_VariableId col_isexternaldata = HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "ISEXTERNALDATA"));
        HSVM_VariableId col_line           = HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "LINE"));
        HSVM_VariableId col_col            = HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "COL"));

        HSVM_StringSet (vm, col_rawtoken,       file.rawtokenstart, rawtokenlimit);
        if (is_whitespace)
            HSVM_StringSet (vm, col_token,          file.rawtokenstart, rawtokenlimit);
        else
            HSVM_StringSetSTD(vm, col_token,        file.lexer.GetTokenSTLString());
        HSVM_BooleanSet(vm, col_istype,         !is_whitespace && file.lexer.IsTokenVarType());
        HSVM_BooleanSet(vm, col_iswhitespace,   is_whitespace);
        HSVM_BooleanSet(vm, col_isexternaldata, !is_whitespace && file.lexer.GetToken()==Lexer::ExternalData);
        HSVM_IntegerSet(vm, col_line,           position.line);
        HSVM_IntegerSet(vm, col_col,            position.column);

        file.rawtokenstart = rawtokenlimit;
        if(!is_whitespace)
            file.lexer.MovetoNextToken();
}
void CloseHareScriptFile(HSVM *vm)
{
        DocgenContext *context = static_cast<DocgenContext*>(HSVM_GetContext(vm, ContextId, true));
        int32_t id = HSVM_IntegerGet(vm, HSVM_Arg(0));

        if (id>0 && id <= static_cast< int32_t >(context->openfiles.size()))
            context->openfiles[id-1].reset();
}

} //end namespace Docgen

static void* CreateContext(void *)
{
        return new HareScript::Docgen::DocgenContext;
}
static void DestroyContext(void*, void *context_ptr)
{
        delete static_cast<HareScript::Docgen::DocgenContext*>(context_ptr);
}

int DocgenEntryPoint(HSVM_RegData *regdata,void*)
{
        HSVM_RegisterFunction(regdata, "OPENHARESCRIPTFILE::I:X", HareScript::Docgen::OpenHareScriptFile);
        HSVM_RegisterFunction(regdata, "GETHARESCRIPTFILETOKEN::R:I", HareScript::Docgen::GetHareScriptFileToken);
        HSVM_RegisterMacro   (regdata, "CLOSEHARESCRIPTFILE:::I", HareScript::Docgen::CloseHareScriptFile);

        HSVM_RegisterContext (regdata, HareScript::Docgen::ContextId, NULL, &CreateContext, &DestroyContext);
        return 0;
}

} //end namespace HareScript

