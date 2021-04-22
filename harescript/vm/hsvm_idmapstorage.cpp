//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include "hsvm_idmapstorage.h"
#include "hsvm_context.h"


namespace HareScript
{

IdMapStorageRapporter::~IdMapStorageRapporter()
{
        if (vm)
            UnregisterHandleKeeper();
}

void IdMapStorageRapporter::RegisterHandleKeeper()
{
        vm->RegisterHandleKeeper(this);
}
void IdMapStorageRapporter::UnregisterHandleKeeper()
{
        vm->UnregisterHandleKeeper(this);
}

} // End of namespace HareScript
