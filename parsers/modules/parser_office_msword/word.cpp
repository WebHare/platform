#include <ap/libwebhare/allincludes.h>


#include "biff.h"
#include "word.h"
#include "word_output.h"
#include <parsers/base/parserinterface.h>
#include <harescript/vm/hsvm_dllinterface_blex.h>

namespace Parsers {
namespace Office {
namespace Word {

OpenDoc::OpenDoc(HSVM *vm)
: have_scanned_objects(false)
, note_callback_ptr(0)
, private_field_callback_ptr(0)
, vm(vm)
, objectlist(0)
{
}
OpenDoc::~OpenDoc()
{
}
int32_t OpenDoc::RegisterOutputObject(OutputObjectInterface *output_object, bool is_top_level, unsigned toclevel, bool filtersplit, bool allhidden)
{
        if(is_top_level && !objectlist)
            throw std::runtime_error("Received output objects while not ready to capture them");

        int32_t objid = Parsers::RegisterOutputObject(vm, output_object);
        registered_objects.push_back(objid);

        if(is_top_level)
        {
                HSVM_ColumnId col_id          = HSVM_GetColumnId(vm, "ID");
                HSVM_ColumnId col_toclevel    = HSVM_GetColumnId(vm, "TOCLEVEL");
                HSVM_ColumnId col_hidden      = HSVM_GetColumnId(vm, "HIDDEN");
                HSVM_ColumnId col_filtersplit = HSVM_GetColumnId(vm, "FILTERSPLIT");

                HSVM_VariableId newobj = HSVM_ArrayAppend(vm, this->objectlist);
                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, newobj, col_id), objid);
                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, newobj, col_toclevel), toclevel);
                HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, newobj, col_filtersplit), filtersplit);
                HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, newobj, col_hidden), allhidden);
        }
        return objid;
}
void OpenDoc::Close() //called for graceful closures
{
        for (std::vector<int32_t>::iterator itr=registered_objects.begin();itr!=registered_objects.end();++itr)
            Parsers::UnregisterOutputObject(vm, *itr);
        registered_objects.clear();

        if (note_callback_ptr)
        {
                HSVM_DeallocateVariable(vm, note_callback_ptr);
                note_callback_ptr=0;
        }
        if (private_field_callback_ptr)
        {
                HSVM_DeallocateVariable(vm, private_field_callback_ptr);
                private_field_callback_ptr=0;
        }
}

void OpenDoc::FoundFootEndNote(bool is_foot_note, DocPart const* /*begin*/, DocPart const* /*limit*/, FormattedOutput &output)
{
        if (!note_callback_ptr)// || output.GetId()==0)
            return;

        HSVM_OpenFunctionCall(vm, 1);
        HSVM_SetDefault  (vm, HSVM_CallParam(vm,0), HSVM_VAR_Record);

        HSVM_ColumnId col_formatid = HSVM_GetColumnId(vm, "FORMATID");
        HSVM_ColumnId col_type = HSVM_GetColumnId(vm, "TYPE");
        HSVM_ColumnId col_parserobjects = HSVM_GetColumnId(vm, "PARSEROBJECTS");

        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, HSVM_CallParam(vm,0), col_formatid), output.GetRegisteredId());
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, HSVM_CallParam(vm,0), col_type), is_foot_note?1:2);

        HSVM_VariableId objectlist = HSVM_RecordCreate(vm, HSVM_CallParam(vm,0), col_parserobjects);
        HSVM_SetDefault(vm, objectlist, HSVM_VAR_RecordArray);
//FIXME        OutputObjectsToRecordArray(objectlist, begin, limit);

        if (!HSVM_CallFunctionPtr(vm, note_callback_ptr, true))
            return;
        HSVM_CloseFunctionCall(vm);
}

