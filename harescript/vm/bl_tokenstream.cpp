#include <harescript/vm/allincludes.h>

#include <blex/docfile.h>
#include "baselibs.h"
#include "hsvm_context.h"

namespace HareScript {
namespace Baselibs {

namespace {

const unsigned TokenStreamContextId = 65318; //FIXME: Register an id

class TokenStream
{
        public:
        TokenStream(HSVM *vm);
        ~TokenStream();

        void SetLanguage(std::string const &langcode);
        std::string GetLanguage();
        void AddText(std::string const &text);
        bool NextToken();
        Blex::Token const &GetCurrentToken();
        std::string GetStemmedTokenText();

        private:
        Blex::TokenStream tokstream;
        Blex::Stemmer stemmer;
};

typedef std::shared_ptr<TokenStream> TokenStreamPtr;

class TSContext
{
        public:
        typedef std::vector<TokenStreamPtr> StreamsList;
        StreamsList streams;

        TokenStream *GetByArg(HSVM *vm, HSVM_VariableId param);
};


TokenStream::TokenStream(HSVM */*vm*/)
: tokstream("")
{
}

TokenStream::~TokenStream()
{
}

void TokenStream::SetLanguage(std::string const &langcode)
{
        Blex::Lang::Language lang = Blex::Lang::GetLanguage(langcode);
        tokstream.SetLanguage(lang);
        stemmer.SetLanguage(lang);
}

std::string TokenStream::GetLanguage()
{
        return GetLanguageCode(tokstream.GetCurrentLanguage());
}

void TokenStream::AddText(std::string const &text)
{
        tokstream.AddToReadBuffer(text);
}

bool TokenStream::NextToken()
{
        return tokstream.NextToken();
}

Blex::Token const &TokenStream::GetCurrentToken()
{
        return tokstream.GetCurrentToken();
}

std::string TokenStream::GetStemmedTokenText()
{
        Blex::Token token = tokstream.GetCurrentToken();
        if (token.valid && token.type == Blex::Token::Word)
            return stemmer.Stem(token.normalizedterm);

        return token.normalizedterm;
}

TokenStream *TSContext::GetByArg(HSVM *vm, HSVM_VariableId param)
{
        int32_t id = HSVM_IntegerGet(vm, param);
        if (id <= 0 || unsigned(id) > streams.size() || !streams[id - 1].get())
        {
                HSVM_ReportCustomError(vm,"Illegal token stream id");
                return NULL;
        }
        return streams[id - 1].get();
}

void TS_Create(HSVM *vm, HSVM_VariableId id_set)
{
        TSContext &context = *static_cast<TSContext*>(HSVM_GetContext(vm,TokenStreamContextId,true));

        TokenStreamPtr newstream(new TokenStream(vm));
        context.streams.push_back(newstream);
        int32_t id = context.streams.size();

        HSVM_IntegerSet(vm, id_set, id);
}

void TS_Destroy(HSVM *vm)
{
        TSContext &context = *static_cast<TSContext*>(HSVM_GetContext(vm,TokenStreamContextId,true));
        int32_t id = HSVM_IntegerGet(vm, HSVM_Arg(0));
        if (id <= 0 || unsigned(id) > context.streams.size() || !context.streams[id - 1].get())
        {
                HSVM_ReportCustomError(vm,"Illegal token stream id");
                return;
        }
        context.streams[id - 1].reset();
}

void TS_SetupLangCode(HSVM *vm, HSVM_VariableId id_set)
{
        HSVM_SetDefault(vm, id_set, HSVM_VAR_Boolean);

        TSContext &context = *static_cast<TSContext*>(HSVM_GetContext(vm,TokenStreamContextId,true));
        TokenStream *stream = context.GetByArg(vm, HSVM_Arg(0));
        if(!stream)
            return;

        std::string langcode = HSVM_StringGetSTD(vm, HSVM_Arg(1));
        Blex::ToUppercase(langcode);
        stream->SetLanguage(langcode);

        HSVM_BooleanSet(vm, id_set, langcode.compare(stream->GetLanguage()) == 0);
}

void TS_AddText(HSVM *vm)
{
        TSContext &context = *static_cast<TSContext*>(HSVM_GetContext(vm,TokenStreamContextId,true));
        TokenStream *stream = context.GetByArg(vm, HSVM_Arg(0));
        if(!stream)
            return;

        stream->AddText(HSVM_StringGetSTD(vm, HSVM_Arg(1)));
}

void TS_NextToken(HSVM *vm, HSVM_VariableId id_set)
{
        HSVM_SetDefault(vm, id_set, HSVM_VAR_Boolean);

        TSContext &context = *static_cast<TSContext*>(HSVM_GetContext(vm,TokenStreamContextId,true));
        TokenStream *stream = context.GetByArg(vm, HSVM_Arg(0));
        if(!stream)
            return;

        HSVM_BooleanSet(vm, id_set, stream->NextToken());
}

void TS_GetCurrentToken(HSVM *vm, HSVM_VariableId id_set)
{
        HSVM_RecordSetEmpty(vm, id_set);

        TSContext &context = *static_cast<TSContext*>(HSVM_GetContext(vm,TokenStreamContextId,true));
        TokenStream *stream = context.GetByArg(vm, HSVM_Arg(0));
        if(!stream)
            return;

        Blex::Token token = stream->GetCurrentToken();
        if (!token.valid)
            return;

        std::string stemmedtokentext = stream->GetStemmedTokenText();

        HSVM_ColumnId type = HSVM_GetColumnId(vm, "TYPE");
        HSVM_ColumnId termtext = HSVM_GetColumnId(vm, "TEXT");
        HSVM_ColumnId normalizedterm = HSVM_GetColumnId(vm, "NORMALIZEDTEXT");
        HSVM_ColumnId stemmedterm = HSVM_GetColumnId(vm, "STEMMEDTEXT");
        HSVM_ColumnId startoffset = HSVM_GetColumnId(vm, "STARTOFFSET");
        HSVM_ColumnId endoffset = HSVM_GetColumnId(vm, "ENDOFFSET");

        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, id_set, type), token.type);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, id_set, termtext), token.termtext);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, id_set, normalizedterm), token.normalizedterm);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, id_set, stemmedterm), stemmedtokentext);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, id_set, startoffset), token.startoffset);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, id_set, endoffset), token.endoffset);
}

