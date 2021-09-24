#include <blex/blexlib.h>

#include <unistd.h>
#define crypt ssl_scrypt_function

#include "crypto.h"
#include "crypt_blowfish.h"
#include "logfile.h"
#include <cstring>
#include "stream.h"
#include "utils.h"
#include <openssl/pem.h>
#include <openssl/rsa.h>
#include <openssl/sha.h>
#include <openssl/ssl.h>
#include <openssl/rand.h>
#include <openssl/err.h>
#include <openssl/des.h>
#include <openssl/x509v3.h>
#include <iostream>

//#define DEBUG_SSL  //noisy SSL debuginfo

#ifdef DEBUG_SSL
#define DEBUGSSLPRINT(x) DEBUGPRINT(x)
#else
#define DEBUGSSLPRINT(x) (void)0
#endif

#if OPENSSL_VERSION_NUMBER < 0x10100000L
#error openssl < 1.1 is not supported
#endif

//FIXME Where is the code the below copyright message actually applies to ?

/*
 * Copyright (c) 1996 Michael Shalayeff.
 *
 * This software derived from one contributed by Colin Plumb.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. All advertising materials mentioning features or use of this software
 *    must display the following acknowledgement:
 *      This product includes software developed by Colin Plumb.
 * 4. Neither the name of the University nor of the Laboratory may be used
 *    to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE REGENTS AND CONTRIBUTORS ``AS IS'' AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE REGENTS OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
 * OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 *
 */

/*
 * The code for MD5 transform was taken from Colin Plumb's
 * implementation, which has been placed in the public domain.  The
 * MD5 cryptographic checksum was devised by Ronald Rivest, and is
 * documented in RFC 1321, "The MD5 Message Digest Algorithm".
 *
 */

/* ADDME Should MD5/SSHA/Crypt functions clear their temp buffers after running? */

// Need defined outside namespace
struct CRYPTO_dynlock_value
{
    public:
        Blex::CoreMutex lock;
};

namespace Blex
{

Blex::CoreMutex *lock_cs;

void locking_callback(int mode, int n, const char * /*file*/, int /*line*/)
{
        if (mode & CRYPTO_LOCK)
            lock_cs[n].Lock();
        else
            lock_cs[n].Unlock();
}

static CRYPTO_dynlock_value *dyn_create_function(const char *file, int line)
{
    (void)file; /* skip warning about unused parameter */
    (void)line; /* skip warning about unused parameter */

    return new CRYPTO_dynlock_value;
}

static void dyn_lock_function(int mode, CRYPTO_dynlock_value *value,
        const char *file, int line)
{
    (void)file; /* skip warning about unused parameter */
    (void)line; /* skip warning about unused parameter */
    if(mode&CRYPTO_LOCK)
        value->lock.Lock();
    else
        value->lock.Unlock();
}

static void dyn_destroy_function(CRYPTO_dynlock_value *value,
        const char *file, int line)
{
    (void)file; /* skip warning about unused parameter */
    (void)line; /* skip warning about unused parameter */
    delete value;
}

extern "C"
{
        int EvpCallback(EVP_PKEY_CTX *ctx)
        {
                EVPKey *evpkey = static_cast<EVPKey*>(EVP_PKEY_CTX_get_app_data(ctx));
                return evpkey->ContinueKeyGeneration() ? 1 : 0;
        }
}

void InitSSL()
{
        DEBUGSSLPRINT("EnsureSSLInit");
        DEBUGSSLPRINT("EnsureSSLInit: thread_setup");

        lock_cs=new Blex::CoreMutex[CRYPTO_num_locks()];
        CRYPTO_set_locking_callback(locking_callback);

        CRYPTO_set_dynlock_create_callback(dyn_create_function);
        CRYPTO_set_dynlock_lock_callback(dyn_lock_function);
        CRYPTO_set_dynlock_destroy_callback(dyn_destroy_function);

        DEBUGSSLPRINT("EnsureSSLInit: SSL_load_error_strings");
        SSL_load_error_strings(); //allows readable error messages...
        DEBUGSSLPRINT("EnsureSSLInit: ERR_load_BIO_strings");
        ERR_load_BIO_strings();
        DEBUGSSLPRINT("EnsureSSLInit: SSL_library_init");
        SSL_library_init();
        DEBUGSSLPRINT("EnsureSSLInit: OpenSSL_add_all_algorithms");
        OpenSSL_add_all_algorithms();

        // OpenSSL likes at least 128 bits, so 64 bytes seems plenty.
        DEBUGSSLPRINT("EnsureSSLInit: /dev/urandom");
        RAND_load_file("/dev/urandom",128);
}
void FinishSSL()
{
        CRYPTO_set_locking_callback(NULL);
        delete[] lock_cs;
}

class MemBioWrapper
{
        public:
        MemBioWrapper();
        ~MemBioWrapper();

        void SendToVector(std::vector<uint8_t> *vector);
        void SendToString(std::string *str);
        void ReadFromStream(Blex::Stream &instr);

        BIO* GetBio() { return bio; }

