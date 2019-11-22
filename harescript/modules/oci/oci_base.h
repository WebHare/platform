#ifndef blex_harescript_modules_oci_oci_base
#define blex_harescript_modules_oci_oci_base

#include <harescript/vm/hsvm_idmapstorage.h>
#include <harescript/vm/hsvm_context.h>
#include <harescript/vm/hsvm_sqlinterface.h>
#include <harescript/vm/hsvm_sqllib.h>
#include <harescript/vm/hsvm_dllinterface.h>
#include <oci.h>

namespace HareScript
{
namespace OCIDBProvider
{
Blex::UTF16String UTF8toUTF16(std::string const &in);
std::string UTF16toUTF8(Blex::UTF16String const &str);

typedef std::pair<signed, std::string> ErrorType;
typedef std::vector<ErrorType> ErrorList;

class VMOCIError : public VMRuntimeError
{
        public:
        VMOCIError(const int errcode, const std::string &errmsg);

        ~VMOCIError() throw();
        int GetCode() const { return errcode; }
        std::string GetMsg() const { return errmsg; }

        private:
        int errcode;
        std::string errmsg;
};

std::pair<unsigned,ub2> GetOCITransfer(ub2 ocitype, VariableTypes::Type hstype);
void ParseErrors(OCIError *errhp, ErrorList *errors);
std::string GetOCITypename(ub2 ocitype);
void ThrowDBError(const int, const std::string cstr);
void CheckRetval(OCIError *errhp, const char *context, sword status);
Blex::DateTime ReadOCIDate(uint8_t const *datetime);

template <class HandleType>
  HandleType AllocOCIHandle(OCIError *err, const char *description, CONST dvoid   *parenth, ub4 type, size_t xtramem_sz, dvoid **usrmempp)
{
        void *temp=NULL;
        CheckRetval(err, description, OCIHandleAlloc(parenth,&temp,type,xtramem_sz,usrmempp));
        return (HandleType)temp;
}


} // End of namespace OCIDBProvider
} // End of namespace HareScript

//---------------------------------------------------------------------------
#endif
