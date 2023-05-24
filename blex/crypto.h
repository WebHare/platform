#ifndef blex_crypto
#define blex_crypto

#ifndef blex_stream
#include "stream.h"
#endif

#include <map>
#include <vector>

#if !defined(__EMSCRIPTEN__)
#include <openssl/blowfish.h>
#include <openssl/evp.h>
#include <openssl/sha.h>
#endif

#include <blex/crc.h>

#undef uint64_t // sha.h defines it.

/* ADDME: Use the SSL MD5 etc functions instead of defining our own! (but we need to keep the Broken MD5 reader somewhere until we no longer need it for password checks) */

namespace Blex {

/// Length of a MD4Hash in bytes
const unsigned MD4HashLen = 128/8;
/// Length of a MD5Hash in bytes
const unsigned MD5HashLen = 128/8;
/// Length of a SHA1 Hash in bytes
const unsigned SHA1HashLen = 160/8;
/// Length of a SHA224 Hash in bytes
const unsigned SHA224HashLen = 224/8;
/// Length of a SHA256 Hash in bytes
const unsigned SHA256HashLen = 256/8;
/// Length of a SHA256 Hash in bytes
const unsigned SHA384HashLen = 384/8;
/// Length of a SHA256 Hash in bytes
const unsigned SHA512HashLen = 512/8;
/// Length of a SHA256 Hash in bytes
const unsigned CRC32HashLen = 32/8;
/// Length of a blowfish type/salt
const unsigned BlowfishSaltLen = 7 + 22;
/// Length of a full blowfish crypted password, including salt and the "WHBF:" prefix
const unsigned BlowfishPasswordLen = 5 + 7 + 22 + 31;
/// Currently recommended blowfish iterations
const unsigned BlowfishIterations = 10;
/** Length of a SSHA1 password ( "SSHA1:":6  <salt>:8  <ssha1hash>:20 )*/
const unsigned SSHA1PasswordLen = 34;

namespace HashAlgorithm
{
enum Type
{
        Unknown = 0,
        MD4,
        MD5,
        SHA1,
        SHA224,
        SHA256,
        SHA384,
        SHA512,
        CRC32
};
} // End of namespace HashAlgorithm

namespace KeyType
{
enum Type
{
        Unknown = 0,
        DH,
        DSA,
        EC,
        RSA
};
} // End of namespace KeyType

/** Create a SSHA1 hash for a password
    @param encoded_password SSHA1PasswordLen-byte buffer to store the password
    @param plaintext Original password
    @param plaintextsize Length of original password
    @param salt Pointer to SSHA1SeedLen-byte buffer containing the salt to use*/
void GenerateWebHareSSHA1Password(uint8_t *encoded_password, const void *plaintext, unsigned plaintextsize, const void *salt);

/** Create a blowfish hash for a password
    @param encoded_password BlowfishPasswordLen-byte buffer to store the password
    @param plaintext Original password
    @param plaintextsize Length of original password
    @param iterations Number of iterations to use (4-31) */
void BLEXLIB_PUBLIC GenerateWebHareBlowfishPassword(uint8_t *encoded_password, const void *plaintext, unsigned plaintextsize, unsigned iterations);

/** Verify a WebHare password hash */
bool BLEXLIB_PUBLIC CheckWebHarePassword(unsigned encoded_size, void const *encoded_data, unsigned plaintext_size, void const *plaintext_password);
/** Verify whether a WebHare password hash is secure, given our current security standard (only consideres hashing algorithm, not the actual password) */
bool BLEXLIB_PUBLIC IsWebHarePasswordStillSecure(unsigned encoded_size, void const *encoded_data);

/** Generate a UFS encoded 128bit session id
    @param now Current datetime to use in hash
    @param extra_data Optional extra data to use in hash
    @param sessionid String to which the hash will be appended
 * */
std::string BLEXLIB_PUBLIC GenerateUFS128BitId();

std::string BLEXLIB_PUBLIC GetLastSSLErrors();

typedef std::vector<std::pair<std::string, std::string> > SubjectNameParts;

#if !defined(__EMSCRIPTEN__)

/** Hold a key */
class BLEXLIB_PUBLIC EVPKey
{
        public:
        EVPKey();
        ~EVPKey();
        /** Generate a keypair */
        void GenerateKeypair(KeyType::Type keytype, unsigned numbits, std::string const &curve, std::function< bool() > testcontinue);
        /** Read a PEM encoded key
            @return True on success */
        bool ReadPrivateKey(unsigned keylen, const void *keybytes);
       /** Read a PEM encoded key
            @return True on success */
        bool ReadPublicKey(unsigned keylen, const void *keybytes);

