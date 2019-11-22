//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

#include <blex/crypto.h>
#include "baselibs.h"
#include "hsvm_context.h"
#include "hsvm_dllinterface.h"
#include <openssl/evp.h>
#include <openssl/err.h>

//---------------------------------------------------------------------------
//
// This library adds backend support functions for Blob management
//
//---------------------------------------------------------------------------
namespace HareScript {
namespace Baselibs {

CryptoContext::CryptoContext()
{
}

CryptoContext::~CryptoContext()
{
}

CryptoContext::Hasher::Hasher(HSVM *vm, Blex::HashAlgorithm::Type alg)
: OutputObject(vm)
{
        std::unique_ptr< Blex::Hasher > lhasher;
        Blex::GetHasher(alg, &lhasher);
        hasher.reset(lhasher.release());
}
CryptoContext::Hasher::~Hasher()
{

}

Blex::HashAlgorithm::Type GetHashAlgorithmFromString(HSVM *vm, std::string const &algo)
{
        if (algo=="MD4")
            return Blex::HashAlgorithm::MD4;
        else if (algo=="MD5")
            return Blex::HashAlgorithm::MD5;
        else if(algo=="SHA-1")
            return Blex::HashAlgorithm::SHA1;
        else if(algo=="SHA-224")
            return Blex::HashAlgorithm::SHA224;
        else if(algo=="SHA-256")
            return Blex::HashAlgorithm::SHA256;
        else if(algo=="SHA-384")
            return Blex::HashAlgorithm::SHA384;
        else if(algo=="SHA-512")
            return Blex::HashAlgorithm::SHA512;

        HSVM_ThrowException(vm, ("Hash algorithm '" + algo + "' not supported.").c_str());
        return Blex::HashAlgorithm::Unknown;
}

Blex::KeyType::Type GetKeyTypeFromString(HSVM *vm, std::string const &type)
{
        if(type=="RSA")
            return Blex::KeyType::RSA;
        else if(type=="EC")
            return Blex::KeyType::EC;
        else if (type=="DSA")
            return Blex::KeyType::DSA;
        else if (type=="DH")
            return Blex::KeyType::DH;

        HSVM_ThrowException(vm, ("Unknown key type '" + type + "'.").c_str());
        return Blex::KeyType::Unknown;
}

std::pair< Blex::SocketError::Errors, unsigned > CryptoContext::Hasher::Write(unsigned numbytes, const void *data, bool /*allow_partial*/)
{
        hasher->Process(data,numbytes);
        return std::make_pair(Blex::SocketError::NoError, numbytes);
}

void HS_CreateHasher(HSVM *vm, HSVM_VariableId id_set)
{
        Baselibs::SystemContext context(GetVirtualMachine(vm)->GetContextKeeper());
        CryptoContext::HasherPtr newproc;

        Blex::HashAlgorithm::Type hashtype = GetHashAlgorithmFromString(vm, HSVM_StringGetSTD(vm, HSVM_Arg(0)));
        if (hashtype == Blex::HashAlgorithm::Unknown)
            return;

        newproc.reset(new CryptoContext::Hasher(vm, hashtype));

        if(newproc.get())
        {
                context->crypto.hashers[newproc->GetId()] = newproc;
                HSVM_IntegerSet(vm, id_set, newproc->GetId());
        }
        else
        {
                HSVM_IntegerSet(vm, id_set, 0);
        }
}

void HS_FinalizeHasher(HSVM *vm, HSVM_VariableId id_set)
{
        Baselibs::SystemContext context(GetVirtualMachine(vm)->GetContextKeeper());
        int32_t hasherid = HSVM_IntegerGet(vm, HSVM_Arg(0));

        CryptoContext::Hashers::iterator hasher = context->crypto.hashers.find(hasherid);
        HSVM_SetDefault(vm, id_set, HSVM_VAR_String);
        if(hasher == context->crypto.hashers.end())
            return;

        if(hasher->second->hasher.get())
        {
                Blex::StringPair result = hasher->second->hasher->FinalizeHash();
                HSVM_StringSet(vm, id_set, result.begin, result.end);
        }
        context->crypto.hashers.erase(hasher);
}

void  HS_GetMD5Hash(HSVM *vm, HSVM_VariableId id_set)
{
        Blex::StringPair strpair;
        HSVM_StringGet(vm, HSVM_Arg(0), &strpair.begin, &strpair.end);

        uint8_t hash[Blex::MD5HashLen];
        Blex::GetMD5Hash(strpair.begin, strpair.size(), hash);

        HSVM_StringSet(vm, id_set, reinterpret_cast<char const*>(hash), reinterpret_cast<char const*>(hash)+Blex::MD5HashLen);
}

void HS_GetSHA1Hash(HSVM *vm, HSVM_VariableId id_set)
{
        Blex::StringPair strpair;
        HSVM_StringGet(vm, HSVM_Arg(0), &strpair.begin, &strpair.end);

        uint8_t hash[Blex::SHA1HashLen];
        Blex::GetSHA1Hash(strpair.begin, strpair.size(), hash);

        HSVM_StringSet(vm, id_set, reinterpret_cast<char const*>(hash), reinterpret_cast<char const*>(hash)+Blex::SHA1HashLen);
}

void HS_VerifyRSASignature(HSVM *vm, HSVM_VariableId id_set)
{
        Blex::StringPair hashpair, sigpair, keyfilepair;
        Blex::HashAlgorithm::Type hashtype;

        HSVM_StringGet(vm, HSVM_Arg(0), &hashpair.begin, &hashpair.end);
        hashtype = GetHashAlgorithmFromString(vm, HSVM_StringGetSTD(vm, HSVM_Arg(1)));
        HSVM_StringGet(vm, HSVM_Arg(2), &sigpair.begin, &sigpair.end);
        HSVM_StringGet(vm, HSVM_Arg(3), &keyfilepair.begin, &keyfilepair.end);

        if (hashtype == Blex::HashAlgorithm::Unknown)
            return;

        Blex::RSAPublicKey key;
        if (!key.ReadKey(keyfilepair.size(), keyfilepair.begin, ""))
        {
                HSVM_ThrowException(vm, "Invalid RSA private key or wrong password.");
                return;
        }

        // Check the length of the hash
        if (!Blex::CheckHashLength(hashtype, hashpair.size()))
        {
                HSVM_ThrowException(vm, "Invalid hash size");
                return;
        }

        HSVM_BooleanSet(vm, id_set, key.VerifyHash(hashtype, hashpair.size(), hashpair.begin, sigpair.size(), sigpair.begin));
}

void HS_CreateRSASignature(HSVM *vm, HSVM_VariableId id_set)
{
        Blex::StringPair hashpair, keyfilepair;
        std::string passphrase;
        Blex::HashAlgorithm::Type hashtype;

        HSVM_StringGet(vm, HSVM_Arg(0), &hashpair.begin, &hashpair.end);
        hashtype = GetHashAlgorithmFromString(vm, HSVM_StringGetSTD(vm, HSVM_Arg(1)));
        HSVM_StringGet(vm, HSVM_Arg(2), &keyfilepair.begin, &keyfilepair.end);
        passphrase = HSVM_StringGetSTD(vm, HSVM_Arg(3));

        if (hashtype == Blex::HashAlgorithm::Unknown)
            return;

        Blex::RSAPrivateKey key;
        if (!key.ReadKey(keyfilepair.size(), keyfilepair.begin, passphrase))
        {
                HSVM_ThrowException(vm, "Invalid RSA private key or wrong password.");
                return;
        }

        // Check the length of the SHA1 hash, must be 160 bits
        if (!Blex::CheckHashLength(hashtype, hashpair.size()))
        {
                HSVM_ThrowException(vm, "Invalid hash size");
                return;
        }

        std::vector< uint8_t > signature;
        if (!key.CreateHash(hashtype, hashpair.size(), hashpair.begin, &signature))
        {
                HSVM_ThrowException(vm, "Error creating hash signature");
                return;
        }

        if (signature.empty())
            HSVM_StringSet(vm, id_set, 0, 0);
        else
        {
                const char *start = reinterpret_cast< char * >(&signature[0]);
                HSVM_StringSet(vm, id_set, start, start + signature.size());
        }
}

void HS_GetCertificateData(HSVM *vm, HSVM_VariableId id_set)
{
        Blex::StringPair certificatepair;
        HSVM_StringGet(vm, HSVM_Arg(0), &certificatepair.begin, &certificatepair.end);

        Blex::Certificate certificate;
        if (!certificate.ReadCertificate(certificatepair.size(), certificatepair.begin))
        {
                HSVM_ThrowException(vm, "Invalid certificate.");
                return;
        }

        std::string publickey;
        if (!certificate.GetPublicKey(&publickey))
        {
                HSVM_ThrowException(vm, "Could not read public key from certificate.");
                return;
        }

        HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);
        HSVM_VariableId var_pubkey = HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "PUBLICKEY"));
        if (publickey.empty())
            HSVM_StringSet(vm, var_pubkey, 0, 0);
        else
            HSVM_StringSet(vm, var_pubkey, &publickey[0], &publickey[0] + publickey.size());
}

