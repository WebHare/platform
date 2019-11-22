#ifndef blex_parsers_parserinterface
#define blex_parsers_parserinterface

/* This header file captures the HSVM dependencies */

#include <stack>
#include <blex/stream.h>
#include <harescript/vm/hsvm_dllinterface.h>
#include "formatter.h"
#include "filtering.h"

namespace Parsers
{
const unsigned OutputContextId = 516; //Our reserved ID

BLEXLIB_PUBLIC FormattedOutputPtr GetFormattedOutput(HSVM *vm, int32_t id);
BLEXLIB_PUBLIC int32_t RegisterFormattedOutput(HSVM *vm, FormattedOutputPtr const &myoutput);
BLEXLIB_PUBLIC void UnregisterFormattedOutput(HSVM *vm, int32_t id);

BLEXLIB_PUBLIC OutputObjectInterface * GetOutputObject(HSVM *vm, int32_t id);
BLEXLIB_PUBLIC int32_t RegisterOutputObject(HSVM *vm, OutputObjectInterface *myobject);
BLEXLIB_PUBLIC void UnregisterOutputObject(HSVM *vm, int32_t id);

BLEXLIB_PUBLIC void PushPaintFunction(HSVM *vm, PaintFunction const &newpainter);
BLEXLIB_PUBLIC void PopPaintFunction(HSVM *vm);

/** Fill in a single style record
    @param trans Database transaction
    @param rec Record containing the style data*/
void ParseFilter(HSVM *vm, HSVM_VariableId rec, StyleSettings *stylesettings);

/** Update our internal filters from a filters table */
BLEXLIB_PUBLIC void ParseFilters(HSVM *vm, HSVM_VariableId filters, PublicationProfile *pubprof);

/** Read style filter from record */
BLEXLIB_PUBLIC void ReadFilter(HSVM *vm, HSVM_VariableId filter, StyleSettings *dest);

struct BLEXLIB_PUBLIC CustomOutputObject : public OutputObjectInterface
{
        CustomOutputObject(HSVM *_vm, HSVM_VariableId _obj);
        ~CustomOutputObject();

        HSVM *vm;
        HSVM_VariableId obj;

        /** Format and send this object
            @param siteoutput Page to send the object to
            @param override_filter_id If != 0, the id of the filter that must be choosen for the publication */
        virtual void Send(FormattedOutputPtr const &siteoutput) const;

        /** Ask this object whether it has an anchor */
        virtual std::string GetAnchor() const;
};

struct OutputContext
{
        ///Registered outputs (we are never the owner!)
        std::vector<FormattedOutputPtr> formattedoutputs;
        ///Registered outputs (we are never the owner!)
        typedef std::map< int32_t, OutputObjectInterface*> OutputObjects;
        OutputObjects outputobjects;
        ///FIFO of acceptable painter functions
        std::stack<Parsers::PaintFunction> paintfunc;
        ///Custom parser objects
        std::map< int32_t, std::shared_ptr< CustomOutputObject > > custom_objs;
};

BLEXLIB_PUBLIC OutputContext* GetOutputContext(HSVM *vm);

} //end namespace Parsers
#endif
