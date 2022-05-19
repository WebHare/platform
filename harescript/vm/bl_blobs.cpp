//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>


#include <blex/path.h>
#include <blex/docfile.h>
#include <blex/unicode.h>
#include "hsvm_dllinterface_blex.h"
#include "baselibs.h"
//#include "hsvm_context.h"

#include <fstream>
#include <aws/core/Aws.h>
#include <aws/core/auth/AWSCredentials.h>
#include <aws/core/utils/logging/AWSLogging.h>
#include <aws/core/utils/logging/DefaultLogSystem.h>
#include <aws/s3/S3Client.h>
#include <aws/s3/model/GetObjectRequest.h>


#define SHOW_S3

//#define DUMP_BINARY_ENCODING


#ifdef SHOW_S3
 #define S3_PRINT(x) DEBUGPRINT("S3: " << x)
 #define S3_ONLY(x) DEBUGONLY(x)
 #define S3_ONLYRAW(x) DEBUGONLYARG(x)
#else
 #define S3_PRINT(x) BLEX_NOOP_STATEMENT
 #define S3_ONLY(x) BLEX_NOOP_STATEMENT
 #define S3_ONLYRAW(x)
#endif


//---------------------------------------------------------------------------
//
// This library adds backend support functions for Blob management
//
//---------------------------------------------------------------------------

