#include <ap/libwebhare/allincludes.h>


#include <blex/utils.h>
#include "parserinterface.h"
#include "filtering.h"
#include <stack>

namespace Parsers
{

///////////////////////////////////////////////////////////////////////////////
//
// Output management
//

OutputContext* GetOutputContext(HSVM *vm)
{
        OutputContext *context = static_cast<OutputContext*>(HSVM_GetContext(vm,OutputContextId,true));
        if (!context)
        {
                HSVM_GetModuleDynamicFunction(vm, "parser", "HSVM_ModuleEntryPoint"); //Make sure the parser framework is available
                context = static_cast<OutputContext*>(HSVM_GetContext(vm,OutputContextId,true));
                if (!context)
                {
                        HSVM_ReportCustomError(vm, "Unable to initialize the WebHare conversion framework");
                        return NULL;
                }
        }
        return context;
}

FormattedOutputPtr GetFormattedOutput(HSVM *vm, int32_t id)
{
        if(!vm)
            return FormattedOutputPtr();

        OutputContext *context = GetOutputContext(vm);
        if (!context || id < 1 || unsigned(id) > context->formattedoutputs.size() || context->formattedoutputs[id-1] == NULL)
        {
                HSVM_ReportCustomError(vm, ("No such formatted output #" + Blex::AnyToString(id)).c_str());
                return FormattedOutputPtr();
        }
        return context->formattedoutputs[id-1];
}

/*void UpdateId(FormattedOutput*output, HSVM *vm, int32_t newid)
{
        output->vm=vm;
        output->id=newid;
} */
int32_t RegisterFormattedOutput(HSVM *vm, FormattedOutputPtr const &myoutput)
{
        if(myoutput->vm)
        {
                HSVM_ReportCustomError(vm, ("Duplicate FormattedOutput registration for object #" + Blex::AnyToString(myoutput->registered_id)).c_str());
                return 0;
        }

        OutputContext *context = GetOutputContext(vm);

        if (!context)
             return 0; //GetOutputContext reports the error

        context->formattedoutputs.push_back(myoutput);
        int32_t id = context->formattedoutputs.size();

        myoutput->registered_id=id;
        myoutput->vm=vm;
        return id;
}
void UnregisterFormattedOutput(HSVM *vm, int32_t id)
{
        OutputContext *context = GetOutputContext(vm);
        if (!context || id < 1 || unsigned(id) > context->formattedoutputs.size() || context->formattedoutputs[id-1] == NULL)
        {
                HSVM_ReportCustomError(vm, ("No such formatted output #" + Blex::AnyToString(id)).c_str());
                return;
        }
//        UpdateId(context->formattedoutputs[id-1], vm, 0);
        context->formattedoutputs[id-1]->vm=NULL;
        context->formattedoutputs[id-1]->registered_id=0;
        context->formattedoutputs[id-1].reset();
}

OutputObjectInterface *GetOutputObject(HSVM *vm, int32_t id)
{
        OutputContext *context = GetOutputContext(vm);
        if(context)
        {
                OutputContext::OutputObjects::iterator itr = context->outputobjects.find(id);
                if(itr != context->outputobjects.end())
                {
                        return itr->second;
                }
        }
        HSVM_ReportCustomError(vm, ("No such output object#" + Blex::AnyToString(id)).c_str());
        return NULL;
}
int32_t RegisterOutputObject(HSVM *vm, OutputObjectInterface *myobject)
{
        OutputContext *context = GetOutputContext(vm);
        if (!context)
            return 0;

        //Reliable outputobjectid generation is important for our selftests.
        int32_t nextid;
        if(context->outputobjects.empty())
        {
                nextid=1;
        }
        else
        {
                OutputContext::OutputObjects::const_iterator itr = context->outputobjects.end();
                --itr;
                nextid = itr->first+1;
        }
        context->outputobjects.insert(std::make_pair(nextid,myobject));
        myobject->outputobjectid = nextid;
        return myobject->outputobjectid;
}
void UnregisterOutputObject(HSVM *vm, int32_t id)
{
        OutputContext *context = GetOutputContext(vm);
        if(context)
        {
                OutputContext::OutputObjects::iterator itr = context->outputobjects.find(id);
                if(itr != context->outputobjects.end())
                {
                        itr->second->outputobjectid = 0;
                        context->outputobjects.erase(itr);
                        return;
                }
        }
        HSVM_ReportCustomError(vm, ("No such output object#" + Blex::AnyToString(id)).c_str());
}
void PushPaintFunction(HSVM *vm, PaintFunction const &newpainter)
{
        OutputContext *context = GetOutputContext(vm);
        if (context)
            context->paintfunc.push(newpainter);
}
void PopPaintFunction(HSVM *vm)
{
        OutputContext *context = GetOutputContext(vm);
        if (!context || context->paintfunc.empty())
            HSVM_ReportCustomError(vm, "Trying to pop a paint function without any active paint function");
        else
            context->paintfunc.pop();
}

bool GetBooleanCell(HSVM *vm, HSVM_VariableId varid, const char *cellname)
{
        HSVM_VariableId cellid = HSVM_RecordGetRef(vm, varid, HSVM_GetColumnId(vm,cellname));
        if (!cellid)
        {
                HSVM_ReportCustomError(vm, (std::string("Cell ") + cellname + " missing").c_str());
                return false;
        }
        return HSVM_BooleanGet(vm, cellid);
}

void ReadFilter(HSVM *vm, HSVM_VariableId filter, StyleSettings *dest)
{
        dest->show_bullets_numbering = GetBooleanCell(vm, filter, "BULLETNUMBERING");
        dest->paragraph_formatting = GetBooleanCell(vm, filter, "PARAGRAPHFORMATTING");
        dest->texteffects = GetBooleanCell(vm, filter, "TEXTEFFECTS");
        dest->subsuper = GetBooleanCell(vm, filter, "SUBSUPER");
        dest->hyperlinks = GetBooleanCell(vm, filter, "HYPERLINKS");
        dest->anchors = GetBooleanCell(vm, filter, "ANCHORS");
        dest->images = GetBooleanCell(vm, filter, "IMAGES");
        dest->tables = GetBooleanCell(vm, filter, "TABLES");
        dest->softbreaks = GetBooleanCell(vm, filter, "SOFTBREAKS");
}

CustomOutputObject::CustomOutputObject(HSVM *_vm, HSVM_VariableId _obj)
: vm(_vm)
{
        obj = HSVM_AllocateVariable(vm);
        HSVM_CopyFrom(vm, obj, _obj);
}

CustomOutputObject::~CustomOutputObject()
{
        HSVM_DeallocateVariable(vm, obj);
}

void CustomOutputObject::Send(FormattedOutputPtr const &siteoutput) const
{
        int32_t formatid = siteoutput->GetRegisteredId();
        if(formatid==0)
            return; //ADDME: Also refuse if vm!=registered_vm ?

        HSVM_OpenFunctionCall(vm, 1);
        HSVM_IntegerSet(vm, HSVM_CallParam(vm, 0), formatid);
        HSVM_CallObjectMethod(vm, obj, HSVM_GetColumnId(vm, "SEND"), true, true);
        HSVM_CloseFunctionCall(vm);
}

std::string CustomOutputObject::GetAnchor() const
{
        std::string retval;
        HSVM_OpenFunctionCall(vm, 0);
        HSVM_VariableId hs_retval = HSVM_CallObjectMethod(vm, obj, HSVM_GetColumnId(vm, "GETANCHOR"), true, true);
        retval = HSVM_StringGetSTD(vm, hs_retval);
        HSVM_CloseFunctionCall(vm);
        return retval;
}

HSVM_VariableId ForceGet(HSVM *vm, HSVM_VariableId rec, std::string const &name)
{
        HSVM_ColumnId colid = HSVM_GetColumnId(vm, name.c_str());
        HSVM_VariableId varid = HSVM_RecordGetRef(vm, rec, colid);
        if (!varid)
            throw std::runtime_error("expected field " + name + " missing!");
        return varid;
}

void ParseFilters(HSVM *vm, HSVM_VariableId filters_varid, PublicationProfile *pubprof)
{
        for (unsigned i=0;i<HSVM_ArrayLength(vm, filters_varid);++i)
        {
                HSVM_VariableId current_filter = HSVM_ArrayGetRef(vm, filters_varid, i);

                StyleSettings newstyle;
                ParseFilter(vm,current_filter,&newstyle);

                int32_t wordid=HSVM_IntegerGet(vm,ForceGet(vm,current_filter,"WORDID"));
                std::string stylename;

                if (wordid==-1)
                    stylename=HSVM_StringGetSTD(vm, ForceGet(vm,current_filter,"NAME"));
                pubprof->AddFilter(wordid, stylename, newstyle);
        }
}

inline void SetSimpleBit(StyleSettings *stylesettings, int flagdata,uint32_t formatflag)
{
        if (flagdata==0)
            stylesettings->formatflags_and &= ~formatflag;
        else if (flagdata==1)
            stylesettings->formatflags_or |= formatflag;
}

void ParseFilter(HSVM *vm, HSVM_VariableId rec, StyleSettings *stylesettings)
{
        stylesettings->toclevel=HSVM_IntegerGet(vm, ForceGet(vm,rec,"TOCLEVEL"));
        stylesettings->split=HSVM_BooleanGet(vm, ForceGet(vm,rec,"SPLIT"));
        stylesettings->show_bullets_numbering=HSVM_BooleanGet(vm, ForceGet(vm,rec,"SHOWNUMBERING"));
        stylesettings->newfont.font_face=HSVM_StringGetSTD(vm, ForceGet(vm,rec,"FONTFACE"));
        stylesettings->fontsize=HSVM_IntegerGet(vm, ForceGet(vm,rec,"FONTSIZE"));

        int32_t dbase_fontcolor = HSVM_IntegerGet(vm, ForceGet(vm,rec,"FGCOLOUR"));
        if (dbase_fontcolor!= -1)
            stylesettings->fontcolor = DrawLib::Pixel32((uint8_t)(dbase_fontcolor >> 16),(uint8_t)(dbase_fontcolor >> 8),(uint8_t)(dbase_fontcolor),255
                );

        int32_t dbase_para_bgcolor = HSVM_IntegerGet(vm, ForceGet(vm,rec,"SETBGCOLOUR"));
        if (dbase_para_bgcolor != -1)
            stylesettings->para_bgcolor = DrawLib::Pixel32((uint8_t)(dbase_para_bgcolor>> 16),(uint8_t)(dbase_para_bgcolor>> 8),(uint8_t)(dbase_para_bgcolor), 255
                );

        stylesettings->vertspace_above=HSVM_IntegerGet(vm, ForceGet(vm,rec,"VERTSPACEBEFORE"));
        stylesettings->vertspace_below=HSVM_IntegerGet(vm, ForceGet(vm,rec,"VERTSPACEAFTER"));
        stylesettings->margin_left=HSVM_IntegerGet(vm, ForceGet(vm,rec,"LEFTINDENT"));
        stylesettings->margin_right=HSVM_IntegerGet(vm, ForceGet(vm,rec,"RIGHTINDENT"));
        stylesettings->margin_first=HSVM_IntegerGet(vm, ForceGet(vm,rec,"FIRSTINDENT"));
        stylesettings->horizalign=HSVM_IntegerGet(vm, ForceGet(vm,rec,"ALIGNMENT"));
        stylesettings->underlining=HSVM_IntegerGet(vm, ForceGet(vm,rec,"SETUNDERLINE"));
        stylesettings->hide_docobject=HSVM_BooleanGet(vm, ForceGet(vm,rec,"HIDEDOCOBJECT"));
        stylesettings->show_hidden_text=HSVM_BooleanGet(vm, ForceGet(vm,rec,"SHOWHIDDENTEXT"));
        stylesettings->tableheader=HSVM_BooleanGet(vm, ForceGet(vm,rec,"ISTABLEHEADER"));
        stylesettings->headinglevel=HSVM_IntegerGet(vm, ForceGet(vm,rec,"HEADINGLEVEL"));

        SetSimpleBit(stylesettings, HSVM_IntegerGet(vm, ForceGet(vm,rec,"SETBOLD")),Parsers::Character::Bold);
        SetSimpleBit(stylesettings, HSVM_IntegerGet(vm, ForceGet(vm,rec,"SETITALIC")),Parsers::Character::Italic);
        SetSimpleBit(stylesettings, HSVM_IntegerGet(vm, ForceGet(vm,rec,"SETSMALLCAPS")),Parsers::Character::Smallcaps);
}

} //end namespace Parsers