void HS_DoEvpCrypt(HSVM *vm, HSVM_VariableId id_set)
{
        std::string algo, key, data, iv;
        algo = HSVM_StringGetSTD(vm, HSVM_Arg(0));
        bool encrypt = HSVM_BooleanGet(vm, HSVM_Arg(1));
        key = HSVM_StringGetSTD(vm, HSVM_Arg(2));
        data = HSVM_StringGetSTD(vm, HSVM_Arg(3));
        iv = HSVM_StringGetSTD(vm, HSVM_Arg(4));
        EVP_CIPHER_CTX *ctx = 0;

        try
        {
                auto *cipher = EVP_get_cipherbyname(algo.c_str());
                if(!cipher)
                    throw std::runtime_error("Unknown cipher requested");

                ctx = EVP_CIPHER_CTX_new();
                if(!ctx)
                    throw std::runtime_error("EVP_CIPHER_CTX alloc failed");

                if(!EVP_CipherInit_ex(ctx, cipher, NULL, NULL, NULL, encrypt ? 1 : 0))
                    throw std::runtime_error("EVP_CipherInit failed");

                unsigned expectkeylen = EVP_CIPHER_key_length(cipher);

                if(key.size() < expectkeylen) //our key is too short
                {
                        key.resize(expectkeylen,0); //pad it with zeroes
                }
                else if(key.size() > expectkeylen) //our key is too long
                {
                        if(!EVP_CIPHER_CTX_set_key_length(ctx, key.size()))
                            throw std::runtime_error("EVP_CIPHER_CTX_set_key_length failed");
                }

                // iv should have right length
                if (EVP_CIPHER_iv_length(cipher) != signed(iv.size()))
                    throw std::runtime_error("Encryption iv length is wrong, expected " + Blex::AnyToString(EVP_CIPHER_iv_length(cipher)) + " bytes, got " + Blex::AnyToString(iv.size()) + " bytes");

                if(!EVP_CipherInit_ex(ctx, NULL, NULL, reinterpret_cast<const uint8_t*>(&key[0]), reinterpret_cast<const uint8_t*>(&iv[0]), encrypt ? 1 : 0))
                    throw std::runtime_error("EVP_CipherInit #2 failed");

                std::vector<uint8_t> outbuffer;
                outbuffer.resize(data.size() + EVP_CIPHER_block_size(cipher));

                int numbytes = 0, numbytes2 = 0;
                if(!EVP_CipherUpdate(ctx, &outbuffer[0], &numbytes, reinterpret_cast<const uint8_t*>(&data[0]), data.size()))
                    throw std::runtime_error("EVP_CipherUpdate failed");
                if(!EVP_CipherFinal(ctx, &outbuffer[numbytes], &numbytes2))
                    throw std::runtime_error("EVP_CipherFinal failed");

                HSVM_StringSet(vm, id_set, reinterpret_cast<char*>(&outbuffer[0]), reinterpret_cast<char*>(&outbuffer[numbytes + numbytes2]));
        }
        catch(std::exception &e)
        {
                HSVM_ThrowException(vm, e.what());
        }
        if(ctx)
            EVP_CIPHER_CTX_cleanup(ctx);
        ERR_clear_error();
}