namespace HareScript {
namespace Baselibs {

std::string MakeProperUTF8(std::string const &indata)
{
        std::string retval;

        //Do we need a conversion map?
        const uint32_t *data_charset = Blex::GetCharsetConversiontable(Blex::Charsets::CP1252);

        /* Map and encode every character */
        Blex::UTF8Encoder< std::back_insert_iterator< std::string > > utf8enc (std::back_inserter(retval));
        for (std::string::const_iterator pos=indata.begin();pos!=indata.end();++pos)
        {
                uint8_t in_ch = static_cast<uint8_t>(*pos);
                utf8enc(in_ch == 0 ? '_' : data_charset[in_ch]);
        }

        return retval;
}

void MakeBlob(VarId id_set, VirtualMachine *vm)
{
        int32_t newblob = HSVM_CreateStream(*vm);
        HSVM_IntegerSet(*vm, id_set, newblob);
}

void GetStreamLength(VarId id_set, VirtualMachine *vm)
{
        int32_t streamid = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        HSVM_Integer64Set(*vm, id_set, HSVM_GetStreamLength(*vm, streamid));
}

void GetStreamPointer(VarId id_set, VirtualMachine *vm)
{
        int32_t streamid = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        HSVM_Integer64Set(*vm, id_set, HSVM_GetStreamOffset(*vm, streamid));
}

void SetStreamPointer(VirtualMachine *vm)
{
        int32_t streamid = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        int64_t offset = HSVM_Integer64Get(*vm, HSVM_Arg(1));
        if (offset < 0)
            HSVM_ThrowException(*vm, "Cannot set the blob stream offset to a negative value");
        if (!HSVM_SetStreamOffset(*vm, streamid, offset))
            HSVM_ThrowException(*vm, "Could not set blob stream offset");
}

void FinishBlob(VarId id_set, VirtualMachine *vm)
{
        int32_t streamid = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        HSVM_MakeBlobFromStream(*vm, id_set, streamid);
}

void GetBlobModTime(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();
        stackm.SetDateTime(id_set, stackm.GetBlob(HSVM_Arg(0)).GetModTime());
}

void GetBlobDescription(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();
        stackm.SetSTLString(id_set, stackm.GetBlob(HSVM_Arg(0)).GetDescription());
}

void SendBlobTo(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        int32_t print_id = stackm.GetInteger(HSVM_Arg(0));
        HareScript::Interface::InputStream data(*vm, HSVM_Arg(1));

        Blex::PodVector<uint8_t> tempbuf(16384);

        bool success=true;
        while(success)
        {
                unsigned bytes=data.Read(&tempbuf[0],16384);
                if (bytes==0)
                    break; //EOF

                success=HSVM_PrintTo(*vm, print_id, bytes, &tempbuf[0]);
        }
        HSVM_BooleanSet(*vm, id_set, success);
}

void DumpProp(VarId id_set, HSVM *vm, Blex::OlePropertySet const &ops, unsigned storeid)
{
        switch(ops.GetType(storeid))
        {
        case Blex::OlePropertySet::V_SignedInteger:
                HSVM_IntegerSet(vm, id_set, (int32_t)ops.GetSigInteger(storeid));
                break;
        case Blex::OlePropertySet::V_UnsignedInteger:
                HSVM_IntegerSet(vm, id_set, (int32_t)ops.GetUnsInteger(storeid));
                break;
        case Blex::OlePropertySet::V_Float:
                HSVM_FloatSet(vm, id_set, ops.GetFloat(storeid));
                break;
        case Blex::OlePropertySet::V_DateTime:
                GetVirtualMachine(vm)->GetStackMachine().SetDateTime(id_set, ops.GetDateTime(storeid));
                break;
        case Blex::OlePropertySet::V_String:
                HSVM_StringSetSTD(vm, id_set, ops.GetString(storeid));
                break;
        case Blex::OlePropertySet::V_Array:
                {
                        HSVM_ColumnId coldata = HSVM_GetColumnId(vm, "DATA");
                        HSVM_SetDefault(vm, id_set, HSVM_VAR_RecordArray);
                        for (unsigned i=0;i<ops.GetArrayLength(storeid);++i)
                        {
                                HSVM_VariableId elementid = HSVM_ArrayAppend(vm, id_set);
                                HSVM_VariableId cellid = HSVM_RecordCreate(vm, elementid, coldata);
                                DumpProp(cellid, vm, ops, ops.GetArrayElement(storeid, i));
                        }
                        break;
                }
        default:
                HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);
                break;
        }
}

void DumpPropSet(VarId id_set, HSVM *vm, Blex::OlePropertySet const &ops, unsigned seqnum)
{
        HSVM_ColumnId colid = HSVM_GetColumnId(vm, "ID");
        HSVM_ColumnId coldata = HSVM_GetColumnId(vm, "DATA");
        HSVM_ColumnId colprops = HSVM_GetColumnId(vm, "PROPERTIES");
        HSVM_ColumnId colformat = HSVM_GetColumnId(vm, "__FORMATID");

        Blex::OlePropertySet::Section const &sect = ops.GetSection(seqnum);

        HSVM_StringSet(vm,
                       HSVM_RecordCreate(vm, id_set, colformat),
                       reinterpret_cast<char const*>(sect.format_id),
                       reinterpret_cast<char const*>(sect.format_id) + 16);

        HSVM_VariableId var_props = HSVM_RecordCreate(vm, id_set, colprops);
        HSVM_SetDefault(vm, var_props, HSVM_VAR_RecordArray);

        typedef Blex::OlePropertySet::Section::PropertyMap PropMap;
        for (PropMap::const_iterator itr=sect.props.begin(); itr !=sect.props.end(); ++itr)
        {
                HSVM_VariableId newrec = HSVM_ArrayAppend(vm, var_props);
                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, newrec, colid), itr->first);
                DumpProp(HSVM_RecordCreate(vm, newrec, coldata), vm, ops, itr->second);
        }
}

void DumpPropsDir(VarId id_set, HSVM *vm, Blex::Docfile &infile, Blex::Docfile::Directory const *dir)
{
        std::vector<std::string> files = infile.GetFiles(dir);
        for (std::vector<std::string>::iterator itr=files.begin(); itr!=files.end(); ++itr)
          if (!itr->empty() && itr->begin()[0]==5) //property set
        {
                try
                {
                        std::unique_ptr<Blex::RandomStream> str(infile.OpenOleFile(infile.FindFile(dir,*itr)));
                        Blex::OlePropertySet ops;
                        if (!str.get() || !ops.ParseProperties(*str))
                            continue;

                        HSVM_ColumnId colid = HSVM_GetColumnId(vm, "NAME");
                        HSVM_ColumnId colprops = HSVM_GetColumnId(vm, "SECTIONS");

                        HSVM_VariableId newrec = HSVM_ArrayAppend(vm, id_set);
                        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, newrec, colid), *itr);
                        HSVM_VariableId recarray = HSVM_RecordCreate(vm, newrec, colprops);
                        HSVM_SetDefault(vm, recarray, HSVM_VAR_RecordArray);

                        for (unsigned i=0;i<ops.GetNumSections();++i)
                            DumpPropSet(HSVM_ArrayAppend(vm, recarray), vm, ops, i);
                }
                catch (Blex::DocfileException &e)
                {
                        DEBUGPRINT("Ignoring OLE error on file " << *itr << ":" << e.what());
                }
        }
}