        /** Continue key generation ? */
        bool ContinueKeyGeneration();

        void GenerateCertificateRequest(std::vector<uint8_t> *req, SubjectNameParts const &subjectname, std::string const &altnames);

        // encrypt using the public key
        void Encrypt(unsigned datalen, const void *data, std::vector< uint8_t > *encrypted);
        // decrypt using the private key
        void Decrypt(unsigned datalen, const void *data, std::vector< uint8_t > *decrypted);
        // sign using the private key and a given hashing type
        void Sign(unsigned datalen, const void *data, std::vector< uint8_t > *signature, HashAlgorithm::Type hashtype);
        // verify a signature using the public key and a given hashing type
        bool Verify(unsigned datalen, const void *data, std::vector< uint8_t > const &signature, HashAlgorithm::Type hashtype);

        KeyType::Type GetKeyType();
        int GetKeyLength();
        bool GetPublicOnly();
        std::string GetPrivateKey();
        std::string GetPublicKey();

//FIXME
    public:
        void *key;

    private:
        void *ctx;
        bool publiconly;
        std::function< bool() > testcontinue;
};

class SSLContext;

class SSLBIOFromData
{
        public:
        SSLBIOFromData(unsigned keylen, const void *keybytes);
        ~SSLBIOFromData();

        void *GetBio() { return bio; }

        private:
        void *bio;

        SSLBIOFromData(SSLBIOFromData const &);
        SSLBIOFromData& operator=(SSLBIOFromData const &);
};

/** Hold a certificate */
class BLEXLIB_PUBLIC Certificate
{
    private:
        void *cert;

        /** Release the certificate reference */
        void *Release();
    public:
        Certificate();
        ~Certificate();

        /** Read a PEM encoded certificate
            @return True on success */
        bool ReadCertificate(unsigned certlen, const void *certbytes);

        bool ReadCertificate(SSLBIOFromData &bio);

        /** Get the public key from the certificate
        */
        bool GetPublicKey(std::string *publickey);

        // Get the PEM-encoded certificate
        bool GetCertificateText(std::string *certificate);

        friend class SSLContext;
};

#endif // !defined(__EMSCRIPTEN__)

/** Digest calculation class base */
class BLEXLIB_PUBLIC Hasher
{
    public:
        virtual ~Hasher();

        /** Adds a buffer of data to the message which's digest must be calculated
            @param data Address of buffer
            @param Length of buffer */
        virtual void Process(const void *data,unsigned length) = 0;

        /** Finalize the result and return the resulting hash. May be called only once
            @return Digest of current message */
        virtual Blex::StringPair FinalizeHash() = 0;

        /** Finalize the result and return the resulting hash. May be called only once
            @return Start of digest of current message */
        const uint8_t * Finalize() { return reinterpret_cast< const uint8_t* >(FinalizeHash().begin); }
};

void BLEXLIB_PUBLIC GetHasher(HashAlgorithm::Type type, std::unique_ptr< Hasher > *hasher);

bool BLEXLIB_PUBLIC CheckHashLength(HashAlgorithm::Type type, unsigned lenbytes);

/** Message-Digest v5 calculation class. Like the Crc classes, it acts as a state machine */
class BLEXLIB_PUBLIC MD5 : public Hasher
{
        public:
        ///Construct a MD5 with the required initial values
        MD5();

        /** Adds a buffer of data to the message which's digest must be calculated
            @param data Address of buffer
            @param Length of buffer */
        void Process(const void *data,unsigned length);

