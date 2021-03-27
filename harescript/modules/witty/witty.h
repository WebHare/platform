#ifndef harescript_modules_wte_wte_provider
#define harescript_modules_wte_wte_provider

#include <blex/context.h>
#include <harescript/vm/hsvm_dllinterface.h>
#include <harescript/vm/hsvm_idmapstorage.h>

namespace HareScript
{
namespace Witty
{
struct Context;
struct ParsedFile;
struct WittyExecutionState;
const unsigned ContextId = 13; //our official registered Witty context id

enum Commands
{
        C_If,
        C_Else,
        C_ElseIf,
        C_EndIf,
        C_Forevery,
        C_EndForevery,
        C_Repeat,
        C_EndRepeat,
        C_Component,
        C_EndComponent,
        C_RawComponent,
        C_EndRawComponent,
        C_Embed,
        C_GetTid,
        C_GetHtmlTid,
        C_NotACommand,
        C_InvalidClosingTag
};

enum DataType
{
        DT_First,
        DT_Last,
        DT_Odd,
        DT_Even,
        DT_Seqnr,
        DT_Cell
};

enum ParserStates
{
        PS_Text,      //parsing text (ES_Text document)
        PS_Content,   //parsing content
        PS_Tag,       //parsing a tag
        PS_TagSquote, //parsing a tag, inside a single quote
        PS_TagDquote, //parsing a tag, inside a double quote
        PS_RawComponent
};

enum EncodingStyles
{
        ES_Invalid,
        ES_Text,
        ES_HTML,
        ES_XML
};

struct Encoding
{
        EncodingStyles style;
        bool noindent;
};

enum ContentEncoding
{
        CE_Invalid,
        CE_None,
        CE_Url,
        CE_Html,
        CE_Value,
        CE_Java,
        CE_Base16,
        CE_Base64,
        CE_CData,
        CE_JsonValue,
        CE_Json
};

struct StackElement;

struct ParsedPart
{
        enum Type
        {
                Content,
                Data,
                Forevery,
                If,
                ElseIf,
                Component,
                Embed,
                GetTid,
                GetHtmlTid,
                Repeat
        };

        ParsedPart(unsigned line, unsigned col, Type _type)
        : linenum(line)
        , columnnum(col)
        , type(_type)
        , datatype(DT_Cell)
        , cmd_limit(0)
        , else_limit(0)
        , content_pos(0)
        , content_len(0)
        , ifnot(false)
        {
        }

        unsigned linenum;
        unsigned columnnum;
        Type type;
        DataType datatype;
        ContentEncoding encoding;
        std::string content;
        unsigned cmd_limit;
        unsigned else_limit;
        unsigned content_pos;
        unsigned content_len;
        bool ifnot;
        std::vector< std::string > parameters;

//        bool PrintCell(WittyExecutionState *wes, HSVM_VariableId var) const;

        bool SM_FinishPrintCellCall(WittyExecutionState *wes) const;
        std::pair< bool/*finished*/, bool/*success*/ > SM_PrintCell(WittyExecutionState *wes, StackElement &elt, HSVM_VariableId var, std::function< void(bool) > const &reschedule) const;

        std::pair< bool/*finished*/, bool/*success*/ > SM_Embed(WittyExecutionState *wes, StackElement &elt, std::function< void(bool) > const &reschedule) const;

        void GetWittyData(HSVM_VariableId store, WittyExecutionState *wes, HSVM_VariableId var) const;
};

struct ParsedFile
{
        ParsedFile(std::string const &gettidmodule, EncodingStyles es);
        ~ParsedFile();

        typedef std::deque<ParsedPart> Parts;
        typedef Parts::const_iterator PartItr;
        typedef std::map<std::string, unsigned> Components;

        EncodingStyles const es;
        int32_t scriptid;
        Parts parts;
        ///Store global printable data. (ADDME: Performs poorly when resizing, but the original content std::string is even worse)
        std::vector<char> printdata;
        std::stack<ParsedPart*> blockstack;
        Components start_positions;
        std::string const gettidmodule;

        void AddContentChar(unsigned linenum, unsigned columnnum, uint8_t ch)
        {
                if (parts.back().type != ParsedPart::Content)
                    parts.push_back(ParsedPart(linenum, columnnum, ParsedPart::Content));

                if (parts.back().content_len == 0)
                {
                    parts.back().content_pos=printdata.size();
                    parts.back().linenum = linenum;
                    parts.back().columnnum = columnnum;
                }

                ++parts.back().content_len;
                printdata.push_back(ch);
        }

        bool ParseParameter(unsigned linenum, unsigned columnnum, const char *last_end, const char *limit, std::string *data, DataType *datatype, const char **param_end, bool stop_at_colon, bool require);
        bool ParseEncoding(unsigned linenum, unsigned columnnum, const char *last_end, const char *limit, ContentEncoding *encoding, const char **param_end);

