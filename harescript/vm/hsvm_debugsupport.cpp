//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include "hsvm_debugsupport.h"

namespace HareScript
{

std::pair< int64_t, int64_t > GetDebugValueMinMax(StackMachine &stackm, ColumnNameCache const &cn_cache, VarId id_set, VarId req, int64_t defaultmax, int64_t len)
{
        VarId var_min = req ? stackm.RecordCellTypedGetByName(req, cn_cache.col_min, VariableTypes::Integer64, false) : 0;
        VarId var_max = req ? stackm.RecordCellTypedGetByName(req, cn_cache.col_max, VariableTypes::Integer64, false) : 0;

        int64_t min = var_min ? stackm.GetInteger64(var_min) : 0;
        int64_t max = var_max ? stackm.GetInteger64(var_max) : defaultmax;

        // Allow -1 as shortcut for 'all'
        if (max == -1)
            max = len;

        if (min < 0)
            min = 0;
        else if (min > len)
            min = len;
        if (max > len)
            max = len;
        else if (max < min)
            max = min;

        stackm.SetInteger64(stackm.RecordCellCreate(id_set, cn_cache.col_length), len);
        stackm.SetInteger64(stackm.RecordCellCreate(id_set, cn_cache.col_min), min);
        stackm.SetInteger64(stackm.RecordCellCreate(id_set, cn_cache.col_max), max);

        return std::make_pair(min, max);
}

void RetrieveDebugValue(VirtualMachine *vm, VarId id_set, VirtualMachine *source_vm, VarId source_id, VarId req, unsigned depth)
{
        ColumnNameCache const &cn_cache = vm->cn_cache;
        StackMachine &stackm = vm->GetStackMachine();

        StackMachine &source_stackm = source_vm->GetStackMachine();

        stackm.InitVariable(id_set, VariableTypes::Record);

        VariableTypes::Type type = source_stackm.GetType(source_id);
        stackm.SetInteger(stackm.RecordCellCreate(id_set, cn_cache.col_type), type);

        if (DebugSupport::IsOnHeap(source_stackm, source_id))
            stackm.SetInteger(stackm.RecordCellCreate(id_set, cn_cache.col_id), DebugSupport::MapHeapId(source_stackm, source_id) | 0x80000000);
        else
            stackm.SetInteger(stackm.RecordCellCreate(id_set, cn_cache.col_id), DebugSupport::MapStackId(source_stackm, source_id));

        // Undefined? We're done
        if (!type)
            return;

        if (type & VariableTypes::Array)
        {
                unsigned len = source_stackm.ArraySize(source_id);
                auto minmax = GetDebugValueMinMax(stackm, cn_cache, id_set, req, depth ? 10 : 0, len);

                VarId var_value = stackm.RecordCellCreate(id_set, cn_cache.col_value);
                stackm.InitVariable(var_value, VariableTypes::RecordArray);

                for (int32_t idx = minmax.first; idx < minmax.second; ++idx)
                    RetrieveDebugValue(vm, stackm.ArrayElementAppend(var_value), source_vm, source_stackm.ArrayElementGet(source_id, idx), 0, depth - 1);

                return;
        }

        switch (type)
        {
        // Simple types
        case VariableTypes::Integer:
        case VariableTypes::Boolean:
        case VariableTypes::Float:
        case VariableTypes::Money:
        case VariableTypes::Integer64:
        case VariableTypes::DateTime:
            {
                    VarId var_value = stackm.RecordCellCreate(id_set, cn_cache.col_value);
                    stackm.CopyFromOtherVM(vm, var_value, source_vm, source_id, false);
            } break;

        case VariableTypes::String:
            {
                    Blex::StringPair data = source_stackm.GetString(source_id);

                    auto minmax = GetDebugValueMinMax(stackm, cn_cache, id_set, req, depth < 2 ? 100 : 0, data.size());

                    VarId var_value = stackm.RecordCellCreate(id_set, cn_cache.col_value);
                    stackm.SetString(var_value, data.begin + minmax.first, data.begin + minmax.second);
            } break;

        case VariableTypes::Record:
            {
                    bool exists = !source_stackm.RecordNull(source_id);
                    stackm.SetBoolean(stackm.RecordCellCreate(id_set, cn_cache.col_exists), exists);

                    unsigned cellcount = exists ? source_stackm.RecordSize(source_id) : 0;

                    auto minmax = GetDebugValueMinMax(stackm, cn_cache, id_set, req, depth ? cellcount : 0, cellcount);

                    VarId var_value = stackm.RecordCellCreate(id_set, cn_cache.col_value);
                    stackm.InitVariable(var_value, VariableTypes::RecordArray);

                    for (int32_t idx = minmax.first; idx < minmax.second; ++idx)
                    {
                            VarId cell = stackm.ArrayElementAppend(var_value);
                            stackm.InitVariable(cell, VariableTypes::Record);

                            ColumnNameId nameid = source_stackm.RecordCellNameByNr(source_id, idx);
                            Blex::StringPair name = source_stackm.columnnamemapper.GetReverseMapping(nameid);

                            stackm.SetString(stackm.RecordCellCreate(cell, cn_cache.col_name), name);
                            RetrieveDebugValue(vm, stackm.RecordCellCreate(cell, cn_cache.col_value), source_vm, source_stackm.RecordCellGetByName(source_id, nameid), 0, depth - 1);
                    }
            } break;

        case VariableTypes::Object:
        case VariableTypes::WeakObject:
            {
                    bool exists = source_stackm.WeakObjectExists(source_id);
                    stackm.SetBoolean(stackm.RecordCellCreate(id_set, cn_cache.col_exists), exists);

                    unsigned cellcount = exists ? source_stackm.ObjectSize(source_id) : 0;

                    auto minmax = GetDebugValueMinMax(stackm, cn_cache, id_set, req, depth ? cellcount : 0, cellcount);

                    VarId var_value = stackm.RecordCellCreate(id_set, cn_cache.col_value);
                    stackm.InitVariable(var_value, VariableTypes::RecordArray);

                    stackm.SetBoolean(stackm.RecordCellCreate(id_set, cn_cache.col_privileged), source_stackm.ObjectIsPrivilegedReference(source_id));
                    stackm.SetInteger64(stackm.RecordCellCreate(id_set, cn_cache.col_objectid), source_stackm.GetObjectId(source_id));

                    VarId var_objecttypes = stackm.RecordCellCreate(id_set, cn_cache.col_objecttypes);
                    stackm.InitVariable(var_objecttypes, VariableTypes::StringArray);

                    if (exists)
                    {
                            Blex::SemiStaticPodVector< LinkedLibrary::LinkedObjectDef const *, 16 > objdefs;

                            if (source_vm->GetObjectDefinitions(source_id, &objdefs))
                            {
                                    for (auto &itr: objdefs)
                                        stackm.SetString(stackm.ArrayElementAppend(var_objecttypes), itr->name.begin(), itr->name.end());
                            }
                    }

                    for (int32_t idx = minmax.first; idx < minmax.second; ++idx)
                    {
                            VarId cell = stackm.ArrayElementAppend(var_value);
                            stackm.InitVariable(cell, VariableTypes::Record);

                            ColumnNameId nameid = source_stackm.ObjectMemberNameByNr(source_id, idx);
                            if (!nameid)
                                continue;

                            Blex::StringPair name = source_stackm.columnnamemapper.GetReverseMapping(nameid);

                            stackm.SetString(stackm.RecordCellCreate(cell, cn_cache.col_name), name);
                            RetrieveDebugValue(vm, stackm.RecordCellCreate(cell, cn_cache.col_value), source_vm, source_stackm.ObjectMemberGet(source_id, nameid, true), 0, depth - 1);
                    }
            } break;

        case VariableTypes::Blob:
            {
                    BlobRefPtr blobref = source_stackm.GetBlob(source_id);

                    std::string data;
                    std::unique_ptr< OpenedBlob > openblob(blobref.OpenBlob());

                    int64_t len = openblob ? blobref.GetLength() : 0;
                    auto minmax = GetDebugValueMinMax(stackm, cn_cache, id_set, req, depth ? len : 0, len);

                    if (openblob)
                    {
                            data.resize(minmax.second - minmax.first);

                            for (int64_t idx = minmax.first; idx < minmax.second;)
                            {
                                    unsigned toread = std::min< int64_t >(minmax.second - idx, 16384);
                                    std::size_t read = openblob->DirectRead(idx, toread, &data[idx - minmax.first]);
                                    if (!read)
                                        break;

                                    idx += read;
                            }
                    }

                    VarId var_value = stackm.RecordCellCreate(id_set, cn_cache.col_value);
                    stackm.SetString(var_value, data.begin(), data.end());
            } break;

        // TODO
        case VariableTypes::FunctionRecord:
        default: ; // not handled;
        }
}

VarId GetDebugVariable(VirtualMachine *target_vm, uint32_t id)
{
        StackMachine &target_stackm = target_vm->GetStackMachine();
        VarId toget;
        if (id & 0x80000000)
            toget = DebugSupport::UnmapHeapId(target_stackm, id & 0x7FFFFFFF);
        else
            toget = target_stackm.StackStart() + id;

        return target_stackm.CheckVarId(toget) ? toget : 0;
}

void EncodeLibraryDebugInfo(VirtualMachine *vmobj, VarId composevar, VirtualMachine *target_vm, std::string const &liburi)
{
        HSVM *vm = *vmobj;
        ColumnNameCache const &cn_cache = vmobj->cn_cache;

        // Find the library as loaded by the VM
        Library const *found = 0;
        if (target_vm)
        {
                for (auto lib: target_vm->GetLibraryLoader().GetAllLibraries())
                    if (lib->GetLibURI() == liburi)
                    {
                            found = lib;
                            break;
                    }
        }

        // Cells are set right after creating them, creating another cell may invalidate the variable ids of earlier cells
        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, composevar, HSVM_GetColumnId(vm, "FOUND")), found != 0);
        if (found)
        {
                LibraryCompileIds const &clib_ids = found->GetLibraryCompileIds();
                WrappedLibrary const &wlib = found->GetWrappedLibrary();
                std::vector< uint8_t > const &data = wlib.debuginfo.data;

                HSVM_DateTimeSet(vm, HSVM_RecordCreate(vm, composevar, cn_cache.col_compile_id), clib_ids.clib_id.GetDays(), clib_ids.clib_id.GetMsecs());
                HSVM_MakeBlobFromMemory(vm, HSVM_RecordCreate(vm, composevar, HSVM_GetColumnId(vm, "DEBUGINFO_COMPRESSED")), data.size(), data.empty() ? 0 : &data[0]);

                // Code position to source position mapping, needed to map lines to code positions for breakpoints
                HSVM_VariableId var_sourcemap = HSVM_RecordCreate(vm, composevar, HSVM_GetColumnId(vm, "SOURCEMAP"));
                HSVM_SetDefault(vm, var_sourcemap, HSVM_VAR_RecordArray);
                for (auto sit = wlib.debug.debugentries.Begin(); sit != wlib.debug.debugentries.End(); ++sit)
                {
                        HSVM_VariableId var_entry = HSVM_ArrayAppend(vm, var_sourcemap);
                        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var_entry, cn_cache.col_codeptr), sit->first);
                        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var_entry, cn_cache.col_line), sit->second.line);
                        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, var_entry, cn_cache.col_col), sit->second.column);
                }
        }

}

void ApplyDebugBreakpoints(VMGroup &vmgroup, VirtualMachine *target_vm, std::vector< DebugBreakpointSpec > const &breakpoints, unsigned min_stack, unsigned max_stack, bool break_on_exception)
{
        VMGroupDebuggerData &dbg = vmgroup.GetDebuggerData();
        dbg.breakpoints.clear();
        dbg.min_stack = min_stack;
        dbg.max_stack = max_stack;
        dbg.break_on_exception = break_on_exception;

        if (!target_vm)
            return;

        for (auto &itr: breakpoints)
        {
                Library const *lib = target_vm->GetLibraryLoader().GetWHLibrary(itr.liburi);
                if (!lib || lib->GetLibraryCompileIds().clib_id != itr.compile_id)
                    continue;

                std::vector< uint8_t > const &code = lib->GetWrappedLibrary().resident.code;
                if (itr.codeptr >= code.size())
                    continue;

                dbg.breakpoints.insert(std::make_pair(&code[itr.codeptr], std::make_pair(itr.stacksize, itr.manual)));
        }
}

} // End of namespace HareScript