void HS_UnpackOleProps(VarId id_set, VirtualMachine *vm)
{
        HareScript::Interface::InputStream data(*vm, HSVM_Arg(0));

        try
        {
                std::unique_ptr<Blex::Docfile> docfile;    //ADDME: Split: BCB work around
                docfile.reset( new Blex::Docfile(data) );
                uint8_t const *clsid = docfile->GetCLSID(docfile->GetRoot());

                ColumnNameId colclsid = vm->columnnamemapper.GetMapping("__CLSID");
                ColumnNameId colpropsets = vm->columnnamemapper.GetMapping("PROPSETS");

                vm->GetStackMachine().RecordInitializeEmpty(id_set);
                VarId clsidcell = vm->GetStackMachine().RecordCellCreate(id_set, colclsid);
                VarId propsetscell = vm->GetStackMachine().RecordCellCreate(id_set, colpropsets);

                vm->GetStackMachine().SetString(clsidcell, reinterpret_cast<char const*>(clsid), reinterpret_cast<char const*>(clsid+16));
                vm->GetStackMachine().ArrayInitialize(propsetscell,0,VariableTypes::RecordArray);
                DumpPropsDir(propsetscell, *vm, *docfile, docfile->GetRoot());
        }
        catch (Blex::DocfileException &)
        {
                vm->GetStackMachine().InitVariable(id_set, VariableTypes::Record); //return default record
        }
}

///////////////////////////////////////////////////////////////////////////////
//
// Composed blob
//

class ComposedBlob : public BlobBase
{
    private:
        struct Blob
        {
                BlobRefPtr blobref;
                Blex::FileOffset length;
        };

        struct Part
        {
                unsigned blobnr;
                Blex::FileOffset start;
                Blex::FileOffset length;
                Blex::FileOffset offset;
        };

        class PartLess
        {
            public:
                bool operator()(Blex::FileOffset offset, ComposedBlob::Part const &part)
                {
                        return offset < part.offset;
                }
        };

        std::vector< Blob > blobs;
        std::vector< Part > parts;
        Blex::FileOffset length;

        class MyOpenedBlob: public OpenedBlobBase< ComposedBlob >
        {
            private:
                std::vector< std::unique_ptr< OpenedBlob > > openedblobs;

            public:
                MyOpenedBlob(ComposedBlob &_blob, std::vector< std::unique_ptr< OpenedBlob > > &&_openedblobs) : OpenedBlobBase< ComposedBlob >(_blob), openedblobs(std::move(_openedblobs)) {}

                std::size_t DirectRead(Blex::FileOffset startoffset, std::size_t numbytes, void *buffer);
        };

        unsigned RegisterBlob(BlobRefPtr blobref);

    public:
        struct BlobDef
        {
                BlobRefPtr blobref;
                Blex::FileOffset start;
                Blex::FileOffset length;
        };

        /** Constructor */
        ComposedBlob(VirtualMachine *_vm, std::vector< BlobDef > &&defs);

        ~ComposedBlob();

        std::unique_ptr< OpenedBlob > OpenBlob();
        Blex::FileOffset GetCacheableLength();
        Blex::DateTime GetModTime();
        std::string GetDescription();

        friend class PartLess;
};

ComposedBlob::ComposedBlob(VirtualMachine *vm, std::vector< BlobDef > &&defs)
: BlobBase(vm)
{
        length = 0;

        for (auto itr: defs)
        {
                parts.push_back({ RegisterBlob(itr.blobref), itr.start, itr.length, length });
                length += itr.length;
        }
}

ComposedBlob::~ComposedBlob()
{
}

