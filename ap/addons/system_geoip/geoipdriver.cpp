#include <ap/libwebhare/allincludes.h>

#include <harescript/vm/hsvm_dllinterface.h>
#include <ap/libwebhare/whcore_hs3.h>
#include <maxminddb.h>

namespace GeoIP_NS
{

struct GlobalData
{
        GlobalData();
        ~GlobalData();

        bool initialized;

        std::string shippeddbroot;
        std::string downloadeddbroot;

        MMDB_s countrydb;
        MMDB_s citydb;

        bool have_countrydb;
        bool have_citydb;

        bool EnsureInitialized(HSVM *vm);
        void ResetState();
};

typedef Blex::InterlockedData< GlobalData, Blex::Mutex > LockedGlobalData;

LockedGlobalData globaldata;

bool GlobalData::EnsureInitialized(HSVM *vm)
{
        if (!initialized)
        {
                // Delete old state
                ResetState();

                // Get the installation root
                WHCore::ScriptContextData *scriptcontext=static_cast< WHCore::ScriptContextData* >(HSVM_GetContext(vm, WHCore::ScriptContextId, true));
                if(!scriptcontext)
                {
                        HSVM_ReportCustomError(vm, "Cannot contact the WHCore");
                        return false;
                }

                shippeddbroot = Blex::MergePath(scriptcontext->GetWebHare().GetWebHareRoot(),"geoip");
                downloadeddbroot = Blex::MergePath(scriptcontext->GetWebHare().GetBaseDataRoot(),"geoip");

                if(MMDB_open(Blex::MergePath(downloadeddbroot, "geoip-city.mmdb").c_str(), 0, &citydb) == MMDB_SUCCESS
                   || MMDB_open(Blex::MergePath(shippeddbroot, "GeoLite2-City.mmdb").c_str(), 0, &citydb) == MMDB_SUCCESS)
                {
                        have_citydb = true;
                }
                if(MMDB_open(Blex::MergePath(downloadeddbroot, "geoip-country.mmdb").c_str(), 0, &countrydb) == MMDB_SUCCESS
                   || MMDB_open(Blex::MergePath(shippeddbroot, "GeoLite2-Country.mmdb").c_str(), 0, &countrydb) == MMDB_SUCCESS)
                {
                        have_countrydb = true;
                }

                initialized = true;
        }
        return true;
}


void GlobalData::ResetState()
{
        if(have_countrydb)
        {
                MMDB_close(&countrydb);
                have_countrydb = false;
        }
        if(have_citydb)
        {
                MMDB_close(&citydb);
                have_citydb = false;
        }
        initialized = false;
}


GlobalData::GlobalData()
: initialized(false)
, have_countrydb(false)
, have_citydb(false)
{

}
GlobalData::~GlobalData()
{
        // Throw away the contexts if not initialized
        ResetState();
}

void LoadGeoIPStringField(HSVM *vm, HSVM_VariableId toset, MMDB_lookup_result_s result, const char *const path[])
{
        MMDB_entry_data_s entry_data;
        int mmdb_error = MMDB_aget_value(&result.entry, &entry_data, path);
        if(mmdb_error == MMDB_SUCCESS && entry_data.has_data && entry_data.type == MMDB_DATA_TYPE_UTF8_STRING)
            HSVM_StringSet(vm, toset, entry_data.utf8_string, entry_data.utf8_string + entry_data.data_size);
        else
            HSVM_SetDefault(vm, toset, HSVM_VAR_String);
}

void LoadGeoIPFloatField(HSVM *vm, HSVM_VariableId toset, MMDB_lookup_result_s result, const char *const path[])
{
        MMDB_entry_data_s entry_data;
        int mmdb_error = MMDB_aget_value(&result.entry, &entry_data, path);
        if(mmdb_error == MMDB_SUCCESS && entry_data.has_data && entry_data.type == MMDB_DATA_TYPE_DOUBLE)
            HSVM_FloatSet(vm, toset, entry_data.double_value);
        else
            HSVM_SetDefault(vm, toset, HSVM_VAR_Float);
}

void LookupCityByIP(HSVM *vm, HSVM_VariableId id_set)
{
        //FIXME reopen files if replaced. i don't think geoip does this ?
        HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);