        private:
        BIO *bio;
};

MemBioWrapper::MemBioWrapper()
{
        bio = BIO_new(BIO_s_mem());
}
MemBioWrapper::~MemBioWrapper()
{
        BIO_free(bio);
}

void MemBioWrapper::SendToVector(std::vector<uint8_t> *vector)
{
        vector->resize(0);
        static int chunksize = 4096;
        while (true)
        {
                std::size_t nowsize = vector->size();
                vector->resize(nowsize + chunksize);

                int nowread = BIO_read(bio, &vector->data()[nowsize], chunksize);

                if (nowread <= 0)
                    nowread = 0;

                if (nowread != chunksize)
                {
                        vector->resize(nowsize + nowread);
                        break;
                }
        }
}
void MemBioWrapper::SendToString(std::string *str)
{
        std::vector<uint8_t> tmp;
        SendToVector(&tmp);
        str->append(reinterpret_cast<const char*>(&tmp[0]), reinterpret_cast<const char*>(&tmp[tmp.size()]));
}
void MemBioWrapper::ReadFromStream(Blex::Stream &instr)
{
        std::vector<uint8_t> tmp(16384);
        while(int inbytes = instr.Read(&tmp[0],16384))
        {
                if (BIO_write(bio,&tmp[0],inbytes)!=inbytes)
                    throw std::bad_alloc();
        }
}

std::string GetLastSSLErrors()
{
        char errmsg[120]; //size required by OpenSSL
        std::string retval;

        while (int err = ERR_get_error())
        {
                ERR_error_string(err,errmsg);
                if(retval.empty())
                    retval=errmsg;
                DEBUGSSLPRINT("SSL:" << errmsg);
        }
        return retval;
}

SSLBIOFromData::SSLBIOFromData(unsigned keylen, const void *keybytes)
{
        bio = BIO_new(BIO_s_mem());
        BIO_write((BIO*)bio,keybytes,keylen);
}
SSLBIOFromData::~SSLBIOFromData()
{
        BIO_free((BIO*)bio);
}

RSAKey::RSAKey()
: key(NULL)
{
}

RSAKey::~RSAKey()
{
        if(key)
            RSA_free(static_cast<RSA*>(key));
}

bool RSAPublicKey::ReadKey(unsigned keylen, const void *keybytes, std::string const &passphrase)
{
        if(key)
            RSA_free(static_cast<RSA*>(key));

        BIO *bio = BIO_new(BIO_s_mem());
        BIO_write(bio,keybytes,keylen);
        key = PEM_read_bio_RSA_PUBKEY(bio, 0, 0, const_cast< void * >(static_cast< void const * >(passphrase.c_str())));
        BIO_free(bio);

        return key != NULL;
}

bool RSAPublicKey::VerifySHA1Hash(unsigned hashlen, const void *hashdata, unsigned signaturelen, const void *signaturedata)
{
        return VerifyHash(HashAlgorithm::SHA1, hashlen, hashdata, signaturelen, signaturedata);
}

bool RSAPublicKey::VerifyHash(HashAlgorithm::Type hashtype, unsigned hashlen, const void *hashdata, unsigned signaturelen, const void *signaturedata)
{
        int type;
        switch (hashtype)
        {
        case HashAlgorithm::MD5:        type = NID_md5; break;
        case HashAlgorithm::SHA1:       type = NID_sha1; break;
        case HashAlgorithm::SHA224:     type = NID_sha224; break;
        case HashAlgorithm::SHA256:     type = NID_sha256; break;
        case HashAlgorithm::SHA384:     type = NID_sha384; break;
        case HashAlgorithm::SHA512:     type = NID_sha512; break;
        default:                        return false;
        }

        return RSA_verify(type, reinterpret_cast<const uint8_t *>(hashdata), hashlen, const_cast< uint8_t * >(reinterpret_cast<const uint8_t *>(signaturedata)), signaturelen, static_cast<RSA*>(key)) == 1;
}

bool RSAPrivateKey::ReadKey(unsigned keylen, const void *keybytes, std::string const &passphrase)
{
        if(key)
            RSA_free(static_cast<RSA*>(key));

        SSLBIOFromData databio(keylen, keybytes);

        key = PEM_read_bio_RSAPrivateKey((BIO*)databio.GetBio(), 0, 0, const_cast< void * >(static_cast< void const * >(passphrase.c_str())));
        return key != NULL;
}

bool RSAPrivateKey::CreateSHA1Hash(unsigned hashlen, const void *hashdata, std::vector< uint8_t > *signature)
{
        return CreateHash(HashAlgorithm::SHA1, hashlen, hashdata, signature);
}

bool RSAPrivateKey::CreateHash(HashAlgorithm::Type hashtype, unsigned hashlen, const void *hashdata, std::vector< uint8_t > *signature)
{
        int type;
        switch (hashtype)
        {
        case HashAlgorithm::MD5:        type = NID_md5; break;
        case HashAlgorithm::SHA1:       type = NID_sha1; break;
        case HashAlgorithm::SHA224:     type = NID_sha224; break;
        case HashAlgorithm::SHA256:     type = NID_sha256; break;
        case HashAlgorithm::SHA384:     type = NID_sha384; break;
        case HashAlgorithm::SHA512:     type = NID_sha512; break;
        default:                        return false;
        }

        signature->resize(RSA_size(static_cast<RSA*>(key)));
        unsigned int siglen = 0;
        int retval = RSA_sign(type, reinterpret_cast<const uint8_t *>(hashdata), hashlen, &(*signature)[0], &siglen, static_cast<RSA*>(key));
        if (retval)
            signature->resize(siglen);
        else
            signature->clear();
        return retval;
}

EVPKey::EVPKey() //ADDME: Merge RASPublicKey into EVPKey ?
: key(NULL)
, ctx(NULL)
, publiconly(false)
{
}
EVPKey::~EVPKey()
{
        EVP_PKEY_free(static_cast<EVP_PKEY*>(key));
        EVP_PKEY_CTX_free(static_cast<EVP_PKEY_CTX*>(ctx));
}
bool EVPKey::ReadPrivateKey(unsigned keylen, const void *keybytes)
{
        EVP_PKEY_free(static_cast<EVP_PKEY*>(key));
        EVP_PKEY_CTX_free(static_cast<EVP_PKEY_CTX*>(ctx));
        ctx = NULL;

        BIO *bio = BIO_new(BIO_s_mem());
        BIO_write(bio,keybytes,keylen);
        key = PEM_read_bio_PrivateKey(bio,0,0,0);
        if(!key)
            GetLastSSLErrors();
        BIO_free(bio);

        ctx = EVP_PKEY_CTX_new(static_cast<EVP_PKEY*>(key), NULL);

        publiconly = false;
        return key != NULL;
}
bool EVPKey::ReadPublicKey(unsigned keylen, const void *keybytes)
{
        EVP_PKEY_free(static_cast<EVP_PKEY*>(key));
        EVP_PKEY_CTX_free(static_cast<EVP_PKEY_CTX*>(ctx));
        ctx = NULL;

        BIO *bio = BIO_new(BIO_s_mem());
        BIO_write(bio,keybytes,keylen);
        key = PEM_read_bio_PUBKEY(bio,0,0,0);
        if(!key)
            GetLastSSLErrors();
        BIO_free(bio);

        ctx = EVP_PKEY_CTX_new(static_cast<EVP_PKEY*>(key), NULL);

        publiconly = true;
        return key != NULL;
}
bool EVPKey::ContinueKeyGeneration()
{
        return !testcontinue || testcontinue();
}

void EVPKey::GenerateKeypair(KeyType::Type keytype, unsigned numbits, std::string const &curve, std::function< bool() > _testcontinue)
{
        EVP_PKEY_CTX *pctx = NULL;
        try
        {
                testcontinue = _testcontinue;

                EVP_PKEY_free(static_cast<EVP_PKEY*>(key));
                key = NULL;
                EVP_PKEY_CTX_free(static_cast<EVP_PKEY_CTX*>(ctx));
                ctx = NULL;
                publiconly = false;

                if (keytype == KeyType::RSA)
                {
                        if(numbits <= 0  || numbits > 4096)
                            throw std::runtime_error("Keygen failure - parameter error");

                        ctx = EVP_PKEY_CTX_new_id(EVP_PKEY_RSA, NULL);
                        if(!ctx)
                            throw std::bad_alloc();

                        EVP_PKEY_CTX_set_app_data(static_cast<EVP_PKEY_CTX*>(ctx), this);
                        EVP_PKEY_CTX_set_cb(static_cast<EVP_PKEY_CTX*>(ctx), EvpCallback);

                        if (EVP_PKEY_keygen_init(static_cast<EVP_PKEY_CTX*>(ctx)) <= 0)
                            throw std::runtime_error("Keygen failure - init failed");

                        if (!EVP_PKEY_CTX_set_rsa_keygen_bits(static_cast<EVP_PKEY_CTX*>(ctx), numbits))
                            throw std::runtime_error("Keygen failure - set_rsa_keygen_bits failed");

                        if (EVP_PKEY_keygen(static_cast<EVP_PKEY_CTX*>(ctx), reinterpret_cast<EVP_PKEY**>(&key)) <= 0)
                            throw std::runtime_error("Keygen failure - keygen failed");
                }
                else if (keytype == KeyType::EC)
                {
                        int nid = OBJ_sn2nid(&curve[0]);
                        if (nid == NID_undef)
                            throw std::runtime_error("Keygen failure - parameter error");

                        ctx = EVP_PKEY_CTX_new_id(EVP_PKEY_EC, NULL);
                        if(!ctx)
                            throw std::bad_alloc();

                        EVP_PKEY_CTX_set_app_data(static_cast<EVP_PKEY_CTX*>(ctx), this);
                        EVP_PKEY_CTX_set_cb(static_cast<EVP_PKEY_CTX*>(ctx), EvpCallback);

                        if (EVP_PKEY_keygen_init(static_cast<EVP_PKEY_CTX*>(ctx)) <= 0)
                            throw std::runtime_error("Keygen failure - init failed");

                        if (!EVP_PKEY_CTX_set_ec_paramgen_curve_nid(static_cast<EVP_PKEY_CTX*>(ctx), nid))
                            throw std::runtime_error("Keygen failure - set_ec_paramgen_curve_nid failed");
                        if (!EVP_PKEY_CTX_set_ec_param_enc(static_cast<EVP_PKEY_CTX*>(ctx), OPENSSL_EC_NAMED_CURVE))
                            throw std::runtime_error("Keygen failure - set_ec_param_enc failed");

                        if (EVP_PKEY_keygen(static_cast<EVP_PKEY_CTX*>(ctx), reinterpret_cast<EVP_PKEY**>(&key)) <= 0)
                            throw std::runtime_error("Keygen failure - keygen failed");
                }
                else
                    throw std::runtime_error("Unsupported key type");
        }
        catch(...)
        {
                EVP_PKEY_CTX_free(static_cast<EVP_PKEY_CTX*>(pctx));
                _testcontinue = std::function< bool() >();
                throw;
        }
}

void EVPKey::GenerateCertificateRequest(std::vector<uint8_t> *req, SubjectNameParts const &subjectname, std::string const &altnames)
{
        if (publiconly)
            throw std::runtime_error("Cannot sign certificate request with a public key");

        //Generate the certificate request
        X509_REQ    *req_p = NULL;
        STACK_OF(X509_EXTENSION) *exts = NULL;
        MemBioWrapper membio;

        try
        {
                req_p = X509_REQ_new();
                exts = sk_X509_EXTENSION_new_null();
                if (!req_p || !exts)
                    throw std::bad_alloc();

                if(!X509_REQ_set_version(req_p, 0))
                    throw std::runtime_error("X509 request version setup failed");

                X509_NAME *x509_name = X509_REQ_get_subject_name(req_p);
                for(unsigned i=0; i < subjectname.size(); ++i)
                  if(!X509_NAME_add_entry_by_txt(x509_name, subjectname[i].first.c_str(), MBSTRING_ASC, (const unsigned char*)subjectname[i].second.c_str(), -1, -1, 0))
                      throw std::runtime_error("X509 request subjectnames failed");

                if(!altnames.empty())
                {
                        X509_EXTENSION *ex = X509V3_EXT_conf_nid(NULL, NULL, NID_subject_alt_name, const_cast<char*>(altnames.c_str()));
                        if (!ex)
                            throw std::bad_alloc();

                        sk_X509_EXTENSION_push(exts, ex);
                }
                X509_REQ_add_extensions(req_p, exts);

                if(!X509_REQ_set_pubkey(req_p, reinterpret_cast<EVP_PKEY*>(key)))
                    throw std::runtime_error("X509 request key setup failed");

                if(X509_REQ_sign(req_p, reinterpret_cast<EVP_PKEY*>(key), EVP_sha256()) <= 0)
                    throw std::runtime_error("X509 request signature failed");

                PEM_write_bio_X509_REQ(membio.GetBio(), req_p);
                membio.SendToVector(req);

                if(req->size()==0)
                    throw std::runtime_error("X509 request write failed");

                sk_X509_EXTENSION_pop_free(exts, X509_EXTENSION_free);
                X509_REQ_free(req_p);
        }
        catch(...)
        {
                sk_X509_EXTENSION_pop_free(exts, X509_EXTENSION_free);
                X509_REQ_free(req_p);
                throw;
        }
}

void EVPKey::Encrypt(unsigned datalen, const void *data, std::vector< uint8_t > *encrypted)
{
        if (publiconly)
            throw std::runtime_error("Cannot encrypt date with a public key");

        // Init the context for encryption
        if (EVP_PKEY_encrypt_init(static_cast<EVP_PKEY_CTX*>(ctx)) <= 0)
            throw std::runtime_error("Encryption failure - init failed");

        // Further context initialization, based on key type
        switch (EVP_PKEY_base_id(static_cast<EVP_PKEY*>(key)))
        {
        case EVP_PKEY_RSA:
                if (EVP_PKEY_CTX_set_rsa_padding(static_cast<EVP_PKEY_CTX*>(ctx), RSA_PKCS1_PADDING) <= 0)
                    throw std::runtime_error("Encryption failure - setting RSA padding failed");
                break;
        }

        // Determine max output length
        size_t outlen;
        if (EVP_PKEY_encrypt(static_cast<EVP_PKEY_CTX*>(ctx), NULL, &outlen, reinterpret_cast<const uint8_t *>(data), datalen) <= 0)
            throw std::runtime_error("Encryption failure - could not determine output size");
        encrypted->resize(outlen);

        // Do the actual encryption
        if (EVP_PKEY_encrypt(static_cast<EVP_PKEY_CTX*>(ctx), &(*encrypted)[0], &outlen, reinterpret_cast<const uint8_t *>(data), datalen) <= 0)
            throw std::runtime_error("Encryption failure - encryption failed");
        encrypted->resize(outlen);
}

void EVPKey::Decrypt(unsigned datalen, const void *data, std::vector< uint8_t > *decrypted)
{
        // Init the context for decryption
        if (EVP_PKEY_decrypt_init(static_cast<EVP_PKEY_CTX*>(ctx)) <= 0)
            throw std::runtime_error("Decryption failure - init failed");

        // Further context initialization, based on key type
        switch (EVP_PKEY_base_id(static_cast<EVP_PKEY*>(key)))
        {
        case EVP_PKEY_RSA:
                if (EVP_PKEY_CTX_set_rsa_padding(static_cast<EVP_PKEY_CTX*>(ctx), RSA_PKCS1_PADDING) <= 0)
                    throw std::runtime_error("Decryption failure - setting RSA padding failed");
                break;
        }

        // Determine max output length
        size_t outlen;
        if (EVP_PKEY_decrypt(static_cast<EVP_PKEY_CTX*>(ctx), NULL, &outlen, reinterpret_cast<const uint8_t *>(data), datalen) <= 0)
            throw std::runtime_error("Decryption failure - could not determine output size");
        decrypted->resize(outlen);

        // Do the actual decryption
        if (EVP_PKEY_decrypt(static_cast<EVP_PKEY_CTX*>(ctx), &(*decrypted)[0], &outlen, reinterpret_cast<const uint8_t *>(data), datalen) <= 0)
            throw std::runtime_error("Decryption failure - decryption failed");
        decrypted->resize(outlen);
}

const EVP_MD *GetEVPHashAlgorithm(HashAlgorithm::Type type)
{
        switch (type)
        {
        case HashAlgorithm::SHA256:     return EVP_sha256();
        case HashAlgorithm::SHA384:     return EVP_sha384();
        case HashAlgorithm::SHA512:     return EVP_sha512();
        default:                        return NULL;
        }
}

void EVPKey::Sign(unsigned datalen, const void *data, std::vector< uint8_t > *signature, HashAlgorithm::Type hashtype)
{
        if (publiconly)
            throw std::runtime_error("Cannot sign data with a public key");

        EVP_MD_CTX *mdctx = NULL;
        try
        {
                // Create the Message Digest Context
                mdctx = EVP_MD_CTX_create();
                if (!mdctx)
                    throw std::bad_alloc();

                // Initialise the DigestSign operation
                if (EVP_DigestSignInit(mdctx, NULL, GetEVPHashAlgorithm(hashtype), NULL, static_cast<EVP_PKEY*>(key)) <= 0)
                    throw std::runtime_error("Signature failure - init failed");

                // Call update with the message to sign
                if (EVP_DigestSignUpdate(mdctx, data, datalen) <= 0)
                    throw std::runtime_error("Signature failure - update failed");

                // Determine max output length
                size_t outlen;
                if (EVP_DigestSignFinal(mdctx, NULL, &outlen) <= 0)
                    throw std::runtime_error("Signature failure - could not determine output size");
                signature->resize(outlen);

                // Obtain the signature
                if (EVP_DigestSignFinal(mdctx, &(*signature)[0], &outlen) <= 0)
                    throw std::runtime_error("Signature failure - signature failed");
                signature->resize(outlen);

                EVP_MD_CTX_destroy(mdctx);
        }
        catch (...)
        {
                EVP_MD_CTX_destroy(mdctx);
                throw;
        }
}

bool EVPKey::Verify(unsigned datalen, const void *data, std::vector< uint8_t > const &signature, HashAlgorithm::Type hashtype)
{
        EVP_MD_CTX *mdctx = NULL;
        int result = 0;
        try
        {
                // Create the Message Digest Context
                mdctx = EVP_MD_CTX_create();
                if (!mdctx)
                    throw std::bad_alloc();

                // Initialize `key` with a public key
                if(EVP_DigestVerifyInit(mdctx, NULL, GetEVPHashAlgorithm(hashtype), NULL, static_cast<EVP_PKEY*>(key)) <= 0)
                    throw std::runtime_error("Verification failure - init failed");

                // Call update with the message to sign
                if (EVP_DigestSignUpdate(mdctx, data, datalen) <= 0)
                    throw std::runtime_error("Verification failure - update failed");

                // Finalise the DigestVerify operation
                result = EVP_DigestVerifyFinal(mdctx, &signature[0], signature.size());

                EVP_MD_CTX_destroy(mdctx);
        }
        catch (...)
        {
                EVP_MD_CTX_destroy(mdctx);
                throw;
        }
        return result == 1;
}

KeyType::Type EVPKey::GetKeyType()
{
        switch (EVP_PKEY_base_id(static_cast<EVP_PKEY*>(key)))
        {
        case EVP_PKEY_RSA: return KeyType::RSA;
        case EVP_PKEY_EC:  return KeyType::EC;
        case EVP_PKEY_DSA: return KeyType::DSA;
        case EVP_PKEY_DH:  return KeyType::DH;
        default:           return KeyType::Unknown;
        }
}
int EVPKey::GetKeyLength()
{
        return EVP_PKEY_bits(static_cast<EVP_PKEY*>(key));
}
bool EVPKey::GetPublicOnly()
{
        return publiconly;
}
std::string EVPKey::GetPrivateKey()
{
        if (publiconly)
            return "";

        MemBioWrapper membio;
        PEM_write_bio_PrivateKey(membio.GetBio(), static_cast<EVP_PKEY*>(key), 0, 0, 0, 0, 0);

        std::string retval;
        membio.SendToString(&retval);
        return retval;
}

std::string EVPKey::GetPublicKey()
{
        MemBioWrapper membio;
        PEM_write_bio_PUBKEY(membio.GetBio(), static_cast<EVP_PKEY*>(key));

        std::string retval;
        membio.SendToString(&retval);
        return retval;
}

Certificate::Certificate() //ADDME: Merge RASPublicKey into EVPKey ?
: cert(NULL)
{
}
Certificate::~Certificate()
{
        if (cert)
            X509_free(static_cast<X509*>(cert));
}
void *Certificate::Release()
{
        void *retval = cert;
        cert = NULL;
        return retval;
}
bool Certificate::ReadCertificate(SSLBIOFromData &bio)
{
        if (cert)
        {
                X509_free(static_cast<X509*>(cert));
                cert = NULL;
        }

        cert = PEM_read_bio_X509((BIO*)bio.GetBio(),0,0,0);
        if(!cert)
            GetLastSSLErrors();
        return cert != NULL;
}
bool Certificate::ReadCertificate(unsigned keylen, const void *keybytes)
{
        SSLBIOFromData databio(keylen, keybytes);
        return ReadCertificate(databio);
}

bool Certificate::GetPublicKey(std::string *publickey)
{
        bool success = false;
        publickey->clear();

        EVP_PKEY *pubkey = X509_get_pubkey(static_cast<X509*>(cert));
        if (pubkey)
        {
                MemBioWrapper membio;
                if (PEM_write_bio_PUBKEY(membio.GetBio(), pubkey))
                {
                        membio.SendToString(publickey);
                        success = true;
                }

                EVP_PKEY_free(pubkey);
        }
        else
        {
                GetLastSSLErrors();
        }
        return success;
}

bool Certificate::GetCertificateText(std::string *certificate)
{
        bool success = false;

        MemBioWrapper membio;
        if (PEM_write_bio_X509(membio.GetBio(), static_cast< X509 * >(cert)))
        {
                membio.SendToString(certificate);
                success = true;
        }
        return success;
}

void FillPseudoRandomVector(uint8_t *to_fill, unsigned to_fill_bytes)
{
        if(RAND_pseudo_bytes(to_fill,to_fill_bytes) != 1)
        {
                Blex::ErrStream() << "Failed to seed the random number generator (RAND_pseudo_bytes failed): " << GetLastSSLErrors();
                Blex::FatalAbort();
        }
        (void)VALGRIND_MAKE_MEM_DEFINED(to_fill,to_fill_bytes);
}

Hasher::~Hasher()
{
}

void GetHasher(HashAlgorithm::Type type, std::unique_ptr< Hasher > *hasher)
{
        switch (type)
        {
        case HashAlgorithm::MD4:        hasher->reset(new MultiHasher(NID_md4)); break;
        case HashAlgorithm::MD5:        hasher->reset(new MD5); break;
        case HashAlgorithm::SHA1:       hasher->reset(new SHA1); break;
        case HashAlgorithm::SHA224:     hasher->reset(new MultiHasher(NID_sha224)); break;
        case HashAlgorithm::SHA256:     hasher->reset(new SHA256); break;
        case HashAlgorithm::SHA384:     hasher->reset(new MultiHasher(NID_sha384)); break;
        case HashAlgorithm::SHA512:     hasher->reset(new MultiHasher(NID_sha512)); break;
        default: throw std::logic_error("Invalid hasher type");
        }
}

bool CheckHashLength(HashAlgorithm::Type type, unsigned lenbytes)
{
        switch (type)
        {
        case HashAlgorithm::MD4:        return lenbytes == MD4HashLen;
        case HashAlgorithm::MD5:        return lenbytes == MD5HashLen;
        case HashAlgorithm::SHA1:       return lenbytes == SHA1HashLen;
        case HashAlgorithm::SHA224:     return lenbytes == SHA224HashLen;
        case HashAlgorithm::SHA256:     return lenbytes == SHA256HashLen;
        case HashAlgorithm::SHA384:     return lenbytes == SHA384HashLen;
        case HashAlgorithm::SHA512:     return lenbytes == SHA512HashLen;
        default: throw std::logic_error("Invalid hasher type");
        }
}

MD5::MD5()
{
        buf[0] = 0x67452301;
        buf[1] = 0xefcdab89;
        buf[2] = 0x98badcfe;
        buf[3] = 0x10325476;
        totalwritten = 0;
}


/* The four core functions - F1 is optimized somewhat */

// #define F1(x, y, z) ((x & y) | (~x & z))
#define F1(x, y, z) (z ^ (x & (y ^ z)))
#define F2(x, y, z) F1(z, x, y)
#define F3(x, y, z) ((x ^ y) ^ z)
#define F4(x, y, z) (y ^ (x | ~z))

/* This is the central step in the MD5 algorithm. */
#define MD5STEP(f, w, x, y, z, data, s) \
        ( w += (f(x, y, z) + data),  (w = (w<<s) | (w>>(32-s))),  (w += x) )

/*
 * The core of the MD5 algorithm, this alters an existing MD5 hash to
 * reflect the addition of 16 longwords of new data.
 */


void MD5::Transform(const uint32_t in[16])
{
        uint32_t     a, b, c, d;

        a = buf[0];
        b = buf[1];
        c = buf[2];
        d = buf[3];

        MD5STEP(F1, a, b, c, d, in[ 0]+0xd76aa478,  7);
        MD5STEP(F1, d, a, b, c, in[ 1]+0xe8c7b756, 12);
        MD5STEP(F1, c, d, a, b, in[ 2]+0x242070db, 17);
        MD5STEP(F1, b, c, d, a, in[ 3]+0xc1bdceee, 22);
        MD5STEP(F1, a, b, c, d, in[ 4]+0xf57c0faf,  7);
        MD5STEP(F1, d, a, b, c, in[ 5]+0x4787c62a, 12);
        MD5STEP(F1, c, d, a, b, in[ 6]+0xa8304613, 17);
        MD5STEP(F1, b, c, d, a, in[ 7]+0xfd469501, 22);
        MD5STEP(F1, a, b, c, d, in[ 8]+0x698098d8,  7);
        MD5STEP(F1, d, a, b, c, in[ 9]+0x8b44f7af, 12);
        MD5STEP(F1, c, d, a, b, in[10]+0xffff5bb1, 17);
        MD5STEP(F1, b, c, d, a, in[11]+0x895cd7be, 22);
        MD5STEP(F1, a, b, c, d, in[12]+0x6b901122,  7);
        MD5STEP(F1, d, a, b, c, in[13]+0xfd987193, 12);
        MD5STEP(F1, c, d, a, b, in[14]+0xa679438e, 17);
        MD5STEP(F1, b, c, d, a, in[15]+0x49b40821, 22);

        MD5STEP(F2, a, b, c, d, in[ 1]+0xf61e2562,  5);
        MD5STEP(F2, d, a, b, c, in[ 6]+0xc040b340,  9);
        MD5STEP(F2, c, d, a, b, in[11]+0x265e5a51, 14);
        MD5STEP(F2, b, c, d, a, in[ 0]+0xe9b6c7aa, 20);
        MD5STEP(F2, a, b, c, d, in[ 5]+0xd62f105d,  5);
        MD5STEP(F2, d, a, b, c, in[10]+0x02441453,  9);
        MD5STEP(F2, c, d, a, b, in[15]+0xd8a1e681, 14);
        MD5STEP(F2, b, c, d, a, in[ 4]+0xe7d3fbc8, 20);
        MD5STEP(F2, a, b, c, d, in[ 9]+0x21e1cde6,  5);
        MD5STEP(F2, d, a, b, c, in[14]+0xc33707d6,  9);
        MD5STEP(F2, c, d, a, b, in[ 3]+0xf4d50d87, 14);
        MD5STEP(F2, b, c, d, a, in[ 8]+0x455a14ed, 20);
        MD5STEP(F2, a, b, c, d, in[13]+0xa9e3e905,  5);
        MD5STEP(F2, d, a, b, c, in[ 2]+0xfcefa3f8,  9);
        MD5STEP(F2, c, d, a, b, in[ 7]+0x676f02d9, 14);
        MD5STEP(F2, b, c, d, a, in[12]+0x8d2a4c8a, 20);

        MD5STEP(F3, a, b, c, d, in[ 5]+0xfffa3942,  4);
        MD5STEP(F3, d, a, b, c, in[ 8]+0x8771f681, 11);
        MD5STEP(F3, c, d, a, b, in[11]+0x6d9d6122, 16);
        MD5STEP(F3, b, c, d, a, in[14]+0xfde5380c, 23);
        MD5STEP(F3, a, b, c, d, in[ 1]+0xa4beea44,  4);
        MD5STEP(F3, d, a, b, c, in[ 4]+0x4bdecfa9, 11);
        MD5STEP(F3, c, d, a, b, in[ 7]+0xf6bb4b60, 16);
        MD5STEP(F3, b, c, d, a, in[10]+0xbebfbc70, 23);
        MD5STEP(F3, a, b, c, d, in[13]+0x289b7ec6,  4);
        MD5STEP(F3, d, a, b, c, in[ 0]+0xeaa127fa, 11);
        MD5STEP(F3, c, d, a, b, in[ 3]+0xd4ef3085, 16);
        MD5STEP(F3, b, c, d, a, in[ 6]+0x04881d05, 23);
        MD5STEP(F3, a, b, c, d, in[ 9]+0xd9d4d039,  4);
        MD5STEP(F3, d, a, b, c, in[12]+0xe6db99e5, 11);
        MD5STEP(F3, c, d, a, b, in[15]+0x1fa27cf8, 16);
        MD5STEP(F3, b, c, d, a, in[ 2]+0xc4ac5665, 23);

        MD5STEP(F4, a, b, c, d, in[ 0]+0xf4292244,  6);
        MD5STEP(F4, d, a, b, c, in[ 7]+0x432aff97, 10);
        MD5STEP(F4, c, d, a, b, in[14]+0xab9423a7, 15);
        MD5STEP(F4, b, c, d, a, in[ 5]+0xfc93a039, 21);
        MD5STEP(F4, a, b, c, d, in[12]+0x655b59c3,  6);
        MD5STEP(F4, d, a, b, c, in[ 3]+0x8f0ccc92, 10);
        MD5STEP(F4, c, d, a, b, in[10]+0xffeff47d, 15);
        MD5STEP(F4, b, c, d, a, in[ 1]+0x85845dd1, 21);
        MD5STEP(F4, a, b, c, d, in[ 8]+0x6fa87e4f,  6);
        MD5STEP(F4, d, a, b, c, in[15]+0xfe2ce6e0, 10);
        MD5STEP(F4, c, d, a, b, in[ 6]+0xa3014314, 15);
        MD5STEP(F4, b, c, d, a, in[13]+0x4e0811a1, 21);
        MD5STEP(F4, a, b, c, d, in[ 4]+0xf7537e82,  6);
        MD5STEP(F4, d, a, b, c, in[11]+0xbd3af235, 10);
        MD5STEP(F4, c, d, a, b, in[ 2]+0x2ad7d2bb, 15);
        MD5STEP(F4, b, c, d, a, in[ 9]+0xeb86d391, 21);

        buf[0] += a;
        buf[1] += b;
        buf[2] += c;
        buf[3] += d;
}

// -- MD5 transformation function that works on buffer, by rob
void MD5::Process(const void *dataptr,unsigned length)
{
        const uint8_t *data=static_cast<const uint8_t*>(dataptr);

        while (length > 0)
        {
                unsigned currentpos = static_cast<unsigned>(totalwritten & 63);
                unsigned room = 64 - currentpos;

                unsigned moveamount = length;
                if (moveamount > room)
                    moveamount = room;

                std::memcpy(&databuffer[currentpos], data, moveamount);

                data += moveamount;
                length -= moveamount;
                totalwritten += moveamount;

                if (moveamount == room)
                {
                        // Transform buffer to list of uint32_t words
                        uint32_t tmpbuf[16];
                        for (unsigned i=0;i<16;++i)
                            tmpbuf[i] = getu32lsb(databuffer + 4*i);
                        Transform(tmpbuf);
                }
        }
}

// -- MD5 finalization function (call this before asking for hash!)
Blex::StringPair MD5::FinalizeHash()
{
        uint64_t length = totalwritten * 8;

        // Pad to 56 mod 64, minimum 1 padding byte
        unsigned currentpos = static_cast<unsigned>(totalwritten & 63);
        unsigned padbytes = ((119 - currentpos) % 64) + 1;

        //Create the padding buffer
        uint8_t finaldata[128];
        memset(finaldata, 0, padbytes);
        finaldata[0]=0x80; //set first bit
        putu64lsb(finaldata + padbytes, length);

        Process(finaldata, padbytes + sizeof(uint64_t));
        return Blex::StringPair(reinterpret_cast<char*>(&buf), reinterpret_cast<char*>(&buf) + Blex::MD5HashLen);
}

void GetMD5Hash(const void *data, unsigned len, void *hashstore)
{
        Blex::MD5 retval;
        retval.Process(data,len);
        memcpy(hashstore, retval.Finalize(), MD5HashLen);
}

SHA256::SHA256()
{
        SHA256_Init(&context);
}

void SHA256::Process(const void *data, unsigned length)
{
        SHA256_Update(&context, (unsigned char*)data, length);
}

Blex::StringPair SHA256::FinalizeHash()
{
        SHA256_Final(md, &context);
        return Blex::StringPair(reinterpret_cast<char*>(&md), reinterpret_cast<char*>(&md) + Blex::SHA256HashLen);
}

MultiHasher::MultiHasher(int nid_type)
{
        EVP_MD const *evp = EVP_get_digestbynid(nid_type);
        if (!evp)
            throw std::runtime_error("Illegal hasher nid_type");

        evp_md_ctx = EVP_MD_CTX_new();
        if(!evp_md_ctx)
                throw std::bad_alloc();

        EVP_DigestInit(evp_md_ctx, evp);
}
MultiHasher::~MultiHasher()
{
        EVP_MD_CTX_free(evp_md_ctx);
}

void MultiHasher::Process(const void *data,unsigned length)
{
        EVP_DigestUpdate(evp_md_ctx, data, length);
}

Blex::StringPair MultiHasher::FinalizeHash()
{
        unsigned int outlen = 0;
        int retval = EVP_DigestFinal(evp_md_ctx, digest, &outlen);
        if (!retval)
            throw std::runtime_error("EVP_DigestFinal returned error: " + GetLastSSLErrors());
        return Blex::StringPair(reinterpret_cast<char*>(&digest), reinterpret_cast<char*>(&digest) + outlen);
}

RC4::RC4()
: x(0)
, y(0)
{
}

RC4::RC4(void const *inkey, unsigned keylen)
{
        InitKey(inkey,keylen);
}

void RC4::InitKey(void const *inkey, unsigned keylen)
{
        uint8_t const *key=static_cast<uint8_t const*>(inkey);
        x=0;
        y=0;
        for (unsigned i = 0; i < 256; ++i)
            state[i] = uint8_t(i);

        unsigned index1 = 0;
        unsigned index2 = 0;
        for (unsigned i = 0; i < 256; ++i)
        {
                index2 = (key[index1] + state[i] + index2) % 256;
                std::swap(state[i], state[index2]);
                index1 = (index1 + 1) % keylen;
        }
}

void RC4::CryptBuffer(void *inbuffer, unsigned bufferlen)
{
        uint8_t *buffer=static_cast<uint8_t*>(inbuffer);
        while(bufferlen>0)
        {
                x = (x + 1) % 256;
                y = (state[x] + y) % 256;
                std::swap(state[x],state[y]);
                *buffer ^= state[(state[x] + state[y]) % 256];
                ++buffer;
                --bufferlen;
        }
}

uint8_t RC4::CryptByte(uint8_t inbyte)
{
        CryptBuffer(&inbyte,1);
        return inbyte;
}

RC4CryptingStream::RC4CryptingStream(Blex::Stream &in)
: Stream(true)
, in(in)
{
}
RC4CryptingStream::~RC4CryptingStream()
{
}
void RC4CryptingStream::InitKey(void const *key, unsigned keylen)
{
        crypt.InitKey(key,keylen);
}
std::size_t RC4CryptingStream::Read(void *buf,std::size_t maxbufsize)
{
        std::size_t bytesread = in.Read(buf,maxbufsize);
        crypt.CryptBuffer(buf,bytesread);
        return bytesread;
}
std::size_t RC4CryptingStream::Write(const void *buf, std::size_t maxbufsize)
{
        std::vector<uint8_t> temp(static_cast<const char*>(buf), static_cast<const char*>(buf) + maxbufsize);
        crypt.CryptBuffer(&temp[0],maxbufsize);
        return in.Write(&temp[0],maxbufsize);
}
bool RC4CryptingStream::EndOfStream()
{
        return in.EndOfStream();
}

static const char b64t[65] =
"./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

//expect saltdata of form $1$salt$password....
void GetMD5Crypt(const void *keydata, unsigned keylen, const void *saltdata, unsigned saltlen, std::vector<uint8_t> *buffer)
{
        buffer->clear();
        buffer->reserve(3/* $1$ */ + saltlen + 1/* $ */ + 26);

        MD5 ctx, altctx;
        const uint8_t *key = static_cast<const uint8_t*>(keydata);
        const uint8_t *salt = static_cast<const uint8_t*>(saltdata);
        const uint8_t *saltend = salt+saltlen;

        if(saltlen>=3 && salt[0]=='$' && salt[2]=='$' && salt[1]=='1') //skip prefix
            salt += 3;

        saltend = std::find(salt, std::min(salt+8,saltend), '$');
        ctx.Process(key,keylen);
        ctx.Process("$1$",3);
        ctx.Process(salt,std::distance(salt,saltend));

        altctx.Process(key,keylen);
        altctx.Process(salt,std::distance(salt,saltend));
        altctx.Process(key,keylen);

        uint8_t const *finalized_altctx = altctx.Finalize();

        /* Add for any character in the key one byte of the alternate sum.  */
        unsigned cnt;
        for(cnt=keylen; cnt > 16; cnt-=16)
            ctx.Process(finalized_altctx, 16);
        ctx.Process(finalized_altctx, cnt);

        /* The original implementation now does something weird: for every 1
           bit in the key the first 0 is added to the buffer, for every 0
           bit the first character of the key.  This does not seem to be
           what was intended but we have to follow this to be compatible.  */
        uint8_t nulbyte = 0;
        for (cnt = keylen; cnt > 0; cnt >>= 1)
            ctx.Process((cnt & 1) != 0 ? &nulbyte : key, 1);

        uint8_t intermediate[16];
        memcpy(intermediate, ctx.Finalize(), sizeof intermediate);

        /* Now comes another weirdness.  In fear of password crackers here
           comes a quite long loop which just processes the output of the
           previous round again.  We cannot ignore this here.  */
        for (cnt=0;cnt<1000;++cnt)
        {
                MD5 newcontext;

                /* Add key or last result.  */
                if ((cnt & 1) != 0)
                    newcontext.Process(key, keylen);
                else
                    newcontext.Process(intermediate, 16);

                /* Add salt for numbers not divisible by 3.  */
                if (cnt % 3 != 0)
                    newcontext.Process(salt, std::distance(salt, saltend));

                /* Add key for numbers not divisible by 7.  */
                if (cnt % 7 != 0)
                    newcontext.Process(key, keylen);

                /* Add key or last result.  */
                if ((cnt & 1) != 0)
                    newcontext.Process(intermediate, 16);
                else
                    newcontext.Process(key, keylen);

                /* Create intermediate result.  */
                memcpy(intermediate, newcontext.Finalize(), sizeof intermediate);
        }

        /* Now we can construct the result string.  It consists of three parts.  */
        buffer->push_back('$');
        buffer->push_back('1');
        buffer->push_back('$');

        buffer->insert(buffer->end(), salt, saltend);
        buffer->push_back('$');

        //ADDME: Mergable with our Base64 code? or too odd?
#define b64_from_24bit(B2, B1, B0, N)                                         \
  do {                                                                        \
    unsigned int w = ((B2) << 16) | ((B1) << 8) | (B0);                       \
    int n = (N);                                                              \
    while (n-- > 0)                                             \
      {                                                                       \
        buffer->push_back(b64t[w & 0x3f]);                                     \
        w >>= 6;                                                              \
      }                                                                       \
  } while (0)


        b64_from_24bit (intermediate[0], intermediate[6], intermediate[12], 4);
        b64_from_24bit (intermediate[1], intermediate[7], intermediate[13], 4);
        b64_from_24bit (intermediate[2], intermediate[8], intermediate[14], 4);
        b64_from_24bit (intermediate[3], intermediate[9], intermediate[15], 4);
        b64_from_24bit (intermediate[4], intermediate[10], intermediate[5], 4);
        b64_from_24bit (0, 0, intermediate[11], 2);
}

void GetDESCrypt(const void *keydata, unsigned keylen, const void *saltdata, unsigned saltlen, std::vector<uint8_t> *buffer)
{
        if (saltlen != 2)
        {
                buffer->clear();
                return;
        }

        char const *keybegin = static_cast<char const*>(keydata);
        char const *saltbegin = static_cast<char const*>(saltdata);

        std::string key(keybegin, keybegin + keylen);
        std::string salt(saltbegin, saltbegin + saltlen);

        // Need 14 bytes of storage (13 bytes cryptresult, one 0-byte)
        buffer->resize(14);
        DES_fcrypt(key.c_str(), salt.c_str(), reinterpret_cast< char * >(&(*buffer)[0]));

        // Remove the 0-byte
        buffer->resize(13);
}


/* Important FIXMEs and ADDMEs
   - a good PRNG initialisation
   - buffers of 1k are way too small
   - we can enable partial writes (see SSL_write manpage) so that we get data
     in 16KB chunks - allows us to lower our own buffering requirements? */

SSLContext::SSLContext(bool is_server, std::string const &ciphersuite, int securitylevel)
: is_server(is_server)
{
        ctx=SSL_CTX_new(is_server ? SSLv23_server_method() : SSLv23_client_method());
        if (!ctx)
        {
                GetLastSSLErrors();
                throw std::runtime_error("Cannot initialize SSL context");
        }

        if (is_server)
            SSL_CTX_set_min_proto_version((SSL_CTX*)ctx, TLS1_2_VERSION);

        SSL_CTX_set_options((SSL_CTX*)ctx, SSL_OP_ALL
                                           | (is_server ? SSL_OP_NO_RENEGOTIATION : 0)
                                           | SSL_OP_SINGLE_DH_USE //http://www.opensource.apple.com/source/apache/apache-678/mod_ssl/pkg.sslmod/ssl_engine_init.c doe sit
                                           | SSL_OP_CIPHER_SERVER_PREFERENCE
                                           | SSL_OP_SINGLE_ECDH_USE
                                           );

        SSL_CTX_set_ecdh_auto((SSL_CTX*)ctx, 1);

        if(!ciphersuite.empty())
        {
                //https://wiki.mozilla.org/Security/Server_Side_TLS intermediate recommends "ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:DHE-DSS-AES128-GCM-SHA256:ECDHE-RSA-AES128-SHA256:ECDHE-ECDSA-AES128-SHA256:ECDHE-RSA-AES128-SHA:ECDHE-ECDSA-AES128-SHA:ECDHE-RSA-AES256-SHA384:ECDHE-ECDSA-AES256-SHA384:ECDHE-RSA-AES256-SHA:ECDHE-ECDSA-AES256-SHA:DHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA:DHE-DSS-AES128-SHA256:DHE-RSA-AES256-SHA256:DHE-DSS-AES256-SHA:DHE-RSA-AES256-SHA:AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA256:AES256-SHA256:AES128-SHA:AES256-SHA:AES:CAMELLIA:DES-CBC3-SHA:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!aECDH:!EDH-DSS-DES-CBC3-SHA:!EDH-RSA-DES-CBC3-SHA:!KRB5-DES-CBC3-SHA"
                if(!SSL_CTX_set_cipher_list((SSL_CTX*)ctx, ciphersuite.c_str()))
                    throw std::runtime_error("Unable to setup SSL cipher list");
        }
        SSL_CTX_set_security_level((SSL_CTX*)ctx, securitylevel);

        if (is_server)
        {
                SSL_CTX_set_session_cache_mode((SSL_CTX*)ctx, SSL_SESS_CACHE_SERVER);
                //we may need to do this if we start supporting SNI: SSL_CTX_set_options(ctx, SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION
                // (https://groups.google.com/forum/#!topic/mailing.openssl.dev/K7mucVPcldk )
        }
}

SSLContext::~SSLContext()
{
        SSL_CTX_free((SSL_CTX*)ctx);
}

bool SSLContext::LoadPrivateKey(const void *keydata, unsigned keylen)
{
        EVPKey key;
        if(!key.ReadPrivateKey(keylen,keydata))
            return false;

        if(!SSL_CTX_use_PrivateKey((SSL_CTX *)ctx, (EVP_PKEY*)key.key))
        {
                GetLastSSLErrors(); //at least make errors visible in debug mode
                return false;
        }

        return true;
}
bool SSLContext::LoadCertificate(const void *keydata, unsigned keylen)
{
        Certificate key;
        if(!key.ReadCertificate(keylen,keydata))
            return false;

        if(!SSL_CTX_use_certificate((SSL_CTX *)ctx, (X509*)key.cert))
        {
                GetLastSSLErrors(); //at least make errors visible in debug mode
                return false;
        }

        return true;
}
bool SSLContext::LoadCertificateChain(const void *keydata, unsigned keylen)
{
        SSLBIOFromData databio(keylen, keydata);
        Certificate key;
        if (!key.ReadCertificate(databio))
            return false;

        if(!SSL_CTX_use_certificate((SSL_CTX *)ctx, (X509*)key.cert))
        {
                GetLastSSLErrors(); //at least make errors visible in debug mode
                return false;
        }

        SSL_CTX_clear_chain_certs((SSL_CTX *)ctx);
        while (key.ReadCertificate(databio))
        {
                if(SSL_CTX_add_extra_chain_cert((SSL_CTX *)ctx, (X509*)key.cert))
                {
                        //OpenSSL code says: dont free on succesful add, unlike the main certificate
                        key.Release();
                }
                else
                {
                        GetLastSSLErrors();
                        return false;
                }
        }
        return true;
}

SSLContext::LoadErrors SSLContext::Load(std::string const &keyfile,std::string const &certfile)
{
        if (!SSL_CTX_use_PrivateKey_file((SSL_CTX *)ctx, keyfile.c_str(), SSL_FILETYPE_PEM))
            return CannotReadKey;
        if (!SSL_CTX_use_certificate_chain_file((SSL_CTX *)ctx, certfile.c_str()))
            return CannotReadCert;

/* FIXME        //verify key and cert
        if (!X509_check_private_key((X509*)X509_certs[0],(EVP_PKEY*)EVP_key))
        {
                Reset();
                return KeyCertMismatch;
        }
*/
        return AllOk;
}

SSLConnection::SSLConnection(SSLContext &sslcontext)
: feed_read_buffer_len(0)
, ssl_wants_read(false)
, ssl_can_write(false)
, ssl_blocked_until_read(false)
, is_server(sslcontext.IsServerContext())
{
        SSL_data = SSL_new((SSL_CTX*)sslcontext.ctx);

        BIO_read_buffer = BIO_new(BIO_s_mem());
        BIO_write_buffer = BIO_new(BIO_s_mem());
        SSL_set_bio((SSL*)SSL_data,(BIO*)BIO_read_buffer,(BIO*)BIO_write_buffer);

        //ADDME:     SSL_set_session_id_context(c->ssl, sid_ctx, strlen(sid_ctx));
        if (sslcontext.IsServerContext())
            SSL_set_accept_state((SSL*)SSL_data);
        else
            SSL_set_connect_state((SSL*)SSL_data);

        read_buffer_len=0;
        write_buffer_len=0;
        established=true;
}

bool SSLConnection::MustWaitWithFeedOutgoingData()
{
        void *p;
        int size = BIO_get_mem_data((BIO*)BIO_write_buffer, &p);
        DEBUGSSLPRINT("SSL: check size of outgoing data buffer: " << size << " bytes");
        return size >= 16384;
}

void SSLConnection::DoOutput()
{
        //ADDME: The writebuffer is pointless with normal sockets: only the dispatcher needs such extenralized buffers for async i/o
        //See if there is encrypted data waiting to be sent, ie: refill our outgoing data buffers to make sure we have full packets to send
        if (write_buffer_len < static_cast< int >(sizeof write_buffer))
        {
                int extradata = BIO_read((BIO*)BIO_write_buffer, write_buffer+write_buffer_len, sizeof write_buffer - write_buffer_len);
                if (extradata>0)
                {
                        write_buffer_len += extradata;
                        DEBUGSSLPRINT("SSL: Encrypted data from BIO to send: " << extradata << " bytes. total bufferlen = " << write_buffer_len);

                        // Allow waiting on underlying socket to become writable again
                        ssl_blocked_until_read = false;
                        DEBUGSSLPRINT("SSL: DoOutput: ssl_blocked_until_read set to " << ssl_blocked_until_read);
                }
        }
}

void SSLConnection::DoEstablish()
{
        if (!remotehostname.empty())
        {
                DEBUGSSLPRINT("SSL_set_tlsext_host_name " << remotehostname);
                SSL_set_tlsext_host_name((SSL*)SSL_data, remotehostname.c_str());
        }
        if(!ssl_broken_error.empty())
                return;

        DEBUGSSLPRINT("DoEstablish : " << (is_server ? "SSL_accept " : "SSL_connect ") << (SSL*)SSL_data);
        ERR_clear_error();
        int try_establish = is_server ? SSL_accept((SSL*)SSL_data) : SSL_connect((SSL*)SSL_data);
        int err=SSL_get_error((SSL*)SSL_data, try_establish);
        switch (err)
        {
        case SSL_ERROR_NONE:
                DEBUGSSLPRINT("SSL: connection established, session: " << SSL_get_session((SSL*)SSL_data));
                DoOutput();
                established=true;
                break;
        case SSL_ERROR_WANT_READ:
                DEBUGSSLPRINT("SSL: establish: requires reading");
                ssl_blocked_until_read = write_buffer_len == 0;
                DEBUGSSLPRINT("SSL: DoEstablish: ssl_blocked_until_read set to " << ssl_blocked_until_read);
                DoOutput();
                ssl_wants_read=true;
                break;
        case SSL_ERROR_WANT_WRITE:
                DEBUGSSLPRINT("SSL: establish: requires writing");
                DoOutput();
                break;
        case SSL_ERROR_SSL:
                ssl_broken_error = GetLastSSLErrors();
                Shutdown();
                DEBUGSSLPRINT("SSL: DoEstablish: error (write_buffer_len = " << write_buffer_len << ")");
                //FIXME ensure upper layers disconnet
                break;
        default:
                DEBUGSSLPRINT("SSL: establish: unknown error");
                break;
        }
}

void SSLConnection::Shutdown()
{
        SSL_shutdown((SSL*)SSL_data);
        DoOutput();
}
bool SSLConnection::PollIncomingData()
{
        //Try to get some progress on reading..
        if (!established)
            DoEstablish();
        if(!ssl_broken_error.empty())
            return false;

        //Try to get unencrypted data into our own buffers
        while (established && read_buffer_len < static_cast< int >(sizeof read_buffer))
        {
                ERR_clear_error();
                int try_read = SSL_read ((SSL*)SSL_data, read_buffer+read_buffer_len, sizeof read_buffer - read_buffer_len);
                int err=SSL_get_error((SSL*)SSL_data, try_read);
                switch (err)
                {
                case SSL_ERROR_NONE:
                        DEBUGSSLPRINT("SSL: " << try_read << " unencrypted bytes read");
                        DoOutput();
                        read_buffer_len += try_read;
                        if(try_read==0) //no data
                        {
                                DEBUGSSLPRINT("SSL: SSL_read: unexpected error none?");
                                Shutdown();
                                ssl_broken_error = "Unexpected error 'none' on PollIncomingData";
                                return false;
                        }
                        break;
                case SSL_ERROR_WANT_READ:
                        DEBUGSSLPRINT("SSL: SSL_read: requires reading");
                        DoOutput();
                        ssl_wants_read=true;
                        return true;
                case SSL_ERROR_WANT_WRITE:
                        DEBUGSSLPRINT("SSL: SSL_read: requires writing");
                        DoOutput();
                        return true;
                case SSL_ERROR_SSL:
                        ssl_broken_error = GetLastSSLErrors();
                        Shutdown();
                        DEBUGSSLPRINT("SSL: PollIncomingData: error (try_read = " << try_read << ", read_buffer_len = " << read_buffer_len << ")");
                       //FIXME ensure upper layers disconnet
                        return false;
                case SSL_ERROR_ZERO_RETURN:
                        // The remote application shut down the SSL connection normally. Issue the SSL_shutdown
                        // function to shut down data flow for an SSL session.
                        SSL_shutdown((SSL*)SSL_data);
                        return true;
                default:
                        DEBUGSSLPRINT("SSL: SSL_read: unknown error");
                        return false;
                }
        }
        return true;
}

unsigned SSLConnection::FeedIncomingData(void const *data, unsigned datalen)
{
        if (datalen)
        {
                ssl_blocked_until_read = false;
                DEBUGSSLPRINT("SSL: FeedIncomingData: ssl_blocked_until_read set to " << ssl_blocked_until_read);
        }

        int data_written = datalen ? BIO_write((BIO*)BIO_read_buffer, data, datalen) : 0;
        if (data_written < 0)
        {
                DEBUGSSLPRINT("SSL: incoming data error: " << data_written);
                return 0;
        }
        return data_written;
}

int SSLConnection::FeedOutgoingData(void const *data, unsigned datalen)
{
        if(!ssl_broken_error.empty())
            return -1; //we already broke
        if (!established)
            DoEstablish();

        if (!established || !ssl_broken_error.empty())
            return 0; //cannot write!

        DEBUGSSLPRINT("SSL: FeedOutgoingData extra dooutput call");
        DoOutput();
        DEBUGSSLPRINT("SSL: FeedOutgoingData done  dooutput call");

        DEBUGSSLPRINT("SSL: SSL_write: offering " << datalen << " bytes to encrypt");

        ERR_clear_error();
        int try_write = SSL_write ((SSL*)SSL_data, data, datalen);
        ssl_can_write = try_write > 0;
        int err = SSL_get_error((SSL*)SSL_data, try_write);
        switch (err)
        {
        case SSL_ERROR_NONE:
                DEBUGSSLPRINT("SSL: " << try_write << " bytes sent to the encryptor");
                break;
        case SSL_ERROR_WANT_READ:
                DEBUGSSLPRINT("SSL: SSL_write: SSL_ERROR_WANT_READ - we need to read encrypted data to proceed");
                ssl_wants_read=true;
                ssl_blocked_until_read = write_buffer_len == 0;
                DEBUGSSLPRINT("SSL: SSL_write: ssl_blocked_until_read set to " << ssl_blocked_until_read);
                break;
        case SSL_ERROR_WANT_WRITE:
                DEBUGSSLPRINT("SSL: SSL_write: requires writing");
                break;
        case SSL_ERROR_SSL:
                ssl_broken_error = GetLastSSLErrors();
                Shutdown();
                DEBUGSSLPRINT("SSL: FeedOutgoingData: error (try_write = " << try_write << ", datalen = " << datalen << ")");
               //FIXME ensure upper layers disconnet
                 return -1;
        default:
                DEBUGSSLPRINT("SSL: SSL_write: unknown error");
                return -1;
        }

        int retval=err==SSL_ERROR_NONE ? try_write : 0;
        DoOutput();
        return retval;
}

SSLConnection::~SSLConnection()
{
        SSL_free((SSL*)SSL_data);
}

void SSLConnection::DiscardIncomingBytes(unsigned len)
{
        read_buffer_len-=len;
        if (read_buffer_len)
            std::memmove(read_buffer,read_buffer+len,read_buffer_len);
}

void SSLConnection::DiscardOutgoingBytes(unsigned len)
{
        write_buffer_len-=len;
        if (write_buffer_len)
            std::memmove(write_buffer,write_buffer+len,write_buffer_len);

        DoOutput(); //get more bytes!
}

void SSLConnection::SetRemoteHostname(std::string const &_remotehostname)
{
        remotehostname = _remotehostname;
}

bool SSLConnection::GetPeerCertificateChain(std::string *dest)
{
        bool success = true;

        STACK_OF(X509) *stack = SSL_get_peer_cert_chain((SSL*)SSL_data);
        DEBUGSSLPRINT("SSL Conn GetPeerCertificateChain: " << (void*)stack);
        if (stack)
        {
                DEBUGSSLPRINT("SSL Conn GetPeerCertificateChain count: " << sk_X509_num(stack));

                for (signed i = 0; i < sk_X509_num(stack); ++i)
                {
                        // Don't free afterwards!
                        X509 *rawcertata = sk_X509_value(stack, i);

                        MemBioWrapper membio;
                        if (PEM_write_bio_X509(membio.GetBio(), static_cast< X509 * >(rawcertata)))
                            membio.SendToString(dest);
                        else
                            success = false;
                }
        }
        return success;
}


/** Length of a SSHA1 salt */
const unsigned SSHA1SaltLen = 8;
/** Offset of a SSHA1 salt inside an encoded SSHA1 password*/
const unsigned SSHA1SaltOffset = 6;
/** LEngth of a MD5 password  */
const unsigned MD5PasswordLen = 20;

// #define F1(x, y, z) ((x & y) | (~x & z))
#define F1(x, y, z) (z ^ (x & (y ^ z)))
#define F2(x, y, z) F1(z, x, y)
#define F3(x, y, z) ((x ^ y) ^ z)
#define F4(x, y, z) (y ^ (x | ~z))

/* This is the central step in the MD5 algorithm. */
#define MD5STEP(f, w, x, y, z, data, s) \
        ( w += (f(x, y, z) + data),  (w = (w<<s) | (w>>(32-s))),  (w += x) )

/* The Broken MD5 implementation for reading pre-v2.20 WebHare databases
   password fields. For newly stored passwords, we have switched to seeded SHA1
   storage */
class BrokenMD5
{
        public:
        ///Construct a MD5 with the required initial values
        BrokenMD5()
        {
                buf[0] = 0x67452301;
                buf[1] = 0xefcdab89;
                buf[2] = 0x98badcfe;
                buf[3] = 0x10325476;
        }