unsigned ComposedBlob::RegisterBlob(BlobRefPtr blobref)
{
        for (unsigned idx = 0, e = blobs.size(); idx != e; ++idx)
            if (blobs[idx].blobref.GetPtr() == blobref.GetPtr())
                return idx;

        Blex::FileOffset length = blobref.GetLength();
        unsigned retval = blobs.size();
        blobs.push_back({ blobref, length });
        return retval;
}


std::size_t ComposedBlob::MyOpenedBlob::DirectRead(Blex::FileOffset startoffset, std::size_t numbytes, void *buffer)
{
        // Guard agains reading past end (startoffset is never negative)
        if (startoffset >= blob.length)
            return 0;
        if (blob.length - startoffset < numbytes)
            numbytes = blob.length - startoffset;

        // Find the last part that has an equal or lower offset (one below the first part with higher offset)
        std::vector< ComposedBlob::Part >::iterator it = std::upper_bound(blob.parts.begin(), blob.parts.end(), startoffset, PartLess());
        if (it == blob.parts.begin()) // Can never happen!
            throw std::logic_error("Internal error reading from composed blob - did not find relevant part");
        --it;

        startoffset -= it->offset;
        char *cbuffer = static_cast< char * >(buffer);

        int totalcopied = 0;
        for (; it != blob.parts.end() && numbytes; ++it)
        {
                // Max nr of chars to get from this part
                int tocopy = std::min< Blex::FileOffset >(numbytes, it->length - startoffset);

                // Read the data
                int copied = openedblobs[it->blobnr]->DirectRead(startoffset + it->start, tocopy, cbuffer);

                // Administer
                totalcopied += copied;
                cbuffer += copied;
                numbytes -= copied;
                startoffset += copied;

                // If we didn't get all bytes we wanted, break off
                if (startoffset != it->length)
                    break;

                startoffset -= it->length;
        }

        return totalcopied;
}

std::unique_ptr< OpenedBlob > ComposedBlob::OpenBlob()
{
        std::vector< std::unique_ptr< OpenedBlob > > openedblobs;
        for (auto &blob: blobs)
        {
                auto openblob = blob.blobref.OpenBlob();
                if (!openblob)
                    return std::unique_ptr< OpenedBlob >();
                openedblobs.push_back(std::move(openblob));
        }
        return std::unique_ptr< OpenedBlob >(new MyOpenedBlob(*this, std::move(openedblobs)));
}

Blex::DateTime ComposedBlob::GetModTime()
{
        return Blex::DateTime::Invalid();
}

Blex::FileOffset ComposedBlob::GetCacheableLength()
{
        return length;
}

std::string ComposedBlob::GetDescription()
{
        std::string descr = "composed:[";
        Blex::SemiStaticPodVector< char, 16384 > buffer;
        for (std::vector< ComposedBlob::Blob >::iterator it = blobs.begin(); it != blobs.end(); ++it)
        {
                if (it != blobs.begin())
                    descr += ",";

                descr = descr + it->blobref.GetDescription();
        }
        descr += "]";
        return descr;
}

void MakeComposedBlob(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Blob);

        std::vector< ComposedBlob::BlobDef > defs;

        HSVM_ColumnId col_data = HSVM_GetColumnId(*vm, "DATA");
        HSVM_ColumnId col_length = HSVM_GetColumnId(*vm, "LENGTH");
        HSVM_ColumnId col_start = HSVM_GetColumnId(*vm, "START");

        unsigned len = HSVM_ArrayLength(*vm, HSVM_Arg(0));
        for (unsigned idx = 0; idx < len; ++idx)
        {
                HSVM_VariableId elt = HSVM_ArrayGetRef(*vm, HSVM_Arg(0), idx);
                HSVM_VariableId var_data = HSVM_RecordGetRequiredTypedRef(*vm, elt, col_data, HSVM_VAR_Blob);
                if (!var_data) return;
                HSVM_VariableId var_start = HSVM_RecordGetRef(*vm, elt, col_start);
                if (var_start && !HSVM_CastTo(*vm, var_start, HSVM_VAR_Integer64)) return;
                HSVM_VariableId var_length = HSVM_RecordGetRef(*vm, elt, col_length);
                if (var_length && !HSVM_CastTo(*vm, var_length, HSVM_VAR_Integer64)) return;

                BlobRefPtr blobref = stackm.GetBlob(var_data);
                Blex::FileOffset bloblength = blobref.GetLength();
                int64_t i_start = var_start ? stackm.GetInteger64(var_start) : 0;
                int64_t i_length = var_length ? stackm.GetInteger64(var_length) : std::numeric_limits< int64_t >::max();

                // Negative length can be ignored
                if (i_length < 0)
                    continue;

                // Negative start: read the overlapping part
                if (i_start < 0)
                {
                        i_length += i_start;
                        i_start = 0;
                        if (i_length < 0)
                            continue;
                }

                Blex::FileOffset start = i_start, length = i_length;

                if (start >= bloblength)
                     continue;

                // Don't read past the end of the blob
                if (bloblength - start < length)
                {
                        length = bloblength - start;
                }

                // ADDME: destructure referenced composed blobs

                defs.push_back({ blobref, static_cast< Blex::FileOffset >(start), static_cast< Blex::FileOffset >(length) });
        }

        stackm.SetBlob(id_set, BlobRefPtr(new ComposedBlob(vm, std::move(defs))));
}