        /** Finalize the result and return the resulting hash. May be called only once
            @return Digest of current message */
        Blex::StringPair FinalizeHash();

        private:
        uint8_t databuffer[64];
        uint64_t totalwritten;

        void Transform(const uint32_t in[16]);

        uint32_t buf[4];
};

/** SHA1 calculation class (SHA1 implementation as a state machine) */
class BLEXLIB_PUBLIC SHA1 : public Hasher
{
        public:
        /** Construct a new SHA1 hasher */
        SHA1();

        /** Hash the specified buffer */
        void Process(const void *data,unsigned length);
        /** Finalize the result and return the resulting hash. May be called only once */
        Blex::StringPair FinalizeHash();

        private:
        uint32_t digest[5];
        uint32_t countlo, counthi;
        uint32_t data[16];
};

#if !defined(__EMSCRIPTEN__)
/** SHA256 calculation class */
class BLEXLIB_PUBLIC SHA256: public Hasher
{
        public:
        /** Construct a new SHA256 hasher */
        SHA256();

        /** Hash the specified buffer */
        void Process(const void *data,unsigned length);
        /** Finalize the result and return the resulting hash. May be called only once */
        Blex::StringPair FinalizeHash();

        private:
        SHA256_CTX context;
        unsigned char md[SHA256_DIGEST_LENGTH];
};

class BLEXLIB_PUBLIC MultiHasher: public Hasher
{
    private:
        EVP_MD_CTX *evp_md_ctx;
        unsigned char digest[EVP_MAX_MD_SIZE];

    public:
        MultiHasher(int nid_type);
        ~MultiHasher();

        /** Hash the specified buffer */
        void Process(const void *data,unsigned length);
        /** Finalize the result and return the resulting hash. May be called only once */
        Blex::StringPair FinalizeHash();
};
#endif

class BLEXLIB_PUBLIC CRC32Hasher: public Hasher
{
    private:
        Blex::Crc32 crc;
        char hash[CRC32HashLen];

    public:
        /** Hash the specified buffer */
        void Process(const void *data,unsigned length);
        /** Finalize the result and return the resulting hash. May be called only once */
        Blex::StringPair FinalizeHash();
};

/** RC4 crypt class. RC4 is symmetric - the same key is used for both encryption
    and decryption */
class BLEXLIB_PUBLIC RC4
{
        public:
        /** Construct a RC4 cryptor, waiting for a 'InitKey' */
        RC4();
        /** Construct and initialize a RC4 cryptor */
        RC4(void const *key, unsigned keylen);
        /** Reset the RC4 cryptor and initialize with a key */
        void InitKey(void const *key, unsigned keylen);
        /** Crypt the data in the specified buffer */
        void CryptBuffer(void *buffer, unsigned bufferlen);
        /** Crypt a single byte */
        uint8_t CryptByte(uint8_t inbyte);

        private:
        uint8_t state[256];
        unsigned x,y;
};

/** RC4 crypting stream. */
class BLEXLIB_PUBLIC RC4CryptingStream : public Blex::Stream
{
        public:
        RC4CryptingStream(Blex::Stream &in);
        ~RC4CryptingStream();

        /** Reset the RC4 cryptor and initialize with a key */
        void InitKey(void const *key, unsigned keylen);

        bool EndOfStream();
        std::size_t Read(void *buf,std::size_t maxbufsize);
        std::size_t Write(const void *buf, std::size_t bufsize);