        const uint32_t *GetValue() const { return buf; }
        void TransformBuffer(const void *dataptr,unsigned length);

        private:
        void Transform(const uint32_t in[16])
        {
                uint32_t     a, b, c, d;

                a = buf[0];
                b = buf[1];
                c = buf[2];
                d = buf[3];

                MD5STEP(F1, a, b, c, d, in[ 0]+0xd76aa478,  7);
                MD5STEP(F1, d, a, b, c, in[ 1]+0xe8c7b756, 12);
                MD5STEP(F1, c, d, a, b, in[ 2]+0x242070db, 17);
                MD5STEP(F1, b, c, d, a, in[ 3]+0xc1bdceee, 22);
                MD5STEP(F1, a, b, c, d, in[ 4]+0xf57c0faf,  7);
                MD5STEP(F1, d, a, b, c, in[ 5]+0x4787c62a, 12);
                MD5STEP(F1, c, d, a, b, in[ 6]+0xa8304613, 17);
                MD5STEP(F1, b, c, d, a, in[ 7]+0xfd469501, 22);
                MD5STEP(F1, a, b, c, d, in[ 8]+0x698098d8,  7);
                MD5STEP(F1, d, a, b, c, in[ 9]+0x8b44f7af, 12);
                MD5STEP(F1, c, d, a, b, in[10]+0xffff5bb1, 17);
                MD5STEP(F1, b, c, d, a, in[11]+0x895cd7be, 22);
                MD5STEP(F1, a, b, c, d, in[12]+0x6b901122,  7);
                MD5STEP(F1, d, a, b, c, in[13]+0xfd987193, 12);
                MD5STEP(F1, c, d, a, b, in[14]+0xa679438e, 17);
                MD5STEP(F1, b, c, d, a, in[15]+0x49b40821, 22);

                MD5STEP(F2, a, b, c, d, in[ 1]+0xf61e2562,  5);
                MD5STEP(F2, d, a, b, c, in[ 6]+0xc040b340,  9);
                MD5STEP(F2, c, d, a, b, in[11]+0x265e5a51, 14);
                MD5STEP(F2, b, c, d, a, in[ 0]+0xe9b6c7aa, 20);
                MD5STEP(F2, a, b, c, d, in[ 5]+0xd62f105d,  5);
                MD5STEP(F2, d, a, b, c, in[10]+0x02441453,  9);
                MD5STEP(F2, c, d, a, b, in[15]+0xd8a1e681, 14);
                MD5STEP(F2, b, c, d, a, in[ 4]+0xe7d3fbc8, 20);
                MD5STEP(F2, a, b, c, d, in[ 9]+0x21e1cde6,  5);
                MD5STEP(F2, d, a, b, c, in[14]+0xc33707d6,  9);
                MD5STEP(F2, c, d, a, b, in[ 3]+0xf4d50d87, 14);
                MD5STEP(F2, b, c, d, a, in[ 8]+0x455a14ed, 20);
                MD5STEP(F2, a, b, c, d, in[13]+0xa9e3e905,  5);
                MD5STEP(F2, d, a, b, c, in[ 2]+0xfcefa3f8,  9);
                MD5STEP(F2, c, d, a, b, in[ 7]+0x676f02d9, 14);
                MD5STEP(F2, b, c, d, a, in[12]+0x8d2a4c8a, 20);

                MD5STEP(F3, a, b, c, d, in[ 5]+0xfffa3942,  4);
                MD5STEP(F3, d, a, b, c, in[ 8]+0x8771f681, 11);
                MD5STEP(F3, c, d, a, b, in[11]+0x6d9d6122, 16);
                MD5STEP(F3, b, c, d, a, in[14]+0xfde5380c, 23);
                MD5STEP(F3, a, b, c, d, in[ 1]+0xa4beea44,  4);
                MD5STEP(F3, d, a, b, c, in[ 4]+0x4bdecfa9, 11);
                MD5STEP(F3, c, d, a, b, in[ 7]+0xf6bb4b60, 16);
                MD5STEP(F3, b, c, d, a, in[10]+0xbebfbc70, 23);
                MD5STEP(F3, a, b, c, d, in[13]+0x289b7ec6,  4);
                MD5STEP(F3, d, a, b, c, in[ 0]+0xeaa127fa, 11);
                MD5STEP(F3, c, d, a, b, in[ 3]+0xd4ef3085, 16);
                MD5STEP(F3, b, c, d, a, in[ 6]+0x04881d05, 23);
                MD5STEP(F3, a, b, c, d, in[ 9]+0xd9d4d039,  4);
                MD5STEP(F3, d, a, b, c, in[12]+0xe6db99e5, 11);
                MD5STEP(F3, c, d, a, b, in[15]+0x1fa27cf8, 16);
                MD5STEP(F3, b, c, d, a, in[ 2]+0xc4ac5665, 23);

                MD5STEP(F4, a, b, c, d, in[ 0]+0xf4292244,  6);
                MD5STEP(F4, d, a, b, c, in[ 7]+0x432aff97, 10);
                MD5STEP(F4, c, d, a, b, in[14]+0xab9423a7, 15);
                MD5STEP(F4, b, c, d, a, in[ 5]+0xfc93a039, 21);
                MD5STEP(F4, a, b, c, d, in[12]+0x655b59c3,  6);
                MD5STEP(F4, d, a, b, c, in[ 3]+0x8f0ccc92, 10);
                MD5STEP(F4, c, d, a, b, in[10]+0xffeff47d, 15);
                MD5STEP(F4, b, c, d, a, in[ 1]+0x85845dd1, 21);
                MD5STEP(F4, a, b, c, d, in[ 8]+0x6fa87e4f,  6);
                MD5STEP(F4, d, a, b, c, in[15]+0xfe2ce6e0, 10);
                MD5STEP(F4, c, d, a, b, in[ 6]+0xa3014314, 15);
                MD5STEP(F4, b, c, d, a, in[13]+0x4e0811a1, 21);
                MD5STEP(F4, a, b, c, d, in[ 4]+0xf7537e82,  6);
                MD5STEP(F4, d, a, b, c, in[11]+0xbd3af235, 10);
                MD5STEP(F4, c, d, a, b, in[ 2]+0x2ad7d2bb, 15);
                MD5STEP(F4, b, c, d, a, in[ 9]+0xeb86d391, 21);

                buf[0] += a;
                buf[1] += b;
                buf[2] += c;
                buf[3] += d;
        }