static void* CreateTSContext(void *)
{
        return new TSContext;
}
static void DestroyTSContext(void*, void *context_ptr)
{
        delete static_cast<TSContext*>(context_ptr);
}

//ADDME: Cache stemmers, so they don't have to be initialized for each stemmed word?
void StemWord(HSVM *vm, HSVM_VariableId id_set)
{
        HSVM_SetDefault(vm, id_set, HSVM_VAR_String);

        // Parse language code
        std::string langcode = HSVM_StringGetSTD(vm, HSVM_Arg(1));
        Blex::ToUppercase(langcode);
        Blex::Lang::Language lang = Blex::Lang::GetLanguage(langcode);
        if (lang == Blex::Lang::None)
            return;

        // Initialize stemmer
        Blex::Stemmer stemmer;
        stemmer.SetLanguage(lang);

        // Stem word and return result
        std::string stemmed = stemmer.Stem(HSVM_StringGetSTD(vm, HSVM_Arg(0)));
        HSVM_StringSetSTD(vm, id_set, stemmed);
}

void NormalizeText(HSVM *vm, HSVM_VariableId id_set)
{
        HSVM_SetDefault(vm, id_set, HSVM_VAR_String);

        // Parse language code
        std::string langcode = HSVM_StringGetSTD(vm, HSVM_Arg(1));
        Blex::ToUppercase(langcode);
        Blex::Lang::Language lang = Blex::Lang::GetLanguage(langcode);
        if (lang == Blex::Lang::None)
            return;

        // Normalize word and return result
        std::string normalized = Blex::NormalizeString(HSVM_StringGetSTD(vm, HSVM_Arg(0)), lang);
        HSVM_StringSetSTD(vm, id_set, normalized);
}

} //end anonymous namespace

void InitTokenStream(struct HSVM_RegData *regdata)
{
        HSVM_RegisterContext (regdata, TokenStreamContextId, NULL, &CreateTSContext, &DestroyTSContext);
        HSVM_RegisterFunction(regdata, "__TOKENSTREAM_CREATE::I:",TS_Create);
        HSVM_RegisterMacro   (regdata, "__TOKENSTREAM_DESTROY:::I",TS_Destroy);
        HSVM_RegisterFunction(regdata, "__TOKENSTREAM_SETLANGUAGE::B:IS",TS_SetupLangCode);
        HSVM_RegisterMacro   (regdata, "__TOKENSTREAM_ADDTEXT:::IS",TS_AddText);
        HSVM_RegisterFunction(regdata, "__TOKENSTREAM_NEXTTOKEN::B:I",TS_NextToken);
        HSVM_RegisterFunction(regdata, "__TOKENSTREAM_GETCURRENTTOKEN::R:I",TS_GetCurrentToken);

        HSVM_RegisterFunction(regdata, "__STEMWORD::S:SS",StemWord);
        HSVM_RegisterFunction(regdata, "__NORMALIZETEXT::S:SS",NormalizeText);
}

} // End of namespace Baselibs
} // End of namespace HareScript