void OpenDoc::PrivateFieldCallback(std::string const &data, FormattedOutput &output)
{
        if (!private_field_callback_ptr)// || output.GetId()==0)
            return;

        HSVM_OpenFunctionCall(vm, 2);

        HSVM_IntegerSet(vm, HSVM_CallParam(vm,0), output.GetRegisteredId());
        HSVM_StringSetSTD(vm, HSVM_CallParam(vm,1), data);

        if (!HSVM_CallFunctionPtr(vm, private_field_callback_ptr, true))
            return;
        HSVM_CloseFunctionCall(vm);
}

WordContext::WordContext()
{
}
WordContext::~WordContext()
{
}

int32_t WordContext::OpenWordDoc(HSVM *vm, std::shared_ptr<Blex::RandomStream> const &docdata)
{
        if (!docdata.get())
            return 0;

        OpenDocPtr newdoc(new OpenDoc(vm));
        newdoc->docdata = docdata;

        //Discover document type
        uint8_t test[8];
        if(docdata->Read(test,8) != 8)
            return 0;

        if(Blex::Docfile::IsDocfileSignature(test))
        {
                std::shared_ptr<Blex::Docfile> olearc;
                olearc.reset(new Blex::Docfile(*docdata));

                newdoc->worddoc_legacy.reset(new BiffDoc(opendocs.size()+1, olearc, olearc->GetRoot(), *newdoc));
                newdoc->worddoc_base = newdoc->worddoc_legacy.get();
        }
        else //FIXME: Test whether it is really a zip file
        {
                newdoc->worddoc_new.reset(new DocX::DocXDoc(opendocs.size()+1, docdata, *newdoc));
                newdoc->worddoc_base = newdoc->worddoc_new.get();
        }
        opendocs.push_back(newdoc);
        return opendocs.size();
}

void WordContext::CloseWordDoc(HSVM *, int32_t wordid)
{
        if (wordid<1 || (unsigned)wordid>opendocs.size() || !opendocs[wordid-1].get())
            throw std::runtime_error("No word document with that id");

        OpenDoc &doc=*opendocs[wordid-1];
        doc.Close();
        opendocs[wordid-1].reset();
}

void WordContext::IgnoreAllcaps(int32_t wordid, bool ignore)
{
        if (wordid<1 || static_cast<unsigned>(wordid)>opendocs.size() || !opendocs[wordid-1].get())
            throw std::runtime_error("No word document with that id");

        OpenDoc &doc=*opendocs[wordid-1];
        doc.worddoc_base->ignore_allcaps = ignore;
}

void WordContext::SetSymbolConversion(int32_t wordid, bool images)
{
        if (wordid<1 || static_cast<unsigned>(wordid)>opendocs.size() || !opendocs[wordid-1].get())
            throw std::runtime_error("No word document with that id");

        OpenDoc &doc=*opendocs[wordid-1];
        doc.worddoc_base->symbol_conversion_images = images;
}

void WordContext::SetNoteCallback(int32_t wordid, HSVM *vm, HSVM_VariableId fptr)
{
        if (wordid<1 || static_cast<unsigned>(wordid)>opendocs.size() || !opendocs[wordid-1].get())
            throw std::runtime_error("No word document with that id");

        OpenDoc &doc=*opendocs[wordid-1];

        //Seting a callback
        if (HSVM_FunctionPtrExists(vm, fptr))
        {
                if (doc.note_callback_ptr == 0)
                    doc.note_callback_ptr = HSVM_AllocateVariable(vm);
                HSVM_CopyFrom(vm, doc.note_callback_ptr, fptr);
        }
        else if(doc.note_callback_ptr != 0) //Resetting a callback
        {
                HSVM_DeallocateVariable(vm, doc.note_callback_ptr);
        }
}