///////////////////////////////////////////////////////////////////////////////
//
// S3 blob
//

class S3Blob : public BlobBase
{
    private:
        class MyOpenedBlob: public OpenedBlobBase< S3Blob >
        {
            public:
                MyOpenedBlob(S3Blob &_blob) : OpenedBlobBase< S3Blob >(_blob) {}

                std::size_t DirectRead(Blex::FileOffset startoffset, std::size_t numbytes, void *buffer);
        };

        std::string region;
        std::string endpointoverride;
        std::string accesskey;
        std::string secretkey;
        std::string bucket_name;
        std::string object_name;

    public:
        /** Constructor */
        S3Blob(VirtualMachine *_vm, std::string region, std::string endpointoverride, std::string accesskey, std::string secretkey, std::string bucket_name, std::string object_name, Blex::FileOffset length);

        ~S3Blob();

        std::unique_ptr< OpenedBlob > OpenBlob();
        Blex::FileOffset GetCacheableLength();
        Blex::DateTime GetModTime();
        std::string GetDescription();
        Blex::FileOffset length;
};

S3Blob::S3Blob(VirtualMachine *_vm, std::string _region, std::string _endpointoverride, std::string _accesskey, std::string _secretkey, std::string _bucket_name, std::string _object_name, Blex::FileOffset _length)
: BlobBase(_vm)
, region(_region)
, endpointoverride(_endpointoverride)
, accesskey(_accesskey)
, secretkey(_secretkey)
, bucket_name(_bucket_name)
, object_name(_object_name)
, length(_length)
{
}

S3Blob::~S3Blob()
{
}

std::size_t S3Blob::MyOpenedBlob::DirectRead(Blex::FileOffset startoffset, std::size_t numbytes, void *buffer)
{
        S3_PRINT("Firing request for " << blob.bucket_name << " " << blob.object_name << " " << startoffset << " " << numbytes << ", len: " << blob.length);

        if (startoffset >= blob.length || !numbytes)
            return 0;
        if (numbytes > blob.length)
            numbytes = blob.length;
        if (blob.length - numbytes < startoffset)
            numbytes = blob.length - startoffset;

        Aws::Client::ClientConfiguration clientconfig;
        if (!blob.region.empty())
            clientconfig.region = Aws::String(blob.region);
        if (!blob.endpointoverride.empty())
            clientconfig.endpointOverride = Aws::String(blob.endpointoverride);
        Aws::Auth::AWSCredentials credentials(Aws::String(blob.accesskey), Aws::String(blob.secretkey));

        Aws::S3::S3Client s3_client(credentials, clientconfig);
        Aws::S3::Model::GetObjectRequest object_request;
        object_request.SetBucket(Aws::String(blob.bucket_name));
        object_request.SetKey(Aws::String(blob.object_name));
        object_request.SetRange(Aws::String("bytes=" + Blex::AnyToString(startoffset) + "-" + Blex::AnyToString(startoffset + numbytes - 1)));

        auto res = s3_client.GetObject(object_request);
        if (res.IsSuccess())
        {
                auto &data = res.GetResultWithOwnership().GetBody();

                S3_PRINT("Is success, reading");
                data.read(static_cast< char * >(buffer), numbytes);
                std::streamsize readbytes = data.gcount();
                S3_PRINT("Result: " << readbytes << " bytes read, good: " << data.good() << "bad: " << data.bad() << " fail: " << data.fail());
                if (data.bad())
                    return 0;
                return readbytes;
        }
        else
        {
                auto error = res.GetError();
                S3_PRINT("ERROR: " << error.GetExceptionName() << ": " << error.GetMessage());
                return 0;
        }
}