void  HS_EncryptBlowfish(HSVM *vm, HSVM_VariableId id_set)
{
        Blex::StringPair key;
        HSVM_StringGet(vm, HSVM_Arg(0), &key.begin, &key.end);
        if(key.begin==key.end) //empty key
        {
                HSVM_SetDefault(vm, id_set, HSVM_VAR_String);
                return;
        }

        std::string input = HSVM_StringGetSTD(vm, HSVM_Arg(1));
        Blex::PodVector<char> &output = SystemContext(GetVirtualMachine(vm)->GetContextKeeper())->scratchpad;

        Blex::Blowfish bf((const unsigned char *)key.begin, key.size());

        unsigned old_length = input.size();

        // resize string to account for padding
        unsigned new_data_length = bf.GetPaddedSize(old_length);
        input.resize(new_data_length);

        output.resize(new_data_length);

        // pad and encrypt
        bf.Pad(reinterpret_cast<uint8_t*>(&input[0]), old_length);

        bf.Encrypt(reinterpret_cast<uint8_t*>(&input[0]), reinterpret_cast<uint8_t*>(&input[input.size()])
                  ,reinterpret_cast<uint8_t*>(&output[0]), reinterpret_cast<uint8_t*>(&output[output.size()]));

        HSVM_StringSet(vm, id_set, output.begin(), output.end());
}

