#ifndef blex_parsers_office_word_word
#define blex_parsers_office_word_word
//---------------------------------------------------------------------------

#include <blex/docfile.h>
#include <blex/stream.h>
#include <harescript/vm/hsvm_dllinterface.h>
#include <parsers/office_escher/escher.h>
#include "word_base.h"
#include "docx.h"

namespace Parsers {
namespace Office {
namespace Word {

class OpenDoc : public Callbacks
{
        public:
        OpenDoc(HSVM *vm);
        ~OpenDoc();

        std::shared_ptr<Blex::RandomStream> docdata;
        std::shared_ptr<BiffDoc> worddoc_legacy;
        std::shared_ptr<DocX::DocXDoc> worddoc_new;
        DocBase *worddoc_base;
        bool have_scanned_objects;

        HSVM_VariableId note_callback_ptr;
        HSVM_VariableId private_field_callback_ptr;

        Parsers::PublicationProfile pubprof;
        void Close();

        private:
        virtual void FoundFootEndNote(bool is_foot_note, DocPart const *first, DocPart const *limit, FormattedOutput &output);
        virtual void PrivateFieldCallback(std::string const &data, FormattedOutput &output);
        virtual int32_t RegisterOutputObject(OutputObjectInterface *output_object, bool is_top_level, unsigned toclevel, bool filtersplit, bool allhidden);
        HSVM *vm;

        public:
        ///Array that will contain newly picked up top level objects (ADDME: private?)
        HSVM_VariableId objectlist;

        private:
        /* ADDME: We have two registries for all output objects now.. Perhaps have Scan transfer ownership or responsibility? */
        std::vector<int32_t> registered_objects;
};


class BLEXLIB_PUBLIC WordContext
{
        public:
        WordContext();
        ~WordContext();

        int32_t OpenWordDoc(HSVM *vm, std::shared_ptr<Blex::RandomStream> const &worddoc);
        void CloseWordDoc(HSVM *vm, int32_t wordid);
        void ScanWordDoc(int32_t wordid, bool emptydocobjects, HSVM *vm, HSVM_VariableId id_set);
        void SetNoteCallback(int32_t wordid, HSVM *vm, HSVM_VariableId fptr);
        void SetPrivateFieldCallback(int32_t wordid, HSVM *vm, HSVM_VariableId fptr);
        void IgnoreAllcaps(int32_t wordid, bool ignore);
        void SetSymbolConversion(int32_t wordid, bool images);

        private:
        typedef std::shared_ptr<OpenDoc> OpenDocPtr;

        std::vector<OpenDocPtr> opendocs;
};

const unsigned WordContextId = 518;

} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers

//---------------------------------------------------------------------------
#endif