void WordContext::SetPrivateFieldCallback(int32_t wordid, HSVM *vm, HSVM_VariableId fptr)
{
        if (wordid<1 || static_cast<unsigned>(wordid)>opendocs.size() || !opendocs[wordid-1].get())
            throw std::runtime_error("No word document with that id");

        OpenDoc &doc=*opendocs[wordid-1];

        //Seting a callback
        if (HSVM_FunctionPtrExists(vm, fptr))
        {
                if (doc.private_field_callback_ptr == 0)
                    doc.private_field_callback_ptr = HSVM_AllocateVariable(vm);
                HSVM_CopyFrom(vm, doc.private_field_callback_ptr, fptr);
        }
        else if(doc.note_callback_ptr != 0) //Resetting a callback
        {
                HSVM_DeallocateVariable(vm, doc.private_field_callback_ptr);
        }
}

void WordContext::ScanWordDoc(int32_t wordid, bool emptydocobjects, HSVM *vm, HSVM_VariableId id_set)
{
        HSVM_SetDefault  (vm, id_set, HSVM_VAR_Record);
        if (wordid<1 || static_cast<unsigned>(wordid)>opendocs.size() || !opendocs[wordid-1].get())
            throw std::runtime_error("No word document with that id");

        OpenDoc &doc=*opendocs[wordid-1];
        if (doc.have_scanned_objects)
            return; //already scanned..

        HSVM_BooleanSet(  vm, HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "DOCX")), doc.worddoc_new.get() != NULL);
        doc.objectlist = HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "PARSEROBJECTS"));
        HSVM_SetDefault(vm, doc.objectlist, HSVM_VAR_RecordArray);

        ParseFilters(vm,HSVM_Arg(2),&doc.pubprof);
        std::pair<unsigned, std::string> result = doc.worddoc_base->Scan(emptydocobjects, doc.pubprof);

        HSVM_IntegerSet  (vm, HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "ERRORCODE")), result.first);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "ERRORMSG")),  result.second);

        doc.have_scanned_objects=true;
        doc.objectlist = 0;
}

} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers

//---------------------------------------------------------------------------
extern "C"
{
// HareScript/C interface to our C++ DrawLib interface. The functions here
// should only bother about converting HareScript parameters/returnvalues to
// C++ parameters

/* the OPEN_WRAPPER macro sets up the catching of C++ exceptions, and places our
   context into a 'context' structure */
#define OPEN_WRAPPER                    \
try {                                   \
Parsers::Office::Word::WordContext *context = static_cast<Parsers::Office::Word::WordContext *>(HSVM_GetContext(vm,Parsers::Office::Word::WordContextId, true));

/* the CLOSE_WRAPPER macro closes the above catch block and translates any C++ exceptions to
   HareScript errors */
#define CLOSE_WRAPPER                   \
} catch(std::exception &e) {            \
        HSVM_ReportCustomError(vm, e.what());   \
}

//ADDME: An extended open function that allows you to grab the actual error and set all open flags at once ?

void POW_Open (HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER
        std::shared_ptr<Blex::RandomStream> wordstream;
        wordstream.reset(new HareScript::Interface::InputStream(vm, HSVM_Arg(0)));
        try
        {
                HSVM_IntegerSet(vm, id_set, context->OpenWordDoc(vm, wordstream));
        }
        catch(std::exception &e)
        {
                DEBUGPRINT("Open exception: " << e.what());
                HSVM_IntegerSet(vm, id_set, 0);
        }
        CLOSE_WRAPPER
}

void POW_Scan (HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER
        int32_t docid = HSVM_IntegerGet(vm,HSVM_Arg(0));
        bool emptydocobjects = HSVM_BooleanGet(vm,HSVM_Arg(1));
        context->ScanWordDoc(docid, emptydocobjects, vm, id_set);
        CLOSE_WRAPPER
}

void POW_Close (HSVM *vm)
{
        OPEN_WRAPPER
        int32_t docid = HSVM_IntegerGet(vm,HSVM_Arg(0));
        context->CloseWordDoc(vm, docid);
        CLOSE_WRAPPER
}

void POW_SetSymbolConversion(HSVM *vm)
{
        OPEN_WRAPPER
        int32_t docid = HSVM_IntegerGet(vm,HSVM_Arg(0));
        bool images = HSVM_BooleanGet(vm,HSVM_Arg(1));
        context->SetSymbolConversion(docid,images);
        CLOSE_WRAPPER
}

void POW_IgnoreAllcaps (HSVM *vm)
{
        OPEN_WRAPPER
        int32_t docid = HSVM_IntegerGet(vm,HSVM_Arg(0));
        bool ignore = HSVM_BooleanGet(vm,HSVM_Arg(1));
        context->IgnoreAllcaps(docid,ignore);
        CLOSE_WRAPPER
}

void POW_NoteCallback (HSVM *vm)
{
        OPEN_WRAPPER
        int32_t docid = HSVM_IntegerGet(vm,HSVM_Arg(0));
        context->SetNoteCallback(docid, vm, HSVM_Arg(1));
        CLOSE_WRAPPER
}
void POW_PrivateFieldCallback (HSVM *vm)
{
        OPEN_WRAPPER
        int32_t docid = HSVM_IntegerGet(vm,HSVM_Arg(0));
        context->SetPrivateFieldCallback(docid, vm, HSVM_Arg(1));
        CLOSE_WRAPPER
}

static void* CreateContext(void *)
{
        return new Parsers::Office::Word::WordContext;
}
static void DestroyContext(void*, void *context_ptr)
{
        delete static_cast<Parsers::Office::Word::WordContext*>(context_ptr);
}

int HSVM_ModuleEntryPoint(HSVM_RegData *regdata,void*)
{
        HSVM_RegisterFunction(regdata, "OPENMSWORDDOCUMENT:PARSER_OFFICE_MSWORD:I:X", POW_Open);
        HSVM_RegisterMacro   (regdata, "CLOSEMSWORDDOCUMENT:PARSER_OFFICE_MSWORD::I", POW_Close);
        HSVM_RegisterFunction(regdata, "SCANMSWORDDOCUMENT:PARSER_OFFICE_MSWORD:R:IBRA", POW_Scan);
        HSVM_RegisterMacro   (regdata, "SETMSWORDDOCUMENTIGNOREALLCAPS:PARSER_OFFICE_MSWORD::IB", POW_IgnoreAllcaps);
        HSVM_RegisterMacro   (regdata, "__SETMSWORDNOTECALLBACK:PARSER_OFFICE_MSWORD::IP", POW_NoteCallback);
        HSVM_RegisterMacro   (regdata, "__SETMSWORDPRIVATEFIELDCALLBACK:PARSER_OFFICE_MSWORD::IP", POW_PrivateFieldCallback);
        HSVM_RegisterMacro   (regdata, "SETMSWORDSYMBOLCONVERSION:PARSER_OFFICE_MSWORD::IB", POW_SetSymbolConversion);
        HSVM_RegisterContext (regdata, Parsers::Office::Word::WordContextId, NULL, &CreateContext, &DestroyContext);
        return 1;
}

} //end extern "C"

/* example command lines
   r:\final\runscript.exe
   --workerthreads 2 --moduledir R:/whbuild/bin --config Q:/webhare/whtree/etc/webhare-config.xml modulescript::beta/createhsxml.whscr M:\beta\test\parsers\msword\ubertest.doc

   r:\final\runscript.exe
   with
   --workerthreads 2 --moduledir R:/whbuild/bin --config Q:/webhare/whtree/etc/webhare-config.xml modulescript::publisher/internal/publishing.whscr 13896


   tests:
   --workerthreads 2 --moduledir R:/whbuild/bin --config Q:/webhare/whtree/etc/webhare-config.xml q:/webhare/whtree/modules/beta/test/parsers/msword/wordtest.whlib q:/webhare/whtree/tmp/

*/