        void AddInstruction(unsigned linenum, unsigned columnnum, char const *start, char const *limit, ContentEncoding suggested_encoding, ParserStates *state);

        bool Run(WittyExecutionState *wes, PartItr begin, PartItr limit) const;
        bool RunComponent(unsigned linenum, unsigned columnnum, WittyExecutionState *wes, std::string const &component) const;
        bool ExecuteIf(WittyExecutionState *wes, PartItr itr, HSVM_VariableId var) const;

        void SM_Push(WittyExecutionState *wes, bool new_invocation, ParsedFile::PartItr itr, ParsedFile::PartItr limit, HSVM_VariableId var, bool copy_var, ParsedPart const *forevery_nonra);
        void SM_PushComponent(unsigned linenum, unsigned columnnum, WittyExecutionState *wes, bool new_invocation, std::string const &componentname);
        bool SM_FinishGetTidCall(WittyExecutionState *wes, HSVM_VariableId retval);
        bool SM_EvaluateIf(HSVM *hsvm, WittyExecutionState *wes, HSVM_VariableId varid) const;
        std::pair< bool/*finished*/, bool/*success*/ > SM_Run(WittyExecutionState *wes, std::function< void(bool) > const &reschedule);
        bool SM_ScheduleRunComponent(unsigned linenum, unsigned columnnum, WittyExecutionState *wes, std::string const &componentname, HSVM_VariableId var);

        void EnumerateCells(HSVM *vm, HSVM_VariableId var);
};

/** Base class of continuation function call. Might want to refactor to std::function in the far future, used
    this because BCB horribly miscompiled calls to the continuation function. Borland sucks.
*/
struct SM_Continuation
{
        inline SM_Continuation() {}
        virtual ~SM_Continuation();
        virtual bool Execute() = 0;
};

struct StackElement
{
        StackElement() : iv_depth(0), has_variable(false), var_is_alloced(false), must_return(false), forevery_elt_nr(-1), forevery_elt_limit(-1) { }

        unsigned iv_depth;
        ParsedFile::PartItr itr;
        ParsedFile::PartItr limit;
        bool has_variable;
        bool var_is_alloced;
        bool must_return;

        signed forevery_elt_nr;
        signed forevery_elt_limit;

        std::shared_ptr< SM_Continuation > continuation;
};

struct VarStackElement
{
        VarStackElement() : forevery_nonra(NULL)
        {
        }
        VarStackElement(ParsedPart const *forevery_nonra, HSVM_VariableId var)
        : forevery_nonra(forevery_nonra)
        , var(var)
        {

        }

        ///Element copntaining the name of the non-record forevery array, if any
        ParsedPart const *forevery_nonra;
        //Variable id with current value (of type record, if forevery_nonra==NULL)
        HSVM_VariableId var;
};

struct WittyExecutionState
{
        WittyExecutionState(ParsedFile &file, HSVM *hsvm, int32_t scriptid, bool newwitty);

        void Init(HSVM_VariableId var);
        void SM_Init(HSVM_VariableId var);
        void PrintEncoded(Blex::StringPair data,ContentEncoding encoding);
        void Clear();

        ParsedFile &file;
        HSVM *const hsvm;
        HSVM_VariableId gettidfunc;
        HSVM_VariableId gethtmltidfunc;
        int32_t const scriptid;
//        unsigned curforevery_len;
//        unsigned curforevery_element;
        std::vector< VarStackElement > varstack;

        // List, to get rid of reallocation stuff
        std::list< StackElement > stack;

        std::vector<char> scratchpad;
        bool newwitty;
};

Encoding GetESStyle(std::string const &name);


struct Error
{
        Error(unsigned linenum, unsigned columnnum, unsigned errorcode, std::string const &arg, std::string const &arg2 = "")
        : linenum(linenum), columnnum(columnnum), errorcode(errorcode), arg(arg), arg2(arg2)
        {
        }

        unsigned linenum;
        unsigned columnnum;
        unsigned errorcode;
        std::string arg;
        std::string arg2;
};

typedef std::shared_ptr<ParsedFile> ParsedFilePtr;

struct Context
{
        Context();
        ~Context();
        std::vector<ParsedFilePtr> parsedfiles;
        std::vector<Error> errors;

        typedef std::vector< std::shared_ptr< WittyExecutionState > > SMWitties;
        SMWitties sm_witties;

        HSVM_VariableId globalgettid;
        HSVM_VariableId globalgethtmltid;

        void AddError(Error const &Err);
        int32_t ParseXmlTemplate(char const *data, unsigned datalen, Encoding encodingstyle, std::string const &gettidmodule);
};

} // End of namespace Wte
} // End of namespace HareScript

#endif
