#include <ap/libwebhare/allincludes.h>


#include <iomanip>
#include <sstream>
#include "word_debug.h"

namespace Parsers {
namespace Office {
namespace Word {

void DumpAbstractNumbering(ListData const &abstract)
{
        std::ostringstream listinfo;
        listinfo << std::dec << "List ID " << std::hex << std::setw(8)
                 << abstract.unique_list_id << '/' << abstract.unique_template_code
                 << (abstract.simplelist ? " simple" : "")
                 << (abstract.restart_heading ?" restart":"");

        for (ListData::Levels::const_iterator itr = abstract.levels.begin(); itr != abstract.levels.end(); ++itr)
            listinfo << " (" << std::dec << itr->first << ":@" << itr->second->startat
                     << ",nfc=" << (int)itr->second->nfc
                     << ",jc=" << (int)itr->second->jc
                     << ",restartafter=" << itr->second->restartafter
                     << (itr->second->legal?",legal":"")
                     << ")";
        DEBUGPRINT(listinfo.str());
}

void DocBase::DumpMetadata()
{
        DEBUGPRINT("DocBase metadata dump");

        DEBUGPRINT("-- lists --\n");
        for(ListOverrideMap::iterator itr = numberings.begin(); itr != numberings.end(); ++itr)
        {
                DEBUGPRINT(itr->first << ": abstract=" << std::hex << std::setw(8)
                           << itr->second->abstract->unique_list_id);
        }

        DEBUGPRINT("End DocBase metadata dump");
}

} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers
