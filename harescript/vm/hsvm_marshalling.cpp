//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include "hsvm_marshalling.h"
#include "hsvm_context.h"
#include "blex/logfile.h"

namespace HareScript
{

static uint32_t const MarshalFormatType = 2;
static uint32_t const MarshalPacketFormatType = 3;
static uint32_t const MarshalLibraryFormatType = 4;
static uint32_t const MarshalFormatType_largeblobs = 5;

// --------------------------------------------------------------------------
//
// Marshaldata
//

ObjectMarshalData::~ObjectMarshalData()
{
        if (restorefunc && data)
        {
                void *mdata = data;
                data = 0;
                restorefunc(0, 0, mdata);
        }
}


MarshalPacket::~MarshalPacket()
{
        Reset();
}

void MarshalPacket::Reset()
{
        blobs.clear();
        objects.clear();
        columndata.clear();
        data.clear();
}

bool MarshalPacket::TryClone(std::unique_ptr< MarshalPacket > *_copy) const
{
        // Can all objects be cloned?
        for (auto &itr: objects)
            if (!itr->clonefunc)
                return false;

        std::unique_ptr< MarshalPacket > copy;
        copy.reset(new MarshalPacket(*this));

        // Clone all the objects
        for (auto &itr: copy->objects)
        {
                // Copy the data record and intitialize. Set data to 0 because clone may fail, don't want destructor to mess up.
                std::shared_ptr< ObjectMarshalData > datacopy(new ObjectMarshalData);
                datacopy->data = 0;
                datacopy->restorefunc = itr->restorefunc;
                datacopy->clonefunc = itr->clonefunc;
                datacopy->varid = 0;

                // Clone the data and replace the object
                datacopy->data = itr->clonefunc(itr->data);
                itr = datacopy;
        }

        _copy->reset(copy.release());
        return true;
}


void MarshalPacket::WriteToPodVector(Blex::PodVector< uint8_t > *target, GlobalBlobManager *blobmgr)
{
        if (!objects.empty())
            ThrowInternalError("Cannot do a raw store for marshal packets with objects");

        std::size_t totalsize = 20 + columndata.size() + data.size();

        Blex::FileOffset blobsize = 0;
        if (!blobs.empty())
        {
                if (!blobmgr)
                    ThrowInternalError("Cannot do a raw store for marshal packets with blobs");

                blobsize = 4; // nr of blobs
                for (std::vector< std::shared_ptr< BlobData > >::iterator it = blobs.begin(); it != blobs.end(); ++it)
                    blobsize += 8 + (*it)->length;

                if (blobsize > (1ull << 30)) // Max 1 GB
                    ThrowInternalError("Trying to send more than 1 GB of blobs through an inter-process IPC link");

                totalsize += blobsize;
        }

        target->resize(totalsize);
        memset(&(*target)[0], 0, 20);

        Blex::putu32lsb(&(*target)[0], MarshalFormatType); // Version number
        Blex::putu32lsb(&(*target)[4], columndata.size());
        Blex::putu32lsb(&(*target)[8], data.size());
        Blex::putu64lsb(&(*target)[12], blobsize);

        std::copy(columndata.begin(), columndata.end(), target->begin() + 20);
        std::copy(data.begin(), data.end(), target->begin() + (20 + columndata.size()));

        if (!blobs.empty())
        {
                std::size_t blobpos = 20 + columndata.size() + data.size();

                Blex::putu32lsb(&(*target)[blobpos], blobs.size());
                blobpos += 4;

                std::size_t blobdatapos = blobpos + 8 * blobs.size();
                for (std::vector< std::shared_ptr< BlobData > >::iterator it = blobs.begin(); it != blobs.end(); ++it)
                {
                        Blex::putu64lsb(&(*target)[blobpos], (*it)->length);
                        blobpos += 8;

                        Blex::FileOffset length = (*it)->length;
                        Blex::FileOffset offset = 0;
                        while (offset != length)
                        {
                                Blex::FileOffset toread = length - offset;
                                if (toread > 32768)
                                    toread = 32768;

                                std::size_t read = (*it)->blob->DirectRead(offset, toread, &(*target)[blobdatapos]);
                                if (read == 0)
                                    ThrowInternalError("Error reading blob for marshalling");

                                offset += read;
                                blobdatapos += read;
                        }
                }
        }
}

void MarshalPacket::Read(uint8_t const *start, uint8_t const *end, GlobalBlobManager *blobmgr)
{
        if (end - start < 20)
            ThrowInternalError("Illegal packet format, must be at lease 20 bytes long");

        if (Blex::getu32lsb(start) != MarshalFormatType)
            ThrowInternalError("Unsupported marshal format type: connect with the same Webhare version");

        uint32_t columnsize = Blex::getu32lsb(start + 4);
        uint32_t datasize = Blex::getu32lsb(start + 8);
        uint64_t blobsize = Blex::getu64lsb(start + 12);

        if (static_cast< size_t >(end - start) != 20 + columnsize + datasize + blobsize)
            ThrowInternalError("Marshal packet misformed: size does not match");

        objects.clear();
        blobs.clear();
        columndata.resize(columnsize);
        data.resize(datasize);

        if (columnsize)
            std::copy(start + 20, start + 20 + columnsize, &columndata[0]);
        if (datasize)
            std::copy(start + 20 + columnsize, start + 20 + columnsize + datasize, &data[0]);
        if (blobsize)
        {
                if (!blobmgr)
                    ThrowInternalError("Require blobmanager to decode blobs");

                std::size_t blobpos = 20 + columnsize + datasize;
                uint32_t blobcount = Blex::getu32lsb(start + blobpos);
                blobpos += 4;

                std::size_t blobdatapos = blobpos + 8 * blobcount;

                Blex::FileOffset blobdataremainlen = (end - start) - blobdatapos;

                for (uint32_t i = 0; i < blobcount; ++i)
                {
                        std::size_t length = Blex::getu64lsb(start + blobpos);
                        blobpos += 8;

                        if (blobdataremainlen < length)
                            ThrowInternalError("Not enough blob data available");
                        blobdataremainlen -= length;

                        std::unique_ptr< Blex::ComplexFileStream > file;
                        std::string blobfilename;

                        file = blobmgr->CreateTempStream(&blobfilename);

                        Blex::FileOffset towrite = length;
                        while (towrite != 0)
                        {
                                std::size_t written = file->Write(start + blobdatapos, towrite > 32768 ? 32768 : towrite);
                                if (!written)
                                    ThrowInternalError("Cannot write blob to blob storage");
                                towrite -= written;
                                blobdatapos += written;
                        }

                        std::shared_ptr< BlobData > blobdata(new BlobData);
                        blobdata->blob = blobmgr->BuildBlobFromTempStream(std::move(file), blobfilename);
                        blobdata->length = length;

                        blobs.push_back(blobdata);
                }
        }
}

// --------------------------------------------------------------------------
//
// Marshaller
//

Marshaller::Marshaller(VirtualMachine *_vm, MarshalMode::Type _mode)
: vm(_vm)
, stackm(vm->GetStackMachine())
, mode(_mode)
, data_size(0)
, use_library_column_list(false)
, library_column_list(0)
, library_column_encoder(0)
{
}

Marshaller::Marshaller(StackMachine &_stackm, MarshalMode::Type _mode)
: vm(0)
, stackm(_stackm)
, mode(_mode)
, data_size(0)
, blobcount(0)
, largeblobs(false)
, use_library_column_list(false)
, library_column_list(0)
, library_column_encoder(0)
{
        assert(_mode != MarshalMode::All && _mode != MarshalMode::AllClonable);
}

Marshaller::~Marshaller()
{
        for (std::list< MarshalPacket * >::iterator it = packets.begin(); it != packets.end(); ++it)
            delete *it;
}

unsigned Marshaller::FixedVariableLength(VariableTypes::Type type)
{
        switch (type)
        {
        case VariableTypes::Integer:   return 4;
        case VariableTypes::Money:     return 8;
        case VariableTypes::Integer64: return 8;
        case VariableTypes::Float:     return 8;
        case VariableTypes::Boolean:   return 1;
        case VariableTypes::DateTime:  return 8;
        default:
            return 0;
        }
}

Blex::FileOffset Marshaller::Analyze(VarId var)
{
        return AnalyzeInternal(var, false);
}

Blex::FileOffset Marshaller::AnalyzeInternal(VarId var, bool to_packet)
{
        if (!vm && mode != MarshalMode::SimpleOnly)
            ThrowInternalError("Cannot write blobs or objects without a VM!");

        columns.clear();
        if (columnmap.get())
            columnmap->clear();

        largeblobs = false;
        blobcount = 0;
        data_size = CalculateVarLength(var, to_packet);

        if (!to_packet && largeblobs)
            data_size += 4ull * blobcount;

        if (to_packet)
        {
                data_size += 2; // Format byte, one type byte
        }
        else
        {
                data_size += 6; // Format byte, nr of columns, one type byte
                if (columnmap.get())
                {
                        if (library_column_encoder)
                        {
                                // Have encoder, encode as uint32_t index
                                data_size += columns.size() * 4;
                        }
                        else
                        {
                                // Add length bytes (1 per column)
                                data_size += columns.size();

                                // Add length of columns
                                unsigned idx = 0;
                                for (Blex::PodVector< ColumnNameId >::iterator it = columns.begin(); it != columns.end(); ++it, ++idx)
                                {
                                        data_size += stackm.columnnamemapper.GetReverseMapping(*it).size();
                                }
                        }
                }
        }

        if (data_size > std::numeric_limits< size_t >::max())
            ThrowInternalError("Too much data to transfer, cannot marshal more than 4GB of variable data");

        return data_size;
}

Blex::FileOffset Marshaller::CalculateVarLength(VarId var, bool to_packet)
{
        VariableTypes::Type type = stackm.GetType(var);

        if (type & VariableTypes::Array)
        {
                // Element count
                Blex::FileOffset size = 4;
                unsigned eltcount = stackm.ArraySize(var);

                if (type == VariableTypes::VariantArray)
                {
                        // Type byte needed for every element
                        size += eltcount;
                }
                else
                {
                        // See if the variable has a fixed length. If so, we are done very quickly
                        unsigned eltlen = FixedVariableLength(ToNonArray(type));
                        if (eltlen)
                            return size + eltcount * eltlen;
                }

                for (unsigned idx = 0; idx < eltcount; ++idx)
                    size += CalculateVarLength(stackm.ArrayElementRef(var, idx), to_packet);

                return size;
        }

        switch (type)
        {
        case VariableTypes::Integer:   return 4;
        case VariableTypes::Integer64: return 8;
        case VariableTypes::Money:     return 8;
        case VariableTypes::Float:     return 8;
        case VariableTypes::Boolean:   return 1;
        case VariableTypes::DateTime:  return 8;
        case VariableTypes::String:
                {
                        // Character count
                        Blex::FileOffset size = 4;
                        size += stackm.GetString(var).size();
                        return size;
                }
        case VariableTypes::Blob:
                {
                        BlobRefPtr blob = stackm.GetBlob(var);

                        Blex::FileOffset size = blob.GetLength();

                        if (size != 0 && mode == MarshalMode::SimpleOnly)
                            ThrowInternalError("Cannot marshal non-default blobs in SimpleOnly mode");

                        ++blobcount;
                        if (size >= (1ull<<32))
                            largeblobs = true;

                        if (to_packet)
                            return 4; // Id of blob in list
                        else
                            return size + 4; // 4 bytes default size (small blobs)
                }
        case VariableTypes::FunctionRecord:
                {
                        if (stackm.RecordSize(var) != 0)
                            ThrowInternalError("Cannot marshal non-default function ptrs");
                } // Fallthrough !!
        case VariableTypes::Record:
                {
                        // Element count
                        Blex::FileOffset size = 4;
                        unsigned eltcount = stackm.RecordSize(var);
                        for (unsigned idx = 0; idx != eltcount; ++idx)
                        {
                                ColumnNameId nameid = stackm.RecordCellNameByNr(var, idx);

                                if (!columnmap.get())
                                    columnmap.reset(new std::unordered_map< ColumnNameId, unsigned >());

                                if (columnmap->find(nameid) == columnmap->end())
                                {
                                        columnmap->insert(std::make_pair(nameid, columns.size()));
                                        columns.push_back(nameid);
                                }

                                size += 5; // Column nameid mapping, type of column
                                size += CalculateVarLength(stackm.RecordCellGetByName(var, nameid), to_packet);
                        }
                        return size;
                }
        case VariableTypes::Object:
                {
                        if (to_packet)
                            return 4;
                        else if (stackm.ObjectExists(var))
                            ThrowInternalError("Cannot marshal live objects"); //ADDME: Allow objects to offer an optional serializer member?
                        return 0;
                }
        case VariableTypes::WeakObject:
                {
                        if (stackm.WeakObjectExists(var))
                            ThrowInternalError("Cannot marshal live weak objects"); //ADDME: Allow objects to offer an optional serializer member?
                        return 0;
                }
        default:
            // Table, Schema
            ThrowInternalError("Cannot marshal variables of type " + GetTypeName(type));
        }
        return 0;
}

uint8_t* Marshaller::MarshalWriteInternal(VarId var, uint8_t *ptr, MarshalPacket *packet)
{
        VariableTypes::Type type = stackm.GetType(var);
        if (type & VariableTypes::Array)
        {
                unsigned eltcount = stackm.ArraySize(var);
                Blex::PutLsb<int32_t>(ptr, eltcount);
                ptr += 4;

                if (type == VariableTypes::VariantArray)
                {
                        for (unsigned idx = 0; idx < eltcount; ++idx)
                        {
                                VarId elt = stackm.ArrayElementGet(var, idx);
                                Blex::PutLsb<uint8_t>(ptr++, static_cast<uint8_t>(stackm.GetType(elt)));
                                ptr = MarshalWriteInternal(elt, ptr, packet);
                        }
                }
                else
                {
                        for (unsigned idx = 0; idx < eltcount; ++idx)
                            ptr = MarshalWriteInternal(stackm.ArrayElementGet(var, idx), ptr, packet);
                }
                return ptr;
        }

        switch (type)
        {
        case VariableTypes::Integer:
                Blex::PutLsb<int32_t>(ptr, stackm.GetInteger(var)); return ptr + 4;
        case VariableTypes::Integer64:
                Blex::PutLsb<int64_t>(ptr, stackm.GetInteger64(var)); return ptr + 8;
        case VariableTypes::Money:
                Blex::PutLsb<int64_t>(ptr, stackm.GetMoney(var)); return ptr + 8;
        case VariableTypes::Float:
                Blex::PutLsb<F64>(ptr, stackm.GetFloat(var)); return ptr + 8;
        case VariableTypes::Boolean:
                Blex::PutLsb<uint8_t>(ptr, stackm.GetBoolean(var)); return ptr + 1;
        case VariableTypes::DateTime:
                {
                        Blex::DateTime datetime = stackm.GetDateTime(var);
                        Blex::PutLsb<uint32_t>(ptr, datetime.GetDays());
                        Blex::PutLsb<uint32_t>(ptr+4, datetime.GetMsecs());
                        return ptr + 8;
                }
        case VariableTypes::String:
                {
                        Blex::StringPair pair = stackm.GetString(var);
                        size_t size = std::distance(pair.begin, pair.end);

                        Blex::PutLsb<int32_t>(ptr, size);
                        ptr += 4;
                        std::copy (pair.begin, pair.end, ptr);
                        return ptr + size;
                }
        case VariableTypes::FunctionRecord:
        case VariableTypes::Record:
                {
                        if (stackm.RecordNull(var) || (type == VariableTypes::FunctionRecord && stackm.RecordSize(var) == 0))
                        {
                                Blex::PutLsb<int32_t>(ptr,-1);
                                return ptr+4;
                        }

                        // Element count
                        unsigned eltcount = stackm.RecordSize(var);
                        Blex::PutLsb<int32_t>(ptr, eltcount);
                        ptr += 4;

                        for (unsigned idx = 0; idx != eltcount; ++idx)
                        {
                                ColumnNameId nameid = stackm.RecordCellNameByNr(var, idx);

                                auto it = columnmap->find(nameid);
                                if (it == columnmap->end())
                                    ThrowInternalError("Could not find cell name-id; did you change the variable between Analyze and Write?");

                                Blex::PutLsb<uint32_t>(ptr, it->second);
                                ptr += 4;

                                VarId elt = stackm.RecordCellGetByName(var, nameid);
                                Blex::PutLsb<uint8_t>(ptr++, static_cast<uint8_t>(stackm.GetType(elt)));
                                ptr = MarshalWriteInternal(elt, ptr, packet);
                        }
                        return ptr;
                }
        case VariableTypes::Blob:
                {
                        BlobRefPtr the_blob = stackm.GetBlob(var);
                        Blex::FileOffset length = the_blob.GetLength();

                        if (packet)
                        {
                                if (length == 0)
                                {
                                        Blex::PutLsb< uint32_t >(ptr, 0);
                                        return ptr + 4;
                                }

                                std::shared_ptr< MarshalPacket::BlobData > clone;
                                clone.reset(new MarshalPacket::BlobData);
                                clone->length = length;
                                clone->blob = vm->GetBlobManager().ConvertToGlobalBlob(stackm.GetBlob(var));

                                packet->blobs.push_back(clone);
                                Blex::PutLsb< int32_t >(ptr, packet->blobs.size());
                                return ptr + 4;
                        }
                        else
                        {
                                // Raw data based, copy the blob to the raw data stream
                                Blex::FileOffset size = the_blob.GetLength();
                                if (largeblobs)
                                {
                                        Blex::PutLsb< uint64_t >(ptr,size);
                                        ptr+=8;
                                }
                                else
                                {
                                      if (size > (1ull << 32))
                                          ThrowInternalError("Cannot marshal blobs bigger than 4GB in small blob mode");
                                        Blex::PutLsb< uint32_t >(ptr,size);
                                        ptr+=4;
                                }

                                if (size>0)
                                {
                                        std::unique_ptr< OpenedBlob > openblob(the_blob.OpenBlob());
                                        if (!openblob)
                                            ThrowInternalError("I/O error - cannot open blob");

                                        Blex::FileOffset curpos = 0;
                                        while (size > 0)
                                        {
                                                unsigned toread = std::min< Blex::FileOffset >(size, 16384);
                                                std::size_t bytesread = openblob->DirectRead(curpos, toread, ptr);
                                                if(bytesread<=0)
                                                    ThrowInternalError("I/O error - cannot read from blob for serializing");

                                                size -= bytesread;
                                                ptr += bytesread;
                                                curpos += bytesread;
                                        }
                                }

                                return ptr + size;
                        }
                }

        case VariableTypes::VMRef:
                ThrowInternalError("Found a VM reference in a non-default function ptr; please remove those");

        case VariableTypes::Object:
                {
                        if (packet)
                        {
                                if (!stackm.ObjectExists(var))
                                {
                                        Blex::PutLsb< uint32_t >(ptr, 0);
                                        return ptr + 4;
                                }

                                if (mode != MarshalMode::All && mode != MarshalMode::AllClonable)
                                    ThrowInternalError("Cannot only marshal objects in marshal mode 'All' and 'AllClonable'");

                                uint32_t dataid = packet->objects.size() + 1;
                                {
                                        std::shared_ptr< ObjectMarshalData > data(new ObjectMarshalData);
                                        data->data = 0;
                                        data->restorefunc = 0;
                                        data->clonefunc = 0;
                                        data->varid = var;

                                        packet->objects.push_back(data);
                                }
                                ObjectMarshalData &data = *packet->objects.back();

                                HSVM_ObjectMarshallerPtr marshaller = stackm.ObjectGetMarshaller(var);
                                if (!marshaller)
                                    ThrowInternalError("Cannot marshal variables of type OBJECT that have no marshalling function");

                                if (!(*marshaller)(*vm, var, &data.data, &data.restorefunc, mode == MarshalMode::AllClonable ? &data.clonefunc : 0))
                                    ThrowInternalError("The marshalling function of a variable of type OBJECT failed: could not create a marshalling packet");

                                if (!data.data || !data.restorefunc)
                                    ThrowInternalError("The marshalling function of a variable of type OBJECT failed: no data or restore function returned");

                                if (mode == MarshalMode::AllClonable && !data.clonefunc)
                                    ThrowInternalError("The marshalling function of a variable of type OBJECT failed: object cannot be copied");

                                Blex::PutLsb< uint32_t >(ptr, dataid);
                                return ptr + 4;
                        }
                        else
                        {
                                if (stackm.ObjectExists(var))
                                     ThrowInternalError("Cannot marshal live objects"); //ADDME: ALlow objects to offer an optional serializer member?
                                return ptr;
                        }
                }

        case VariableTypes::WeakObject:
                {
                        if (stackm.WeakObjectExists(var))
                              ThrowInternalError("Cannot marshal live weak objects");
                        return ptr;
                }

        default:
                // Blob, Table, VMRef, FunctionPtr
                ThrowInternalError("Cannot marshal variables of type " + GetTypeName(stackm.GetType(var)));
        }
        return 0;
}

void Marshaller::WritePacketColumns(MarshalPacket *packet)
{
        unsigned final_size = 4;
        strings.clear();

        if (columnmap.get())
        {
                size_t col_count = columns.size();
                final_size += col_count;

                strings.resize(col_count);
                Blex::PodVector< Blex::StringPair >::iterator sitr = strings.begin();

                for (Blex::PodVector< ColumnNameId >::iterator it = columns.begin(); it != columns.end(); ++it, ++sitr)
                {
                        *sitr = stackm.columnnamemapper.GetReverseMapping(*it);
                        final_size += sitr->size();
                }
        }

        packet->columndata.resize(final_size);
        uint8_t *ptr = packet->columndata.begin();

        Blex::PutLsb<uint32_t>(ptr, strings.size());
        ptr += 4;

        for (Blex::PodVector< Blex::StringPair >::iterator it = strings.begin(); it != strings.end(); ++it)
        {
                Blex::PutLsb<uint8_t>(ptr++, static_cast<uint8_t>(it->size()));
                std::copy (it->begin, it->end, ptr);
                ptr += it->size();
        }
}

void Marshaller::WriteInternal(VarId var, uint8_t *begin, uint8_t *limit, MarshalPacket *packet)
{
        if (data_size == 0)
            ThrowInternalError("Marshalling: no Analyze called before Write!");
        if (static_cast< size_t >(limit - begin) < data_size)
            ThrowInternalError("Not enough room in data storage to marshal data");
#ifdef DEBUG
        Blex::FileOffset oldsize = data_size;
        AnalyzeInternal(var, packet != 0);
        if (data_size != oldsize)
            ThrowInternalError("Variable changed between two call of Analyze and Write");
#endif

//        DEBUGPRINT("Writing to normal space by " << this << ", have encoder: " << bool(library_column_encoder));

        if (!packet && library_column_encoder && largeblobs)
            ThrowInternalError("Cannot write blobs >4GB to libraries");

        uint8_t *ptr = begin;
        Blex::PutLsb<uint8_t>(ptr++, packet
            ? MarshalPacketFormatType
            : (library_column_encoder
                    ? MarshalLibraryFormatType
                    : (largeblobs ? MarshalFormatType_largeblobs : MarshalFormatType)));

        if (!packet)
        {
                Blex::PutLsb<uint32_t>(ptr, columns.size());
                ptr += 4;

                if (!columns.empty())
                {
                        if (library_column_encoder)
                        {
                                for (Blex::PodVector< ColumnNameId >::iterator it = columns.begin(); it != columns.end(); ++it)
                                {
                                        Blex::PutLsb<uint32_t>(ptr, library_column_encoder(*it));
                                        ptr += 4;
                                }
                        }
                        else
                        {
                                for (Blex::PodVector< ColumnNameId >::iterator it = columns.begin(); it != columns.end(); ++it)
                                {
                                        Blex::StringPair name = stackm.columnnamemapper.GetReverseMapping(*it);
                                        Blex::PutLsb<uint8_t>(ptr++, static_cast<uint8_t>(name.size()));
                                        std::copy (name.begin, name.end, ptr);
                                        ptr += name.size();
                                }
                        }
                }
        }

        Blex::PutLsb<uint8_t>(ptr++, stackm.GetType(var));
        ptr = MarshalWriteInternal(var, ptr, packet);
        if (ptr != limit)
        {
                if (ptr < limit)
                    Blex::SafeErrorPrint("Internal error: MarshalWriter::Write overflowed its buffer!\n");
                else
                    Blex::SafeErrorPrint("Internal error: MarshalWriter::Write did not fill its buffer!\n");
                Blex::FatalAbort();
        }
        if (packet)
            WritePacketColumns(packet);
}

void Marshaller::Write(VarId var, uint8_t *begin, uint8_t *limit)
{
        WriteInternal(var, begin, limit, 0);
}


MarshalPacket * Marshaller::WriteToNewPacket(VarId var)
{
        std::unique_ptr< MarshalPacket > packet;
        if (!packets.empty())
        {
                packet.reset(packets.front());
                packets.pop_front();
        }
        else
            packet.reset(new MarshalPacket());

        AnalyzeInternal(var, true);
        packet->data.resize(data_size);
        uint8_t *begin = data_size == 0 ? (uint8_t*)0 : &packet->data[0];
        WriteInternal(var, begin, begin + data_size, packet.get());

        return packet.release();
}

void Marshaller::WriteToVector(VarId var, std::vector< uint8_t > *data)
{
        Analyze(var);
        data->resize(data_size);
        assert(data_size > 0);
        uint8_t *begin = &(*data)[0];
        Write(var, begin, begin + data_size);
}

void Marshaller::WriteToPodVector(VarId var, Blex::PodVector< uint8_t > *data)
{
        Analyze(var);
        data->resize(data_size);
        assert(data_size > 0);
        uint8_t *begin = &(*data)[0];
        Write(var, begin, begin + data_size);
}


namespace
{

void EatBytesError(size_t &remainingsize, size_t bytes)
{
        ThrowInternalError("Encountered truncated marshal-packet, need at least " + Blex::AnyToString(bytes - remainingsize) + " bytes");
}

inline void EatBytes(size_t &remainingsize, size_t bytes)
{
        if (remainingsize < bytes)
            EatBytesError(remainingsize, bytes);
        remainingsize -= bytes;
}

}

uint8_t const * Marshaller::MarshalReadInternal(VarId var, VariableTypes::Type type, uint8_t const *ptr, size_t remainingsize, Blex::PodVector< ColumnNameId > const &nameids, MarshalPacket *packet)
{
        if (type & VariableTypes::Array)
        {
                EatBytes(remainingsize, 4);
                unsigned eltcount = Blex::GetLsb<int32_t>(ptr);
                ptr += 4;

                stackm.InitVariable(var, type);
                if (type == VariableTypes::VariantArray)
                {
                        for (unsigned idx = 0; idx < eltcount; ++idx)
                        {
                                VarId elt = stackm.ArrayElementAppend(var);

                                EatBytes(remainingsize, 1);
                                VariableTypes::Type elttype = static_cast<VariableTypes::Type>(Blex::GetLsb<uint8_t>(ptr++));

                                ptr = MarshalReadInternal(elt, elttype, ptr, remainingsize, nameids, packet);
                        }
                }
                else
                {
                        VariableTypes::Type elttype = static_cast<VariableTypes::Type>(stackm.GetType(var) & ~VariableTypes::Array);
                        if (eltcount)
                            stackm.ArrayResize(var, eltcount);

                        for (unsigned idx = 0; idx < eltcount; ++idx)
                        {
                                VarId elt = stackm.ArrayElementGet(var, idx);
                                ptr = MarshalReadInternal(elt, elttype, ptr, remainingsize, nameids, packet);
                        }
                }
                return ptr;
        }

        switch (type)
        {
        case VariableTypes::Integer:
                EatBytes(remainingsize, 4);
                stackm.SetInteger(var, Blex::GetLsb<int32_t>(ptr));
                return ptr + 4;
        case VariableTypes::Integer64:
                EatBytes(remainingsize, 8);
                stackm.SetInteger64(var, Blex::GetLsb<int64_t>(ptr));
                return ptr + 8;
        case VariableTypes::Money:
                EatBytes(remainingsize, 8);
                stackm.SetMoney(var, Blex::GetLsb<int64_t>(ptr));
                return ptr + 8;
        case VariableTypes::Float:
                EatBytes(remainingsize, 8);
                stackm.SetFloat(var, Blex::GetLsb<F64>(ptr));
                return ptr + 8;
        case VariableTypes::Boolean:
                EatBytes(remainingsize, 1);
                stackm.SetBoolean(var, Blex::GetLsb<uint8_t>(ptr));
                return ptr + 1;
        case VariableTypes::DateTime:
                EatBytes(remainingsize, 8);
                stackm.SetDateTime(var,Blex::DateTime(Blex::GetLsb<uint32_t>(ptr),Blex::GetLsb<uint32_t>(ptr+4)));
                return ptr+8;
        case VariableTypes::String:
                {
                        EatBytes(remainingsize, 4);
                        unsigned size = Blex::GetLsb<uint32_t>(ptr);
                        ptr += 4;
                        EatBytes(remainingsize, size);
                        stackm.SetString(var, reinterpret_cast<const char*>(ptr), reinterpret_cast<const char*>(ptr) + size);
                        return ptr + size;
                }
        case VariableTypes::Blob:
                {
                        if (packet)
                        {
                                EatBytes(remainingsize, 4);
                                unsigned blobnr = Blex::GetLsb<uint32_t>(ptr);

                                if (blobnr > packet->blobs.size())
                                    ThrowInternalError("Malformed marshal-packet, illegal blob id");

                                if (blobnr == 0 || !vm)
                                {
                                        stackm.InitVariable(var, VariableTypes::Blob);
                                }
                                else
                                {
                                        stackm.SetBlob(var, vm->GetBlobManager().BuildBlobFromGlobalBlob(vm, packet->blobs[blobnr - 1]->blob));
                                }

                                return ptr + 4;
                        }
                        else
                        {
                                Blex::FileOffset size;
                                if (largeblobs)
                                {
                                        EatBytes(remainingsize, 8);
                                        size = Blex::GetLsb< uint64_t >(ptr);
                                        ptr += 8;
                                }
                                else
                                {
                                        EatBytes(remainingsize, 4);
                                        size = Blex::GetLsb< uint32_t >(ptr);
                                        ptr += 4;
                                }

                                if (size==0 || (!vm && mode == MarshalMode::SimpleOnly)) //empty blob
                                    stackm.InitVariable(var, VariableTypes::Blob);
                                else if (!vm)
                                    ThrowInternalError("Cannot marshall non-empty blobs without a running virtual machine");
                                else
                                {
                                        EatBytes(remainingsize, size);
                                        HSVM_MakeBlobFromMemory(*vm, var, size, ptr);
                                }

                                ptr += size;
                                return ptr;
                        }
                }
        case VariableTypes::VMRef:
                {
                        ThrowInternalError("Can only marshal live function pointers between a VM and a weblet");
                }

        case VariableTypes::FunctionRecord:
        case VariableTypes::Record:
                {
                        // Element count
                        EatBytes(remainingsize, 4);
                        int32_t eltcount = Blex::GetLsb<int32_t>(ptr);
                        ptr += 4;
                        if (eltcount < 0)
                        {
                                if (type == VariableTypes::Record)
                                    stackm.RecordInitializeNull(var);
                                else
                                    stackm.FunctionRecordInitializeEmpty(var);
                                return ptr;
                        }
                        if (type == VariableTypes::Record)
                            stackm.RecordInitializeEmpty(var);
                        else
                        {
                                stackm.FunctionRecordInitializeEmpty(var);
                                if (eltcount > 0)
                                    ThrowInternalError("Corrupt marshal packet: found a non-default function ptr");
                        }

                        unsigned nameids_size = nameids.size(); // Slow division...

                        for (int32_t idx = 0; idx != eltcount; ++idx)
                        {
                                EatBytes(remainingsize, 4);
                                uint32_t namenr = Blex::GetLsb< uint32_t >(ptr);
                                if (namenr >= nameids_size)
                                    ThrowInternalError("Corrupt marshal packet: column name nr out of range");
                                ptr += 4;

                                ColumnNameId nameid = nameids[namenr];
                                VarId elt = stackm.RecordCellCreate(var, nameid);

                                EatBytes(remainingsize, 1);
                                VariableTypes::Type celltype = static_cast<VariableTypes::Type>(Blex::GetLsb<uint8_t>(ptr++));
                                ptr = MarshalReadInternal(elt, celltype, ptr, remainingsize, nameids, packet);
                        }
                        return ptr;
                }
        case VariableTypes::Object:
                {
                        if (packet && (vm || mode != MarshalMode::SimpleOnly))
                        {
                                EatBytes(remainingsize, 4);
                                unsigned objectnr = Blex::GetLsb<uint32_t>(ptr);
                                ptr += 4;

                                if (objectnr > packet->objects.size())
                                    ThrowInternalError("Corrupt marshal packet: object nr out of range");

                                if (objectnr == 0)
                                   stackm.ObjectInitializeDefault(var);
                                else
                                {
                                        if (!vm)
                                            ThrowInternalError("Can only restore objects when a VM is present");

                                        ObjectMarshalData &data = *packet->objects[objectnr - 1];
                                        if (!data.data)
                                        {
                                                stackm.CopyFrom(var, data.varid);
                                                stackm.ObjectInitializeDefault(var);
                                        }
                                        else
                                        {
                                                void *mdata = data.data;
                                                data.data = 0;
                                                bool success = data.restorefunc(*vm, var, mdata);
                                                if (!success)
                                                    ThrowInternalError("Failed to restore an object from marshal data");
                                                data.varid = var;
                                        }
                                }
                        }
                        else
                           stackm.ObjectInitializeDefault(var);
                        return ptr;
                }
        case VariableTypes::WeakObject:
                {
                        stackm.WeakObjectInitializeDefault(var);
                        return ptr;
                }
        default:
            // Blob, Table
            ThrowInternalError("Corrupt marshal packet, encountered variable type " + GetTypeName(type));
        }
        return 0;
}

void Marshaller::ReadColumnData(uint8_t const **ptr, size_t *size, Blex::PodVector< ColumnNameId > *nameids)
{
        nameids->clear();

        EatBytes(*size, 4);
        uint32_t eltcount = Blex::GetLsb<uint32_t>(*ptr);
        *ptr += 4;

        if (eltcount != 0)
        {
                nameids->resize(eltcount);
                if (use_library_column_list)
                {
                        for (Blex::PodVector< ColumnNameId >::iterator it = nameids->begin(), end = nameids->end(); it != end; ++it)
                        {
                                EatBytes(*size, 4);
                                // FIXME bounds check!
                                uint32_t id = Blex::GetLsb<uint32_t>(*ptr);
                                if (id >= library_column_list->size())
                                    ThrowInternalError("Illegal column id detected!");
                                *it = (*library_column_list)[id];
                                *ptr += 4;
                        }
                }
                else
                {
                        for (Blex::PodVector< ColumnNameId >::iterator it = nameids->begin(), end = nameids->end(); it != end; ++it)
                        {
                                EatBytes(*size, 1);
                                uint8_t colnamelen = Blex::GetLsb<uint8_t>((*ptr)++);

                                EatBytes(*size, colnamelen);
                                *it = stackm.columnnamemapper.GetMapping(colnamelen, (char const *)(*ptr));
                                *ptr += colnamelen;
                        }
                }
        }
}

void Marshaller::ReadInternal(VarId var, uint8_t const *begin, uint8_t const *limit, MarshalPacket *packet)
{
        if (!vm && mode != MarshalMode::SimpleOnly)
            ThrowInternalError("Cannot restore blobs or objects without a VM!");

        assert(limit >= begin);
        size_t size = limit - begin;
        if (size < (packet ? 2 : 6)) // Packet: (uint8_t version, uint8_t type) other: (uint8_t version, uint8_t type, uint32_t columncount)
            ThrowInternalError("Malformed marshalling packet!");

        largeblobs = false;

        uint8_t const *ptr = begin;
        uint8_t version = Blex::GetLsb<uint8_t>(ptr++);
        if (packet)
        {
                if (version != MarshalPacketFormatType)
                    ThrowInternalError("Marshalling protocol version mismatch, packet vs non-packet");
        }
        else
        {
                if (version == MarshalFormatType || version == MarshalFormatType_largeblobs)
                {
                        use_library_column_list = false;
                        if (version == MarshalFormatType_largeblobs)
                            largeblobs = true;
                }
                else if (version == MarshalLibraryFormatType)
                {
                        if (!library_column_list)
                            ThrowInternalError("Marshalling protocol version mismatch, got library version but didn't have an associated library");
                        use_library_column_list = true;
                }
                else
                    ThrowInternalError("Unsupported marshalling protocol version " + Blex::AnyToString(version) + ", please upgrade");
        }
        EatBytes(size, 1);

//        Blex::PodVector< ColumnNameId > nameids;
        columns.clear();

        if (!packet)
            ReadColumnData(&ptr, &size, &columns);
        else
        {
                uint8_t const *colptr = &packet->columndata[0];
                size_t colsize = packet->columndata.size();
                if (colsize)
                {
                        ReadColumnData(&colptr, &colsize, &columns);
                        if (colsize)
                            ThrowInternalError("Malformed marshalling packet!");
                }
        }

        EatBytes(size, 1);
        VariableTypes::Type type = static_cast<VariableTypes::Type>(Blex::GetLsb<uint8_t>(ptr++));
        assert(ptr + size == limit);

        // Clear varids for objects
        if (packet)
        {
                for (auto itr: packet->objects)
                    itr->varid = 0;
        }

        ptr = MarshalReadInternal(var, type, ptr, size, columns, packet);
        if (ptr != limit)
            ThrowInternalError("Garbage at end of marshalling packet, got " + Blex::AnyToString(std::distance(ptr, limit)) + " bytes left");
}

void Marshaller::ReadFromVector(VarId var, std::vector< uint8_t > const &data)
{
        if (data.empty())
            ThrowInternalError("Malformed marshal data");
        uint8_t const *begin = &data[0];
        Read(var, begin, begin + data.size());
}

void Marshaller::ReadFromVector(VarId var, Blex::PodVector< uint8_t > const &data)
{
        if (data.empty())
            ThrowInternalError("Malformed marshal data");
        uint8_t const *begin = &data[0];
        Read(var, begin, begin + data.size());
}

void Marshaller::ReadMarshalPacket(VarId var, std::unique_ptr< MarshalPacket > *packet)
{
        if ((*packet)->data.empty())
            ThrowInternalError("Malformed marshal packet");
        uint8_t const *begin = &(*packet)->data[0];
        ReadInternal(var, begin, begin + (*packet)->data.size(), packet->get());

        // Limited buffer
        if (packets.size() < 8)
        {
                (*packet)->Reset();
                packets.push_back(0);
                packets.back() = packet->release();
        }
}

// --------------------------------------------------------------------------
//
// MarshallerLibraryColumnEncoderItf
//

MarshallerLibraryColumnEncoderItf::~MarshallerLibraryColumnEncoderItf()
{
}

} // End of namespace HareScript