void  HS_DecryptBlowfish(HSVM *vm, HSVM_VariableId id_set)
{
        Blex::StringPair key, input;
        HSVM_StringGet(vm, HSVM_Arg(0), &key.begin, &key.end);
        if(key.begin==key.end) //empty key
        {
                HSVM_SetDefault(vm, id_set, HSVM_VAR_String);
                return;
        }

        HSVM_StringGet(vm, HSVM_Arg(1), &input.begin, &input.end);

        Blex::PodVector<char> &output = SystemContext(GetVirtualMachine(vm)->GetContextKeeper())->scratchpad;

        Blex::Blowfish bf((const unsigned char *)key.begin, key.size());

        output.resize(input.size());

        // decrypt
        bf.Decrypt(
          (unsigned char *)input.begin,
          (unsigned char *)input.end,
          (unsigned char *)output.begin(),
          (unsigned char *)output.end());

        // remove padding
        unsigned new_output_length = bf.GetUnpaddedSize((unsigned char *)output.begin(), (unsigned char *)output.end());
        output.resize(new_output_length);

        HSVM_StringSet(vm, id_set, output.begin(), output.end());
}

void HS_EncryptXor(HSVM *vm, HSVM_VariableId id_set)
{
        StackMachine &stackm = GetVirtualMachine(vm)->GetStackMachine();

        // Move the input to the output, so we won't have unneccesary unshare
        stackm.MoveFrom(id_set, HSVM_Arg(1));

        // No mask? We're done
        if (stackm.GetStringSize(HSVM_Arg(0)) == 0)
            return;

        // Resize target string to get writable ptrs (unshares if necessary)
        std::pair< char *, char * > newstr = stackm.ResizeString(id_set, stackm.GetStringSize(id_set));

        Blex::StringPair mask = stackm.GetString(HSVM_Arg(0));
        char const *mask_it = mask.begin;

        for (char *it = newstr.first; it != newstr.second; ++it, ++mask_it)
        {
                if (mask_it == mask.end)
                    mask_it = mask.begin;

                *it = static_cast< char >(static_cast< uint8_t >(*it) ^ static_cast< uint8_t >(*mask_it));
        }
}

