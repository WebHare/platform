#ifndef blex_parsers_office_excel_excel
#define blex_parsers_office_excel_excel
//---------------------------------------------------------------------------

#include <harescript/vm/hsvm_dllinterface.h>
#include <harescript/vm/hsvm_idmapstorage.h>
#include <blex/docfile.h>
#include <blex/stream.h>
#include <blex/datetime.h>
#include <drawlib/drawlibv2/drawobject.h>
#include "exceldoc.h"

namespace Parsers {
namespace Office {
namespace Excel {

/** Global Excel data, per VM */
class GlobalExcelContext
{
        public:
        GlobalExcelContext();
        ~GlobalExcelContext();

        typedef std::shared_ptr<ExcelDoc> ExcelDocPtr;
        HareScript::IdMapStorage<ExcelDocPtr> conversionlist;
        std::string last_error;
};

/////////////////////////////////////////////////////
// Some (globally) used debug functions:

//std::ostream &operator<<(std::ostream &output, RecordHeader const &data);

const unsigned ExcelContextId = 54545; //FIXME:Reserve official number

} //end namespace Excel
} //end namespace Office
} //end namespace Parsers

//---------------------------------------------------------------------------
#endif