        LockedGlobalData::WriteRef lock(globaldata);
        if (!lock->EnsureInitialized(vm) || !lock->have_citydb)
            return;

        std::string ip = HSVM_StringGetSTD(vm, HSVM_Arg(0));
        int gai_error, mmdb_error;
        MMDB_lookup_result_s result = MMDB_lookup_string(&lock->citydb, ip.c_str(), &gai_error, &mmdb_error);
        if(gai_error != 0 || mmdb_error != MMDB_SUCCESS || !result.found_entry)
            return;

        //TODO see the example on https://dev.maxmind.com/geoip/geoip2/whats-new-in-geoip2/ - there's much more we could return!
        const char *country_code_path[] = {"country","iso_code",nullptr};
        LoadGeoIPStringField(vm, HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "COUNTRY_CODE")), result, country_code_path);

        const char *country_name_path[] = {"country","names","en",nullptr};
        LoadGeoIPStringField(vm, HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "COUNTRY_NAME")), result, country_name_path);

        const char *region_code_path[] = {"subdivisions","0","iso_code",nullptr};
        LoadGeoIPStringField(vm, HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "REGION_CODE")), result, region_code_path);

        const char *region_name_path[] = {"subdivisions","0","names","en",nullptr};
        LoadGeoIPStringField(vm, HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "REGION_NAME")), result, region_name_path);

        const char *city_name_path[] = {"city","names","en",nullptr};
        LoadGeoIPStringField(vm, HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "CITY")), result, city_name_path);

        const char *postal_code_path[] = {"postal","code",nullptr};
        LoadGeoIPStringField(vm, HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "POSTAL_CODE")), result, postal_code_path);

        const char *latitude_path[] = {"location","latitude",nullptr};
        LoadGeoIPFloatField(vm, HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "LATITUDE")), result, latitude_path);

        const char *longitude_path[] = {"location","longitude",nullptr};
        LoadGeoIPFloatField(vm, HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "LONGITUDE")), result, longitude_path);
}

void LookupCountryByIP(HSVM *vm, HSVM_VariableId id_set)
{
        LockedGlobalData::WriteRef lock(globaldata);
        if (!lock->EnsureInitialized(vm) || (!lock->have_citydb && !lock->have_countrydb))
            return;

        HSVM_SetDefault(vm, id_set, HSVM_VAR_String);

        std::string ip = HSVM_StringGetSTD(vm, HSVM_Arg(0));
        int gai_error, mmdb_error;
        MMDB_lookup_result_s result = MMDB_lookup_string(lock->have_countrydb ? &lock->countrydb : &lock->citydb, ip.c_str(), &gai_error, &mmdb_error);
        if(gai_error != 0 || mmdb_error != MMDB_SUCCESS || !result.found_entry)
            return;

        const char *country_code_path[] = {"country","iso_code",nullptr};
        LoadGeoIPStringField(vm, id_set, result, country_code_path);
}

void GetCapabilities(HSVM *vm, HSVM_VariableId id_set)
{
        LockedGlobalData::WriteRef lock(globaldata);
        if (!lock->EnsureInitialized(vm))
            return;

        HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);
        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "HAVE_CITY")), bool(lock->have_citydb));
        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "HAVE_COUNTRY")), bool(lock->have_countrydb));
}

} // End of namespace GeoIP_NS


extern "C" {

BLEXLIB_PUBLIC int HSVM_ModuleEntryPoint(HSVM_RegData *regdata, void*)
{
        HSVM_RegisterFunction(regdata, "GETGEOIPCAPABILITIES:SYSTEM_GEOIP:R:", GeoIP_NS::GetCapabilities);
        HSVM_RegisterFunction(regdata, "__GETGEOIPCITYBYIP:SYSTEM_GEOIP:R:S", GeoIP_NS::LookupCityByIP);
        HSVM_RegisterFunction(regdata, "__GETGEOIPCOUNTRYBYIP:SYSTEM_GEOIP:S:S",GeoIP_NS::LookupCountryByIP);

        return 1;
}

}