void HS_GenerateUFS128BitId(HSVM *vm, HSVM_VariableId id_set)
{
        HSVM_StringSetSTD(vm, id_set, Blex::GenerateUFS128BitId());
}

bool GenerateContinueCallback(HSVM* vm)
{
        return HSVM_TestMustAbort(vm) ? false : true;
}

void HS_GenerateKey(HSVM *vm, HSVM_VariableId id_set)
{
        Baselibs::SystemContext context(GetVirtualMachine(vm)->GetContextKeeper());
        CryptoContext::EVPKeyPtr newkey;

        Blex::KeyType::Type keytype = GetKeyTypeFromString(vm, HSVM_StringGetSTD(vm, HSVM_Arg(0)));

        try
        {
                newkey.reset(new Blex::EVPKey);
                int32_t numbits = HSVM_IntegerGet(vm, HSVM_Arg(1));
                std::string curve = HSVM_StringGetSTD(vm, HSVM_Arg(2));
                newkey->GenerateKeypair(keytype, numbits, curve, std::bind(&GenerateContinueCallback, vm));
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(vm, e.what());
                return;
        }
        unsigned id = context->crypto.evpkeys.Set(newkey);
        HSVM_IntegerSet(vm, id_set, id);
}
void HS_LoadPrvKey(HSVM *vm, HSVM_VariableId id_set)
{
        Baselibs::SystemContext context(GetVirtualMachine(vm)->GetContextKeeper());
        CryptoContext::EVPKeyPtr newkey;

        try
        {
                newkey.reset(new Blex::EVPKey);
                char const *begin, *end;
                HSVM_StringGet(vm, HSVM_Arg(0), &begin, &end);
                if(!newkey->ReadPrivateKey(std::distance(begin,end), begin))
                {
                        HSVM_IntegerSet(vm, id_set, 0);
                        return;
                }
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(vm, e.what());
                return;
        }

        unsigned id = context->crypto.evpkeys.Set(newkey);
        HSVM_IntegerSet(vm, id_set, id);
}
void HS_LoadPubKey(HSVM *vm, HSVM_VariableId id_set)
{
        Baselibs::SystemContext context(GetVirtualMachine(vm)->GetContextKeeper());
        CryptoContext::EVPKeyPtr newkey;

        try
        {
                newkey.reset(new Blex::EVPKey);
                char const *begin, *end;
                HSVM_StringGet(vm, HSVM_Arg(0), &begin, &end);
                if(!newkey->ReadPublicKey(std::distance(begin,end), begin))
                {
                        HSVM_IntegerSet(vm, id_set, 0);
                        return;
                }
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(vm, e.what());
                return;
        }

        unsigned id = context->crypto.evpkeys.Set(newkey);
        HSVM_IntegerSet(vm, id_set, id);
}
void HS_EncryptEVP(HSVM *vm, HSVM_VariableId id_set)
{
        try
        {
                Baselibs::SystemContext context(GetVirtualMachine(vm)->GetContextKeeper());
                CryptoContext::EVPKeyPtr *key = context->crypto.evpkeys.Get(HSVM_IntegerGet(vm, HSVM_Arg(0)));
                if(!key)
                    throw std::runtime_error("Invalid key handle");

                Blex::StringPair datapair;
                HSVM_StringGet(vm, HSVM_Arg(1), &datapair.begin, &datapair.end);

                std::vector< uint8_t > encrypted;
                (*key)->Encrypt(datapair.size(), datapair.begin, &encrypted);

                if (encrypted.empty())
                    HSVM_StringSet(vm, id_set, 0, 0);
                else
                {
                        const char *start = reinterpret_cast< char * >(&encrypted[0]);
                        HSVM_StringSet(vm, id_set, start, start + encrypted.size());
                }
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(vm, e.what());
                return;
        }
}
void HS_DecryptEVP(HSVM *vm, HSVM_VariableId id_set)
{
        try
        {
                Baselibs::SystemContext context(GetVirtualMachine(vm)->GetContextKeeper());
                CryptoContext::EVPKeyPtr *key = context->crypto.evpkeys.Get(HSVM_IntegerGet(vm, HSVM_Arg(0)));
                if(!key)
                    throw std::runtime_error("Invalid key handle");

                Blex::StringPair datapair;
                HSVM_StringGet(vm, HSVM_Arg(1), &datapair.begin, &datapair.end);

                std::vector< uint8_t > decrypted;
                (*key)->Decrypt(datapair.size(), datapair.begin, &decrypted);

                if (decrypted.empty())
                    HSVM_StringSet(vm, id_set, 0, 0);
                else
                {
                        const char *start = reinterpret_cast< char * >(&decrypted[0]);
                        HSVM_StringSet(vm, id_set, start, start + decrypted.size());
                }
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(vm, e.what());
                return;
        }
}
void HS_SignEVP(HSVM *vm, HSVM_VariableId id_set)
{
        try
        {
                Baselibs::SystemContext context(GetVirtualMachine(vm)->GetContextKeeper());
                CryptoContext::EVPKeyPtr *key = context->crypto.evpkeys.Get(HSVM_IntegerGet(vm, HSVM_Arg(0)));
                if(!key)
                    throw std::runtime_error("Invalid key handle");

                Blex::StringPair datapair;
                HSVM_StringGet(vm, HSVM_Arg(1), &datapair.begin, &datapair.end);

                Blex::HashAlgorithm::Type hashtype = GetHashAlgorithmFromString(vm, HSVM_StringGetSTD(vm, HSVM_Arg(2)));
                if (hashtype == Blex::HashAlgorithm::Unknown)
                    return;

                std::vector< uint8_t > signature;
                (*key)->Sign(datapair.size(), datapair.begin, &signature, hashtype);

                if (signature.empty())
                    HSVM_StringSet(vm, id_set, 0, 0);
                else
                {
                        const char *start = reinterpret_cast< char * >(&signature[0]);
                        HSVM_StringSet(vm, id_set, start, start + signature.size());
                }
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(vm, e.what());
                return;
        }
}
void HS_VerifyEVP(HSVM *vm, HSVM_VariableId id_set)
{
        try
        {
                Baselibs::SystemContext context(GetVirtualMachine(vm)->GetContextKeeper());
                CryptoContext::EVPKeyPtr *key = context->crypto.evpkeys.Get(HSVM_IntegerGet(vm, HSVM_Arg(0)));
                if(!key)
                    throw std::runtime_error("Invalid key handle");

                Blex::StringPair datapair;
                HSVM_StringGet(vm, HSVM_Arg(1), &datapair.begin, &datapair.end);

                std::string signaturestr = HSVM_StringGetSTD(vm, HSVM_Arg(2));
                std::vector< uint8_t > signature(signaturestr.begin(), signaturestr.end());

                Blex::HashAlgorithm::Type hashtype = GetHashAlgorithmFromString(vm, HSVM_StringGetSTD(vm, HSVM_Arg(3)));
                if (hashtype == Blex::HashAlgorithm::Unknown)
                    return;

                bool result = (*key)->Verify(datapair.size(), datapair.begin, signature, hashtype);
                HSVM_BooleanSet(vm, id_set, result);
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(vm, e.what());
                return;
        }
}
void HS_GetKeyType(HSVM *vm, HSVM_VariableId id_set)
{
        try
        {
                Baselibs::SystemContext context(GetVirtualMachine(vm)->GetContextKeeper());
                CryptoContext::EVPKeyPtr *key = context->crypto.evpkeys.Get(HSVM_IntegerGet(vm, HSVM_Arg(0)));

                if(!key)
                        throw std::runtime_error("Invalid key handle");

                Blex::KeyType::Type type = (*key)->GetKeyType();
                if(type==Blex::KeyType::RSA)
                    HSVM_StringSetSTD(vm, id_set, "RSA");
                else if(type==Blex::KeyType::EC)
                    HSVM_StringSetSTD(vm, id_set, "EC");
                else if (type==Blex::KeyType::DSA)
                    HSVM_StringSetSTD(vm, id_set, "DSA");
                else if (type==Blex::KeyType::DH)
                    HSVM_StringSetSTD(vm, id_set, "DH");
                else
                    HSVM_SetDefault(vm, id_set, HSVM_VAR_String);
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(vm, e.what());
                return;
        }
}
void HS_GetKeyLength(HSVM *vm, HSVM_VariableId id_set)
{
        try
        {
                Baselibs::SystemContext context(GetVirtualMachine(vm)->GetContextKeeper());
                CryptoContext::EVPKeyPtr *key = context->crypto.evpkeys.Get(HSVM_IntegerGet(vm, HSVM_Arg(0)));

                if(!key)
                        throw std::runtime_error("Invalid key handle");

                int bits = (*key)->GetKeyLength();
                HSVM_IntegerSet(vm, id_set, bits);
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(vm, e.what());
                return;
        }
}
void HS_GetKeyPublicOnly(HSVM *vm, HSVM_VariableId id_set)
{
        try
        {
                Baselibs::SystemContext context(GetVirtualMachine(vm)->GetContextKeeper());
                CryptoContext::EVPKeyPtr *key = context->crypto.evpkeys.Get(HSVM_IntegerGet(vm, HSVM_Arg(0)));

                if(!key)
                        throw std::runtime_error("Invalid key handle");

                bool publiconly = (*key)->GetPublicOnly();
                HSVM_BooleanSet(vm, id_set, publiconly);
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(vm, e.what());
                return;
        }
}
void HS_GetPrivateKey(HSVM *vm, HSVM_VariableId id_set)
{
        try
        {
                Baselibs::SystemContext context(GetVirtualMachine(vm)->GetContextKeeper());
                CryptoContext::EVPKeyPtr *key = context->crypto.evpkeys.Get(HSVM_IntegerGet(vm, HSVM_Arg(0)));

                if(!key)
                        throw std::runtime_error("Invalid key handle");

                std::string retval = (*key)->GetPrivateKey();
                HSVM_StringSetSTD(vm, id_set, retval);
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(vm, e.what());
                return;
        }
}
void HS_GetPublicKey(HSVM *vm, HSVM_VariableId id_set)
{
        try
        {
                Baselibs::SystemContext context(GetVirtualMachine(vm)->GetContextKeeper());
                CryptoContext::EVPKeyPtr *key = context->crypto.evpkeys.Get(HSVM_IntegerGet(vm, HSVM_Arg(0)));

                if(!key)
                        throw std::runtime_error("Invalid key handle");

                std::string retval = (*key)->GetPublicKey();
                HSVM_StringSetSTD(vm, id_set, retval);
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(vm, e.what());
                return;
        }
}
void HS_GenerateCSR(HSVM *vm, HSVM_VariableId id_set)
{
        try
        {
                Baselibs::SystemContext context(GetVirtualMachine(vm)->GetContextKeeper());
                CryptoContext::EVPKeyPtr *key = context->crypto.evpkeys.Get(HSVM_IntegerGet(vm, HSVM_Arg(0)));

                if(!key)
                        throw std::runtime_error("Invalid key handle");

                std::vector<uint8_t> req;
                Blex::SubjectNameParts parts;

                unsigned numparts = HSVM_ArrayLength(vm, HSVM_Arg(1));
                HSVM_ColumnId colfield = HSVM_GetColumnId(vm, "FIELD");
                HSVM_ColumnId colvalue = HSVM_GetColumnId(vm, "VALUE");

                for (unsigned i=0; i<numparts;++i)
                {
                        HSVM_VariableId var_row = HSVM_ArrayGetRef(vm, HSVM_Arg(1), i);
                        HSVM_VariableId var_field = HSVM_RecordGetRef(vm, var_row, colfield);
                        HSVM_VariableId var_value = HSVM_RecordGetRef(vm, var_row, colvalue);

                        if(!var_field || !var_value || HSVM_GetType(vm, var_field) != HSVM_VAR_String || HSVM_GetType(vm, var_value) != HSVM_VAR_String)
                                throw std::runtime_error("Invalid value");

                        parts.push_back(std::make_pair(HSVM_StringGetSTD(vm, var_field), HSVM_StringGetSTD(vm, var_value)));
                }
                (*key)->GenerateCertificateRequest(&req, parts, HSVM_StringGetSTD(vm, HSVM_Arg(2)));

                HSVM_StringSet(vm, id_set, reinterpret_cast<char*>(&req[0]), reinterpret_cast<char*>(&req[req.size()]));
        }
        catch(std::exception &e)
        {
                HSVM_ReportCustomError(vm, e.what());
                return;
        }
}