        private:
        RC4 crypt;
        Blex::Stream &in;
};

/** Calculate the MD5 hash of a buffer of byte data
    @param hash Location where to store the hash (must be MD5HashLen bytes in length)*/
void BLEXLIB_PUBLIC GetMD5Hash(const void *data, unsigned len, void *hashstore);

/** Calculate the SHA1 hash of a message
    @param data Pointer to data to hash
    @param len Length of data to hash
    @param hash Location where to store the hash (must be SHA1HashLen bytes in length)*/
void BLEXLIB_PUBLIC GetSHA1Hash(const void *data, unsigned len, void *hashstore);

/** Calculate a MD5 crypt password
    @param data Pointer to data to hash
    @param len Length of data to hash */
void BLEXLIB_PUBLIC GetMD5Crypt(const void *key, unsigned keylen, const void *salt, unsigned saltlen, std::vector<uint8_t> *store);

/** Calculate a DES crypt password
    @param data Pointer to data to hash
    @param len Length of data to hash */
void BLEXLIB_PUBLIC GetDESCrypt(const void *key, unsigned keylen, const void *salt, unsigned saltlen, std::vector<uint8_t> *store);

/** Fills the specified vector with (pseudo) random data. Vector must
    already have the correct size */
void BLEXLIB_PUBLIC FillPseudoRandomVector(uint8_t *to_fill, unsigned to_fill_bytes);

#if !defined(__EMSCRIPTEN__)

class BLEXLIB_PUBLIC SSLContext
{
        public:
        ///Error codes returned by Load
        enum LoadErrors
        {
                ///Key and cert loaded
                AllOk = 0,
                ///A key&cert have already been loaded before
                AlreadyLoadedCert,
                ///Cannot open or read the key file
                CannotReadKey,
                ///Cannot open or read the certificate file
                CannotReadCert,
                ///Key and certificate mismatch
                KeyCertMismatch
        };

        /** @param securitylevel SSL Securitylevel - https://www.openssl.org/docs/man1.1.1/man3/SSL_CTX_set_security_level.html */
        SSLContext(bool is_server, std::string const &ciphersuite, int securitylevel, uint64_t ssloptions);
        ~SSLContext();

        LoadErrors Load(std::string const &keyfile,std::string const &certfile);

        bool LoadPrivateKey(const void *keydata, unsigned keylen);
        bool LoadCertificate(const void *keydata, unsigned keylen);
        bool LoadCertificateChain(const void *keydata, unsigned keylen);

        bool IsServerContext() { return is_server; }


        private:
        void *ctx;
        bool const is_server;

//        void *EVP_key;
//        std::vector<void *> X509_certs;

        friend class SSLConnection;
};

/** The data for a SSL connection */
class SSLConnection
{
        public:
        /** Construct the data for a SSL connection
            @param is_server True if we're the accepting side of an SSL connection
            @param key_and_cert If not NULL, the key and certificate to use.
                   The caller is responsible for ensuring key_and_cert lifetime */
        SSLConnection(SSLContext &key_and_cert);
        ~SSLConnection();

        //Filtering incoming data
        unsigned FeedIncomingData(void const *data, unsigned datalen);
        void DiscardIncomingBytes(unsigned len);
        bool PollIncomingData();
        unsigned GetIncomingDataLen() { return read_buffer_len; }
        uint8_t const *GetIncomingDataPtr() { return read_buffer;}

        //Filtering outgoing data
        /// Whether the internal buffers are very filled, and feeding should wait until outgoing data has been read
        bool MustWaitWithFeedOutgoingData();
        int FeedOutgoingData(void const *data, unsigned datalen);
        void DiscardOutgoingBytes(unsigned len);
        unsigned GetOutgoingDataLen() { return write_buffer_len; }
        uint8_t const *GetOutgoingDataPtr() { return write_buffer;}
        bool GetPeerCertificateChain(std::string *dest);

        uint8_t feed_read_buffer[16384];
        unsigned feed_read_buffer_len;

        bool ssl_wants_read;
        bool ssl_can_write;
        bool ssl_blocked_until_read;

        void DoEstablish();
        void SetRemoteHostname(std::string const &remotehostname);

        void Shutdown();

        std::string ssl_broken_error;
        private:
        void DoOutput();

        //SSLContext &key_and_cert;
        bool is_server;
        uint8_t read_buffer[16384];
        unsigned read_buffer_len;

        ///Note: SSL wants BIG BUFFERS - going from 1k to 8k really sped things up...
        uint8_t write_buffer[16384];
        unsigned write_buffer_len;

        bool established;

        void *SSL_data;
        void *BIO_read_buffer;
        void *BIO_write_buffer;
        std::string remotehostname;
};

#endif // !defined(__EMSCRIPTEN__)

} //end namespace Blex

#endif // sentry define