std::unique_ptr< OpenedBlob > S3Blob::OpenBlob()
{
        return std::unique_ptr< OpenedBlob >(new MyOpenedBlob(*this));
}

Blex::DateTime S3Blob::GetModTime()
{
        return Blex::DateTime::Invalid();
}

Blex::FileOffset S3Blob::GetCacheableLength()
{
        return length;
}

std::string S3Blob::GetDescription()
{
        return "s3blob(" + region + "," + endpointoverride + "," + bucket_name + "," + object_name + "," + Blex::AnyToString(length) + ")";
}

class AWSApiData
{
        Aws::SDKOptions options;
        bool initialized;
    public:
        ~AWSApiData();
        void EnsureInitialized();
};

AWSApiData::~AWSApiData()
{
        if (!initialized)
            return;

        Aws::ShutdownAPI(options);
        //Aws::Utils::Logging::ShutdownAWSLogging();

        initialized = false;
}

void AWSApiData::EnsureInitialized()
{
        if (initialized)
            return;
        initialized = true;
/*
        Aws::Utils::Logging::InitializeAWSLogging(
                Aws::MakeShared<Aws::Utils::Logging::DefaultLogSystem>(
                        "RunUnitTests", Aws::Utils::Logging::LogLevel::Trace, "aws_sdk_"));
*/
        Aws::InitAPI(options);
}

typedef Blex::InterlockedData< AWSApiData, Blex::Mutex > LockedAWSApiData;

LockedAWSApiData awsapidata;


void CreateS3Blob(VarId id_set, VirtualMachine *vm)
{
        LockedAWSApiData::WriteRef(awsapidata)->EnsureInitialized();

        StackMachine &stackm = vm->GetStackMachine();

        stackm.InitVariable(id_set, VariableTypes::Blob);

        std::string region, endpointoverride, accesskey, secretkey, bucket_name, object_name;
        Blex::FileOffset length;

        VarId var_region = stackm.RecordCellTypedRefByName(HSVM_Arg(0), stackm.columnnamemapper.GetMapping("REGION"), VariableTypes::String, false);
        if (var_region)
            region = stackm.GetSTLString(var_region);

        VarId var_endpointoverride = stackm.RecordCellTypedRefByName(HSVM_Arg(0), stackm.columnnamemapper.GetMapping("ENDPOINTOVERRIDE"), VariableTypes::String, false);
        if (var_endpointoverride)
            endpointoverride = stackm.GetSTLString(var_endpointoverride);

        VarId var_accesskey = stackm.RecordCellTypedRefByName(HSVM_Arg(0), stackm.columnnamemapper.GetMapping("ACCESSKEY"), VariableTypes::String, true);
        if (!var_accesskey)
            return;
        accesskey = stackm.GetSTLString(var_accesskey);

        VarId var_secretkey = stackm.RecordCellTypedRefByName(HSVM_Arg(0), stackm.columnnamemapper.GetMapping("SECRETKEY"), VariableTypes::String, true);
        if (!var_secretkey)
            return;
        secretkey = stackm.GetSTLString(var_secretkey);

        VarId var_bucket_name = stackm.RecordCellTypedRefByName(HSVM_Arg(0), stackm.columnnamemapper.GetMapping("BUCKET_NAME"), VariableTypes::String, false);
        if (var_bucket_name)
            bucket_name = stackm.GetSTLString(var_bucket_name);

        VarId var_object_name = stackm.RecordCellTypedRefByName(HSVM_Arg(0), stackm.columnnamemapper.GetMapping("OBJECT_NAME"), VariableTypes::String, true);
        if (!var_object_name)
           return;
        object_name = stackm.GetSTLString(var_object_name);

        VarId var_length = stackm.RecordCellTypedRefByName(HSVM_Arg(0), stackm.columnnamemapper.GetMapping("LENGTH"), VariableTypes::Integer64, true);
        if (!var_length)
           return;
        length = stackm.GetInteger64(var_length);

        stackm.SetBlob(id_set, BlobRefPtr(new S3Blob(vm, region, endpointoverride, accesskey, secretkey, bucket_name, object_name, length)));
}