void InitCrypto(struct HSVM_RegData *regdata)
{
        HSVM_RegisterFunction(regdata, "CREATEHASHER::I:S",HS_CreateHasher);
        HSVM_RegisterFunction(regdata, "FINALIZEHASHER::S:I",HS_FinalizeHasher);
        HSVM_RegisterFunction(regdata, "VERIFY_RSA_HASH::B:SSSS",HS_VerifyRSASignature);
        HSVM_RegisterFunction(regdata, "CREATE_RSA_HASH::S:SSSS",HS_CreateRSASignature);
        HSVM_RegisterFunction(regdata, "GETCERTIFICATEDATA::R:S",HS_GetCertificateData);
        HSVM_RegisterFunction(regdata, "__HS_ENCRYPT_BLOWFISH::S:SS",HS_EncryptBlowfish);
        HSVM_RegisterFunction(regdata, "__HS_DECRYPT_BLOWFISH::S:SS",HS_DecryptBlowfish);
        HSVM_RegisterFunction(regdata, "ENCRYPT_XOR::S:SS",HS_EncryptXor);
        HSVM_RegisterFunction(regdata, "GENERATEUFS128BITID::S:",HS_GenerateUFS128BitId);
        HSVM_RegisterFunction(regdata, "__EVP_GENERATEKEY::I:SIS",HS_GenerateKey);
        HSVM_RegisterFunction(regdata, "__EVP_LOADPRVKEY::I:S",HS_LoadPrvKey);
        HSVM_RegisterFunction(regdata, "__EVP_LOADPUBKEY::I:S",HS_LoadPubKey);
        HSVM_RegisterFunction(regdata, "__EVP_ENCRYPT::S:IS",HS_EncryptEVP);
        HSVM_RegisterFunction(regdata, "__EVP_DECRYPT::S:IS",HS_DecryptEVP);
        HSVM_RegisterFunction(regdata, "__EVP_SIGN::S:ISS",HS_SignEVP);
        HSVM_RegisterFunction(regdata, "__EVP_VERIFY::B:ISSS",HS_VerifyEVP);
        HSVM_RegisterFunction(regdata, "__EVP_GETKEYTYPE::S:I",HS_GetKeyType);
        HSVM_RegisterFunction(regdata, "__EVP_GETKEYLENGTH::I:I",HS_GetKeyLength);
        HSVM_RegisterFunction(regdata, "__EVP_ISKEYPUBLICONLY::B:I",HS_GetKeyPublicOnly);
        HSVM_RegisterFunction(regdata, "__EVP_GETPRIVATEKEY::S:I",HS_GetPrivateKey);
        HSVM_RegisterFunction(regdata, "__EVP_GETPUBLICKEY::S:I",HS_GetPublicKey);
        HSVM_RegisterFunction(regdata, "__EVP_GENERATECSR::S:IRAS",HS_GenerateCSR);
        HSVM_RegisterFunction(regdata, "__DOEVPCRYPT::S:SBSSS", HS_DoEvpCrypt);
}


} // End of namespace Baselibs
} // End of namespace HareScript