        uint32_t buf[4];
};

/** DEPRECATED Adds a buffer of data to the current message. Does not conform to MD5 algorithm!
    @param data Address of buffer
    @param Length of buffer */
void BrokenMD5::TransformBuffer(const void *dataptr,unsigned length)
{
        const uint8_t *data=static_cast<const uint8_t*>(dataptr);
        uint32_t tmpbuf[16];

        for (unsigned startpos=0;startpos<length;startpos+=64)
            {
                for (unsigned i=0;i<16;++i)
                    {
                        int temp=length-(startpos+i*4);

                        if (temp>=4) //it all fits
                            {
                                //then we can go for an easy conversion
                                tmpbuf[i]=(data[startpos+i*4]<<24)|(data[startpos+i*4+1]<<16)|
                                       (data[startpos+i*4+2]<<8)|(data[startpos+i*4+3]);
                            }
                        else if (temp>=3) //it all fits, except the last low-byte
                            {
                                tmpbuf[i]=(data[startpos+i*4]<<24)|(data[startpos+i*4+1]<<16)|
                                       (data[startpos+i*4+2]<<8);
                            }
                        else if (temp>=2) //it all fits, except the last low-byte
                            {
                                tmpbuf[i]=(data[startpos+i*4]<<24)|(data[startpos+i*4+1]<<16);
                            }
                        else if (temp>=1) //it all fits, except the last low-byte
                            {
                                tmpbuf[i]=(data[startpos+i*4]<<24);
                            }
                        else tmpbuf[i]=0;
                    }
                Transform(tmpbuf);
            }
}


void GenerateMD5Password(uint8_t *encoded_password, const void *plaintext, unsigned plaintextsize)
{
        //Generate a MD5 hash for comparsion (MD5 storage is deprecated. Also, we use a broken MD5 implementation here :-( )
        encoded_password[0]='M';
        encoded_password[1]='D';
        encoded_password[2]='5';
        encoded_password[3]=':';
        BrokenMD5 digest;
        digest.TransformBuffer(static_cast<const uint8_t*>(plaintext),plaintextsize);
        Blex::putu32lsb(&encoded_password[4],digest.GetValue()[0]);
        Blex::putu32lsb(&encoded_password[8],digest.GetValue()[1]);
        Blex::putu32lsb(&encoded_password[12],digest.GetValue()[2]);
        Blex::putu32lsb(&encoded_password[16],digest.GetValue()[3]);
}

/*
Dit algorithme voldoet voor alle passwordfields die beginnen met SSHA1:

Elk gehashet wachtwoord is 34 tekens lang, volgens het volgende format:
"SSHA1:":6  <salt>:8  <ssha1hash>:20

Dit zijn dus rauwe bytes, geen hex encoding!

Om een wachtwoord te verifieren, plak je de salt achter het opgegeven
wachtwoord. deze string <password><salt> hash je met het SHA1 algorithme,
en het antwoord daaruit vergelijk je met bovengenoemde ssha1hash.

(let erop dat sommige talen, zoals php, uit hun hashfuncties de hash
 data als hex-encodded lowercase string geven.)
*/
void GenerateWebHareSSHA1Password(uint8_t *encoded_password, const void *plaintext, unsigned plaintextsize, const void *salt)
{
        char tempsalt[SSHA1SaltLen];
        if (!salt)
        {
                /* FIXME: Create a proper random salt! Preferably, add
                   cryptographic random generator code to the HareScript VM, and
                   make use of that! (Just have it passed as an arg to CreatePasswordHash, and drop the 'allow salt parameter to be NULL' */
                Blex::PutLsb<Blex::DateTime>(&tempsalt, Blex::DateTime::Now());
                salt = &tempsalt;
        }

        //Generate a seeded SHA1 hash for the comparison!
        memcpy(encoded_password, "SSHA1:", 6);
        memcpy(encoded_password + SSHA1SaltOffset, salt, SSHA1SaltLen);

        Blex::SHA1 hash;
        hash.Process(plaintext, plaintextsize);
        hash.Process(salt, SSHA1SaltLen);
        memcpy(encoded_password + SSHA1SaltOffset + SSHA1SaltLen, hash.Finalize(), Blex::SHA1HashLen);
}

std::string PreparePasswordForBlowfish(const void *plaintext, unsigned plaintextsize)
{
        //FIXME handle plaintext sizes > 72
        //FIXME handle passwords containing a \0

        const char *ptr = static_cast<const char*>(plaintext);
        const char *ptr_limit = ptr + plaintextsize;

        std::string retval(ptr, std::min(ptr+72, ptr_limit));

        if(plaintextsize > 72) //exceeds maximum blowfish length. XOR any overflown bytes with the initial bytes
        {
                for(unsigned pos=72;pos<plaintextsize;++pos)
                        retval[pos % 72] ^= ptr[pos];
        }
        //find and fix nulls
        std::replace(retval.begin(), retval.end(), 0, 0xee);
        return retval;
}

const unsigned BlowfishInternalPasswordLen = 7 + 22 + 31;

void GenerateWebHareBlowfishPassword(uint8_t *encoded_password, const void *plaintext, unsigned plaintextsize, unsigned iterations)
{
        std::string input = GenerateUFS128BitId();

        char tempsalt[BlowfishSaltLen + 1];
        if(!_crypt_gensalt_blowfish_rn("$2yx$", iterations, &input[0], input.size(), tempsalt, sizeof tempsalt))
                throw std::runtime_error("_crypt_gensalt_blowfish_rn failed");

        std::string inkey = PreparePasswordForBlowfish(plaintext, plaintextsize);
        char temppassword[BlowfishInternalPasswordLen + 1];

        if(!_crypt_blowfish_rn(inkey.c_str(), tempsalt, temppassword, sizeof temppassword))
                throw std::runtime_error("_crypt_blowfish_rn failed");

        memcpy(encoded_password, "WHBF:", 5);
        memcpy(encoded_password + 5, temppassword, sizeof temppassword - 1);
}

bool CheckWebHarePassword(unsigned encoded_size, void const *encoded_data, unsigned plaintext_size, void const *plaintext_data)
{
        if (encoded_size == MD5PasswordLen && std::equal(static_cast<const char*>(encoded_data), static_cast<const char*>(encoded_data) + 4, "MD5:"))
        {
                uint8_t newpass[MD5PasswordLen];
                GenerateMD5Password(newpass, plaintext_data, plaintext_size);
                return std::equal(newpass,newpass+MD5PasswordLen,static_cast<const uint8_t*>(encoded_data));
        }
        else if (encoded_size == plaintext_size + 6 && std::equal(static_cast<const char*>(encoded_data), static_cast<const char*>(encoded_data) + 6, "PLAIN:"))
        {
                return std::equal(static_cast<const char*>(plaintext_data), static_cast<const char*>(plaintext_data) + plaintext_size, static_cast<const char*>(encoded_data)+6);
        }
        else if (encoded_size == SSHA1PasswordLen && std::equal(static_cast<const char*>(encoded_data), static_cast<const char*>(encoded_data) + 6, "SSHA1:"))
        {
                uint8_t newpass[SSHA1PasswordLen];
                GenerateWebHareSSHA1Password(newpass, plaintext_data, plaintext_size, static_cast<const uint8_t*>(encoded_data) + SSHA1SaltOffset);
                return std::equal(newpass,newpass+SSHA1PasswordLen,static_cast<const uint8_t*>(encoded_data));
        }
        else if (encoded_size == BlowfishPasswordLen && std::equal(static_cast<const char*>(encoded_data), static_cast<const char*>(encoded_data) + 5, "WHBF:"))
        {
                char tempsalt[BlowfishSaltLen + 1];
                char temppassword[BlowfishInternalPasswordLen + 1];

                memcpy(tempsalt, static_cast<const char*>(encoded_data) + 5, BlowfishSaltLen);
                tempsalt[BlowfishSaltLen] = 0;

                std::string inkey = PreparePasswordForBlowfish(plaintext_data, plaintext_size);
                if(!_crypt_blowfish_rn(inkey.c_str(), tempsalt, temppassword, sizeof temppassword))
                    return false;

                return std::equal(temppassword, temppassword + BlowfishInternalPasswordLen, static_cast<const char*>(encoded_data)+5);
        }
        else if (encoded_size >= 32 && std::equal(static_cast<const char*>(encoded_data), static_cast<const char*>(encoded_data) + 12, "NETASP-SHA1:")) //.NET ASP SHA1 algorithm
        {
                /* Hash format: NETASP-SHA1:<base 64 password salt>:<base 64 password hash>
                   Algorithm NETASP: hashfunction("<decoded password salt>" || "<ucs2-le encoded plaintext>") == "<decoded password hashs>"
                */

                const char *hashstart = static_cast<char const*>(encoded_data) + 12;
                const char *hashlimit = static_cast<char const*>(encoded_data) + encoded_size;

                //Find the colon separating seed and final hash
                const char *sepcolon = std::find(hashstart, hashlimit, ':');
                if(sepcolon==hashlimit)
                    return false;//invalid format

                //Decode the base64 password
                std::vector<uint8_t> pwddata;
                DecodeBase64(sepcolon+1, hashlimit, std::back_inserter(pwddata));
                if(pwddata.size() != SHA1HashLen)
                    return false;

                //Decode the base64 salt
                std::vector<uint8_t> hashdata;
                DecodeBase64(hashstart, sepcolon, std::back_inserter(hashdata));
                hashdata.reserve(hashdata.size() + plaintext_size*2);

                //Encode the supplied plaintext to UCS2-LE (UTF-16??)
                UTF8DecodeMachine decoder;
                for(unsigned i=0;i<plaintext_size;++i)
                {
                        uint32_t outdata = decoder(static_cast<char const*>(plaintext_data)[i]);
                        if(outdata <= 65535)
                        {
                                hashdata.push_back( uint8_t(outdata&0xff) );
                                hashdata.push_back( uint8_t((outdata>>8)&0xff) );
                        }
                }

                //SHA1 hash the seed and the UCS2 password
                uint8_t sha1hash[SHA1HashLen];
                GetSHA1Hash(&hashdata[0], hashdata.size(), sha1hash);
                return std::equal(pwddata.begin(), pwddata.end(), sha1hash);
        }
        else if (encoded_size >= 4 && std::equal(static_cast<const char*>(encoded_data), static_cast<const char*>(encoded_data) + 4, "LCR:")) //linux crypt??
        {
                const char *hash = static_cast<const char*>(encoded_data) + 4;
                unsigned hash_size = encoded_size - 4;

                std::vector< uint8_t > store;
                if (hash_size > 3 && *hash == '$')
                {
                        if (*(hash + 1) == '1' && *(hash + 2) == '$')
                        {
                                const char *last_dollar = std::find(hash + 3, hash + hash_size, '$');

                                // MD5-like hashing
                                Blex::GetMD5Crypt(plaintext_data, plaintext_size, hash, last_dollar - hash, &store);
                        }
                        else
                        {
                                // Unimplemented crypt algo
                        }
                }
                else if (hash_size == 13)
                {
                        // Standard DES-sy crypt.
                        Blex::GetDESCrypt(plaintext_data, plaintext_size, hash, 2, &store);
                }

                return store.size() == hash_size && std::equal(store.begin(), store.end(), hash);
        }
        else
        {
                return false;
        }
}

bool IsWebHarePasswordStillSecure(unsigned encoded_size, void const *encoded_data)
{
        if (encoded_size == BlowfishPasswordLen && std::equal(static_cast<const char*>(encoded_data), static_cast<const char*>(encoded_data) + 5, "WHBF:"))
        {
                const char *ptr = static_cast<const char*>(encoded_data);
                unsigned val = Blex::DecodeUnsignedNumber<unsigned>(ptr+9, ptr+11).first;
                return val >= BlowfishIterations;
        }
        return false;
}

std::string GenerateUFS128BitId()
{
        static const unsigned NumRandomBytes = 128/8; //=16
        uint8_t store[NumRandomBytes];
        Blex::FillPseudoRandomVector(store, sizeof store);

        std::string sessionid;
        sessionid.reserve(22); //128 / 6 = 21,xxx = 22 rounded up
        Blex::EncodeUFS(store, store + sizeof store, std::back_inserter(sessionid));
        return sessionid;
}

} //end namespace Blex