///////////////////////////////////////////////////////////////////////////////
//
// Compression
//

int CompressStream_IOWriter(void *opaque_ptr, int numbytes, void const *data, int /*partial*/, int *error_result)
{
        SystemContextData::CompressingStream *str = static_cast<SystemContextData::CompressingStream*>(opaque_ptr);
        *error_result = 0;
        return str->inputdata->Write(data, numbytes);
}
/*void CompressStream_IOClose(void *opaque_ptr)
{
        SystemContextData::CompressingStream *str = static_cast<SystemContextData::CompressingStream*>(opaque_ptr);
        delete str;
}
*/
//ADDME Generic usable?
int DecompressStream_IOReader(void *opaque_ptr, int numbytes, void *data, int *error_result)
{
        *error_result = 0;
        return static_cast<SystemContextData::DecompressingStream*>(opaque_ptr)->outputdata->Read(data, numbytes);
}
/** Type of io end of stream function  */
int DecompressStream_IOEndOfStream(void *opaque_ptr)
{
        return static_cast<SystemContextData::DecompressingStream*>(opaque_ptr)->outputdata->EndOfStream();
}
/*void DecompressStream_IOClose(void *opaque_ptr)
{
        delete static_cast<SystemContextData::DecompressingStream*>(opaque_ptr);
}*/
void CreateZlibCompressor(VarId id_set, VirtualMachine *vm)
{
        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Integer);
        int32_t outputstreamid = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        SystemContext context(vm->GetContextKeeper());

        SystemContextData::CompressingStreamPtr newblob(new SystemContextData::CompressingStream);

        newblob->vm=*vm;
        newblob->outputdata.reset(new Interface::OutputStream(*vm, outputstreamid));

        int compressfactor = HSVM_IntegerGet(*vm, HSVM_Arg(2));
        if(compressfactor<0 or compressfactor>9)
        {
                HSVM_ReportCustomError(*vm, "Unrecognized compression factor");
                return;
        }

        std::string format = HSVM_StringGetSTD(*vm, HSVM_Arg(1));
        Blex::ZlibCompressStream::FileType filetype;

        if(format=="GZIP")
        {
                filetype = Blex::ZlibCompressStream::Gzip;
        }
        else if(format=="ZLIBRAW")
        {
                filetype = Blex::ZlibCompressStream::Raw;
        }
        else if(format=="ZIP")
        {
                filetype = Blex::ZlibCompressStream::Zip;
        }
        else
        {
                HSVM_ReportCustomError(*vm, "Unrecognized compression format");
                return;
        }

        newblob->inputdata.reset(new Blex::ZlibCompressStream(*newblob->outputdata, filetype, compressfactor));

        int outputid = HSVM_RegisterIOObject(*vm,
                                             newblob.get(),
                                             NULL,
                                             CompressStream_IOWriter,
                                             NULL,
                                             NULL/*CompressStream_IOClose*/,
                                             "ZLIB Compressor");
        context->compressingstreams[outputid] = newblob;
        HSVM_IntegerSet(*vm, id_set, outputid);
}
void CloseZlibCompressor(VarId id_set, VirtualMachine *vm)
{
        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);

        SystemContext context(vm->GetContextKeeper());
        int32_t id = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        if(!context->compressingstreams.count(id))
        {
                HSVM_ReportCustomError(*vm, "Invalid zlib compressor stream id");
                return;
        }

        HSVM_UnregisterIOObject(*vm, id);

        if (context->compressingstreams[id]->inputdata->GetFileType() != Blex::ZlibCompressStream::Raw)
        {
                char hash[Blex::CRC32HashLen];
                Blex::putu32msb(hash, context->compressingstreams[id]->inputdata->GetCRC32());
                HSVM_StringSet(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "CRC32")), hash, hash + Blex::CRC32HashLen);
        }
        context->compressingstreams[id].reset();
}
void OpenBlobAsDecompressingStream(VarId id_set, VirtualMachine *vm)
{
        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Integer);

        SystemContextData::DecompressingStreamPtr newblob(new SystemContextData::DecompressingStream);

        newblob->vm=*vm;
        newblob->inputdata.reset(new Interface::InputStream(*vm, HSVM_Arg(0)));
        if (HSVM_TestMustAbort(*vm))
            return; // VM

        std::string format = HSVM_StringGetSTD(*vm, HSVM_Arg(1));
        if (format=="ZLIB")
        {
                newblob->outputdata.reset(Blex::ZlibDecompressStream::OpenZlib(*newblob->inputdata));
        }
        else if(format=="GZIP")
        {
                newblob->outputdata.reset(Blex::ZlibDecompressStream::OpenGzip(*newblob->inputdata));
        }
        else if(Blex::StrCaseLike(format,"ZLIBRAW:*"))
        {
                std::pair<Blex::FileOffset, std::string::const_iterator> res =
                     Blex::DecodeUnsignedNumber<Blex::FileOffset>(format.begin() + 8, format.end());
                if (res.second != format.end())
                {
                       HSVM_ReportCustomError(*vm, "Unrecognized ZLIBRAW compression length");
                        return;
                }
                newblob->outputdata.reset(Blex::ZlibDecompressStream::OpenRaw(*newblob->inputdata, res.first));
        }
        else if(Blex::StrCaseLike(format,"ZLIBRAW"))
        {
                newblob->outputdata.reset(Blex::ZlibDecompressStream::OpenRaw(*newblob->inputdata, HSVM_BlobLength(*vm, HSVM_Arg(0))));
        }
        else
        {
                HSVM_ReportCustomError(*vm, "Unrecognized compression format");
        }
        if(!newblob->outputdata.get())
            return; //VM/Blob failure?

        int outputid = HSVM_RegisterIOObject(*vm,
                                             newblob.get(),
                                             DecompressStream_IOReader,
                                             NULL,
                                             DecompressStream_IOEndOfStream,
                                             NULL/*DecompressStream_IOClose*/,
                                             "Decompressing stream");
        SystemContext context(vm->GetContextKeeper());
        context->decompressingstreams[outputid] = newblob;
        HSVM_IntegerSet(*vm, id_set, outputid);
}
void CloseZlibDecompressor(VirtualMachine *vm)
{
        SystemContext context(vm->GetContextKeeper());
        int32_t id = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        if(!context->decompressingstreams.count(id))
        {
                HSVM_ReportCustomError(*vm, "Invalid zlib decompressor stream id");
                return;
        }
        HSVM_UnregisterIOObject(*vm, id);
        context->decompressingstreams[id].reset();
}

