#ifndef blex_parsers_hareindex_hareindex
#define blex_parsers_hareindex_hareindex

#include <harescript/vm/hsvm_dllinterface.h>
#include <harescript/vm/baselibs.h>
#include "formatter.h"

typedef std::function< void(HSVM**) > IndexFileFunc;
int Harescript_ParentModuleEntryPoint(HSVM_RegData *regdata,void*);
int Harescript_InnerModuleEntryPoint(HSVM_RegData *regdata,void*);
void Harescript_SetupIndex(HSVM *vm, IndexFileFunc const &indexfunc, int32_t source_file_id, std::string const &tempdir);

#endif