void InitBlob(BuiltinFunctionsRegistrator &bifreg)
{
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_UNPACKOLEPROPS::R:X",HS_UnpackOleProps));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SENDBLOBTO::B:IX",SendBlobTo));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CREATEZLIBCOMPRESSOR::I:ISI",CreateZlibCompressor));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CLOSEZLIBCOMPRESSOR::R:I",CloseZlibCompressor));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("OPENBLOBASDECOMPRESSINGSTREAM::I:XS",OpenBlobAsDecompressingStream));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CLOSEZLIBDECOMPRESSOR:::I",CloseZlibDecompressor));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_CREATESTREAM::I:",MakeBlob));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETSTREAMLENGTH::6:I",GetStreamLength));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETSTREAMPOINTER::6:I",GetStreamPointer));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SETSTREAMPOINTER:::I6",SetStreamPointer));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("MAKEBLOBFROMSTREAM::X:I",FinishBlob));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("MAKECOMPOSEDBLOB::X:RA",MakeComposedBlob));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETBLOBMODTIME::D:X",GetBlobModTime));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETBLOBDESCRIPTION::S:X",GetBlobDescription));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_CREATES3BLOB::X:R", CreateS3Blob));
}


} // End of namespace Baselibs
} // End of namespace HareScript
