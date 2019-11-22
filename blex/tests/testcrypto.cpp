//---------------------------------------------------------------------------
#include <blex/blexlib.h>
#include <iostream>
#include <string>
#include <vector>
#include "../testing.h"

//---------------------------------------------------------------------------

#include "../crypto.h"

BLEX_TEST_FUNCTION(TestFileMD5)
{
        /* The md5 hashes have been made by manually creating this files on disk, then performing
           the linux application md5sum on them */

        // Hash of a file with length 0
        uint8_t md5hashLength0[] = { 0xd4, 0x1d, 0x8c, 0xd9, 0x8f, 0x00, 0xb2, 0x04, 0xe9, 0x80, 0x09, 0x98, 0xec, 0xf8, 0x42, 0x7e };
        Blex::MD5 len0;
        BLEX_TEST_CHECK(std::equal(md5hashLength0, md5hashLength0+16, len0.Finalize()));

        // Hash of file with length 4, with contents 'PASS'
        uint8_t md5hashPass[] = {  0x7a, 0x95, 0xbf, 0x92, 0x6a, 0x03, 0x33, 0xf5, 0x77, 0x05, 0xae, 0xac, 0x07, 0xa3, 0x62, 0xa2 };
        Blex::MD5 pass;
        uint8_t PassText[] = { 'P', 'A', 'S', 'S' };
        pass.Process(PassText, 4);
        BLEX_TEST_CHECK(std::equal(md5hashPass, md5hashPass+16, pass.Finalize()));

        // Add buffer of length 66, written at once
        uint8_t md5hashLen66[] = { 0xe5, 0x8b, 0x32, 0x61, 0xa4, 0x67, 0xf0, 0x2b, 0xa5, 0x1b, 0x21, 0x5c, 0x01, 0x3d, 0xf4, 0xc3 };
        uint8_t Len66Text[] = {
                0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
                0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
                0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f,
                0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f,
                0x40, 0x41 };

        Blex::MD5 len66;
        len66.Process(Len66Text, 66);

        // Buffer of length 56 (same contents as length 66)
        uint8_t md5hashLen56[] = { 0x51, 0xfd, 0xd1, 0xac, 0xda, 0x72, 0x40, 0x5d, 0xfd, 0xfa, 0x03, 0xfc, 0xb8, 0x58, 0x96, 0xd7 };

        BLEX_TEST_CHECK(std::equal(md5hashLen66, md5hashLen66+16, len66.Finalize()));

        uint8_t Len56Text[] = {
                0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
                0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
                0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f,
                0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37 };

        Blex::MD5 len56;
        len56.Process(Len56Text, 56);

        BLEX_TEST_CHECK(std::equal(md5hashLen56, md5hashLen56+16, len56.Finalize()));
}

BLEX_TEST_FUNCTION(TestSHA1)
{
        char const *msg1 = "abc";
        char const *msg56 = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";

        /* Correct solutions from FIPS PUB 180-1 */
        uint8_t const dig1[] = {0xA9,0x99,0x3E,0x36,0x47,0x06,0x81,0x6A,0xBA,0x3E,0x25,0x71,0x78,0x50,0xC2,0x6C,0x9C,0xD0,0xD8,0x9D};
        uint8_t const dig2[] = {0x84,0x98,0x3E,0x44,0x1C,0x3B,0xD2,0x6E,0xBA,0xAE,0x4A,0xA1,0xF9,0x51,0x29,0xE5,0xE5,0x46,0x70,0xF1};
        uint8_t const dig3[] = {0x34,0xAA,0x97,0x3C,0xD4,0xC4,0xDA,0xA4,0xF6,0x1E,0xEB,0x2B,0xDB,0xAD,0x27,0x31,0x65,0x34,0x01,0x6F};

        Blex::SHA1 test1;
        test1.Process(msg1,strlen(msg1));
        BLEX_TEST_CHECK(std::equal(dig1, dig1 + Blex::SHA1HashLen, test1.Finalize()));

        Blex::SHA1 test2;
        test2.Process(msg56,strlen(msg56));
        BLEX_TEST_CHECK(std::equal(dig2, dig2 + Blex::SHA1HashLen, test2.Finalize()));

        ///test with one million a's
        Blex::SHA1 test3;
        uint8_t big[1000];
        memset(big,'a',sizeof big);
        for (unsigned i=0;i<1000;++i)
            test3.Process(big,sizeof big);
        BLEX_TEST_CHECK(std::equal(dig3, dig3 + Blex::SHA1HashLen, test3.Finalize()));
}

BLEX_TEST_FUNCTION(TestSHA256)
{
        char const *msg1 = "abc";
        char const *msg56 = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";

        /* Correct solutions from FIPS PUB 180-1 */
        uint8_t const dig1[] = {0xBA,0x78,0x16,0xBF,0x8F,0x01,0xCF,0xEA,0x41,0x41,0x40,0xDE,0x5D,0xAE,0x22,0x23,0xB0,0x03,0x61,0xA3,0x96,0x17,0x7A,0x9C,0xB4,0x10,0xFF,0x61,0xF2,0x00,0x15,0xAD};
        uint8_t const dig2[] = {0x24,0x8D,0x6A,0x61,0xD2,0x06,0x38,0xB8,0xE5,0xC0,0x26,0x93,0x0C,0x3E,0x60,0x39,0xA3,0x3C,0xE4,0x59,0x64,0xFF,0x21,0x67,0xF6,0xEC,0xED,0xD4,0x19,0xDB,0x06,0xC1};
        uint8_t const dig3[] = {0xCD,0xC7,0x6E,0x5C,0x99,0x14,0xFB,0x92,0x81,0xA1,0xC7,0xE2,0x84,0xD7,0x3E,0x67,0xF1,0x80,0x9A,0x48,0xA4,0x97,0x20,0x0E,0x04,0x6D,0x39,0xCC,0xC7,0x11,0x2C,0xD0};

        Blex::SHA256 test1;
        test1.Process(msg1,strlen(msg1));
        BLEX_TEST_CHECK(std::equal(dig1, dig1 + Blex::SHA256HashLen, test1.Finalize()));

        Blex::SHA256 test2;
        test2.Process(msg56,strlen(msg56));
        BLEX_TEST_CHECK(std::equal(dig2, dig2 + Blex::SHA256HashLen, test2.Finalize()));

        ///test with one million a's
        Blex::SHA256 test3;
        uint8_t big[1000];
        memset(big,'a',sizeof big);
        for (unsigned i=0;i<1000;++i)
            test3.Process(big,sizeof big);
        BLEX_TEST_CHECK(std::equal(dig3, dig3 + Blex::SHA256HashLen, test3.Finalize()));
}

namespace
{
std::string EncodeStrBase16(Blex::StringPair in)
{
        std::string result;
        Blex::EncodeBase16(in.begin, in.end, std::back_inserter(result));
        return result;
}
} // End of anonymous namespace

BLEX_TEST_FUNCTION(TestMD4)
{
        char const *msg0 = "";
        char const *msgdog = "The quick brown fox jumps over the lazy dog";

        Blex::MultiHasher md4_0(NID_md4);
        md4_0.Process(msg0, strlen(msg0));
        BLEX_TEST_CHECKEQUAL("31D6CFE0D16AE931B73C59D7E0C089C0", EncodeStrBase16(md4_0.FinalizeHash()));

        Blex::MultiHasher md4_1(NID_md4);
        md4_1.Process(msgdog, strlen(msgdog));
        BLEX_TEST_CHECKEQUAL("1BEE69A46BA811185C194762ABAEAE90", EncodeStrBase16(md4_1.FinalizeHash()));
}

BLEX_TEST_FUNCTION(TestMoreSHA)
{
        char const *msg1 = "abc";
        char const *msg896 = "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu";

        /* Correct solutions from FIPS PUB 180-2 */
        std::string dig512_1 = "DDAF35A193617ABACC417349AE20413112E6FA4E89A97EA20A9EEEE64B55D39A2192992A274FC1A836BA3C23A3FEEBBD454D4423643CE80E2A9AC94FA54CA49F";
        std::string dig512_2 = "8E959B75DAE313DA8CF4F72814FC143F8F7779C6EB9F7FA17299AEADB6889018501D289E4900F7E4331B99DEC4B5433AC7D329EEB6DD26545E96E55B874BE909";

        std::string dig384_1 = "CB00753F45A35E8BB5A03D699AC65007272C32AB0EDED1631A8B605A43FF5BED8086072BA1E7CC2358BAECA134C825A7";
        std::string dig384_2 = "09330C33F71147E83D192FC782CD1B4753111B173B3B05D22FA08086E3B0F712FCC7C71A557E2DB966C3E9FA91746039";

        // Scoured from the net (http://www.miniwebtool.com/sha224-hash-generator/)
        std::string dig224_1 = "23097D223405D8228642A477BDA255B32AADBCE4BDA0B3F7E36C9DA7";
        std::string dig224_2 = "C97CA9A559850CE97A04A96DEF6D99A9E0E0E2AB14E6B8DF265FC0B3";

        Blex::MultiHasher sha512_1(NID_sha512);
        sha512_1.Process(msg1, strlen(msg1));
        BLEX_TEST_CHECKEQUAL(dig512_1, EncodeStrBase16(sha512_1.FinalizeHash()));

        Blex::MultiHasher sha512_2(NID_sha512);
        sha512_2.Process(msg896, strlen(msg896));
        BLEX_TEST_CHECKEQUAL(dig512_2, EncodeStrBase16(sha512_2.FinalizeHash()));

        Blex::MultiHasher sha384_1(NID_sha384);
        sha384_1.Process(msg1, strlen(msg1));
        BLEX_TEST_CHECKEQUAL(dig384_1, EncodeStrBase16(sha384_1.FinalizeHash()));

        Blex::MultiHasher sha384_2(NID_sha384);
        sha384_2.Process(msg896, strlen(msg896));
        BLEX_TEST_CHECKEQUAL(dig384_2, EncodeStrBase16(sha384_2.FinalizeHash()));

        Blex::MultiHasher sha224_1(NID_sha224);
        sha224_1.Process(msg1, strlen(msg1));
        BLEX_TEST_CHECKEQUAL(dig224_1, EncodeStrBase16(sha224_1.FinalizeHash()));

        Blex::MultiHasher sha224_2(NID_sha224);
        sha224_2.Process(msg896, strlen(msg896));
        BLEX_TEST_CHECKEQUAL(dig224_2, EncodeStrBase16(sha224_2.FinalizeHash()));
}


/*
 * ARC4 tests vectors from OpenSSL (crypto/rc4/rc4test.c)
 */

static unsigned char keys[7][30]={
        {8,0x01,0x23,0x45,0x67,0x89,0xab,0xcd,0xef},
        {8,0x01,0x23,0x45,0x67,0x89,0xab,0xcd,0xef},
        {8,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
        {4,0xef,0x01,0x23,0x45},
        {8,0x01,0x23,0x45,0x67,0x89,0xab,0xcd,0xef},
        {4,0xef,0x01,0x23,0x45},
        };

static unsigned char data_len[7]={8,8,8,20,28,10};
static unsigned char data[7][30]={
        {0x01,0x23,0x45,0x67,0x89,0xab,0xcd,0xef,0xff},
        {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xff},
        {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xff},
        {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
           0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
           0x00,0x00,0x00,0x00,0xff},
        {0x12,0x34,0x56,0x78,0x9A,0xBC,0xDE,0xF0,
           0x12,0x34,0x56,0x78,0x9A,0xBC,0xDE,0xF0,
           0x12,0x34,0x56,0x78,0x9A,0xBC,0xDE,0xF0,
           0x12,0x34,0x56,0x78,0xff},
        {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xff},
        {0},
        };

static unsigned char output[7][30]={
        {0x75,0xb7,0x87,0x80,0x99,0xe0,0xc5,0x96,0x00},
        {0x74,0x94,0xc2,0xe7,0x10,0x4b,0x08,0x79,0x00},
        {0xde,0x18,0x89,0x41,0xa3,0x37,0x5d,0x3a,0x00},
        {0xd6,0xa1,0x41,0xa7,0xec,0x3c,0x38,0xdf,
         0xbd,0x61,0x5a,0x11,0x62,0xe1,0xc7,0xba,
         0x36,0xb6,0x78,0x58,0x00},
        {0x66,0xa0,0x94,0x9f,0x8a,0xf7,0xd6,0x89,
         0x1f,0x7f,0x83,0x2b,0xa8,0x33,0xc0,0x0c,
         0x89,0x2e,0xbe,0x30,0x14,0x3c,0xe2,0x87,
         0x40,0x01,0x1e,0xcf,0x00},
        {0xd6,0xa1,0x41,0xa7,0xec,0x3c,0x38,0xdf,0xbd,0x61,0x00},
        {0},
        };

BLEX_TEST_FUNCTION(TestRC4)
{
        uint8_t buffer[30];
        for( int i = 0; i < 6; i++ )
        {
                memcpy( buffer, data[i], data_len[i] );
                Blex::RC4 crypt(&keys[i][1],keys[i][0]);
                crypt.CryptBuffer(buffer, data_len[i]);

                BLEX_TEST_CHECK(memcmp( buffer, output[i], data_len[i] )==0);
        }
}

BLEX_TEST_FUNCTION(TestBlowfish)
{
        // test vectors taken from http://www.schneier.com/code/vectors.txt

        unsigned char key[8] = {0x01, 0x31, 0xD9, 0x61, 0x9D, 0xC1, 0x37, 0x6E};
        unsigned char data[8] = {0x5C, 0xD5, 0x4C, 0xA8, 0x3D, 0xEF, 0x57, 0xDA};
        unsigned char cipher[8] = {0xB1, 0xB8, 0xCC, 0x0B, 0x25, 0x0F, 0x09, 0xA0};
        unsigned char padtest[8] = {4,4,4,4,0,0,0,0};
        unsigned char out[8];

        Blex::Blowfish bf(key, 8);

        bf.Encrypt(data, data + 8, out, out + 8);

        for (unsigned i = 0; i < 8; i++)
          BLEX_TEST_CHECKEQUAL(out[i], cipher[i]);

        bf.Decrypt(cipher, cipher + 8, out, out + 8);

        for (unsigned i = 0; i < 8; i++)
          BLEX_TEST_CHECKEQUAL(out[i], data[i]);

        // test padding
        bf.Pad(padtest, 4);

        for (unsigned i = 0; i < 8; i++)
          BLEX_TEST_CHECKEQUAL(padtest[i], 4);
}

std::string QuickMD5Crypt(std::string const &key, std::string const &salt)
{
        std::vector<uint8_t> result;
        Blex::GetMD5Crypt(&key[0], key.length(), &salt[0], salt.length(), &result);
        return std::string(&result[0], &result[result.size()]);
}

std::string QuickDESCrypt(std::string const &key, std::string const &salt)
{
        std::vector<uint8_t> result;
        Blex::GetDESCrypt(&key[0], key.length(), &salt[0], salt.length(), &result);
        return std::string(&result[0], &result[result.size()]);
}


BLEX_TEST_FUNCTION(TestCrypto)
{
        BLEX_TEST_CHECKEQUAL("$1$uqt1kv0G$ZAATThBN0JWJ9N156teSV0", QuickMD5Crypt("hiningo", "$1$uqt1kv0G"));
        BLEX_TEST_CHECKEQUAL("$1$uqt1kv0G$ZAATThBN0JWJ9N156teSV0", QuickMD5Crypt("hiningo", "$1$uqt1kv0G$ZAATThBN0JWJ9N156teSV0"));
        BLEX_TEST_CHECKEQUAL("$1$uqt1kv0G$ZAATThBN0JWJ9N156teSV0", QuickMD5Crypt("hiningo", "uqt1kv0G"));

        BLEX_TEST_CHECKEQUAL("nyfVcZo/9Cj1U", QuickDESCrypt("hiningo", "ny"));

        const char *bf_secret="WHBF:$2y$08$YUXsZzGuZxLSZUHIXCTqJOvFX0MFMbyTzEVM6.xYseVP7xwe7Jfs6";
        BLEX_TEST_CHECK(Blex::CheckWebHarePassword(strlen(bf_secret), bf_secret, 6, "secret"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(strlen(bf_secret), bf_secret, 6, "konijn"));

        const char basepassword[] = "NETASP-SHA1:twr/aETzvfbBztNCM2hGQg==:vX5EWhI+GNhKdb5jckVZM4MxEuI=";
        const char pwd1[] = "secret";
        const char pwd2[] = "WPnFB{/pE%r={j";
        BLEX_TEST_CHECKEQUAL(false, Blex::CheckWebHarePassword(std::strlen(basepassword), basepassword, strlen(pwd1), pwd1));
        BLEX_TEST_CHECKEQUAL(true, Blex::CheckWebHarePassword(std::strlen(basepassword), basepassword, strlen(pwd2), pwd2));

        BLEX_TEST_CHECK(!Blex::IsWebHarePasswordStillSecure(std::strlen(basepassword), basepassword));
        BLEX_TEST_CHECK(!Blex::IsWebHarePasswordStillSecure(std::strlen(bf_secret), bf_secret));

        //test specifically around the 72-byte limit
        uint8_t bf_buffer[Blex::BlowfishPasswordLen];
        Blex::GenerateWebHareBlowfishPassword(bf_buffer, "12345678901234567890123456789012345678901234567890123456789012345678901", 71, Blex::BlowfishIterations);
        BLEX_TEST_CHECK(Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 71, "123456789012345678901234567890123456789012345678901234567890123456789012"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 72, "123456789012345678901234567890123456789012345678901234567890123456789012"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 73, "1234567890123456789012345678901234567890123456789012345678901234567890123"));

        BLEX_TEST_CHECK(Blex::IsWebHarePasswordStillSecure(Blex::BlowfishPasswordLen, bf_buffer));

        Blex::GenerateWebHareBlowfishPassword(bf_buffer, "123456789012345678901234567890123456789012345678901234567890123456789012", 72, 4);
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 71, "123456789012345678901234567890123456789012345678901234567890123456789012"));
        BLEX_TEST_CHECK(Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 72, "123456789012345678901234567890123456789012345678901234567890123456789012"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 73, "1234567890123456789012345678901234567890123456789012345678901234567890123"));
        BLEX_TEST_CHECK(!Blex::IsWebHarePasswordStillSecure(Blex::BlowfishPasswordLen, bf_buffer));

        Blex::GenerateWebHareBlowfishPassword(bf_buffer, "1234567890123456789012345678901234567890123456789012345678901234567890123", 73, 4);
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 71, "123456789012345678901234567890123456789012345678901234567890123456789012"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 72, "123456789012345678901234567890123456789012345678901234567890123456789012"));
        BLEX_TEST_CHECK(Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 73, "1234567890123456789012345678901234567890123456789012345678901234567890123"));

        Blex::GenerateWebHareBlowfishPassword(bf_buffer, "12345678901234567890123456789012345678901234567890123456789012345678901231234567890123456789012345678901234567890123456789012345678901234567890123", 146, 4);
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 71, "12345678901234567890123456789012345678901234567890123456789012345678901231234567890123456789012345678901234567890123456789012345678901234567890123"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 72, "12345678901234567890123456789012345678901234567890123456789012345678901231234567890123456789012345678901234567890123456789012345678901234567890123"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 73, "12345678901234567890123456789012345678901234567890123456789012345678901231234567890123456789012345678901234567890123456789012345678901234567890123"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 145, "12345678901234567890123456789012345678901234567890123456789012345678901231234567890123456789012345678901234567890123456789012345678901234567890123"));
        BLEX_TEST_CHECK(Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 146, "12345678901234567890123456789012345678901234567890123456789012345678901231234567890123456789012345678901234567890123456789012345678901234567890123"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 147, "123456789012345678901234567890123456789012345678901234567890123456789012312345678901234567890123456789012345678901234567890123456789012345678901234"));

        //test vs 0 bytes
        Blex::GenerateWebHareBlowfishPassword(bf_buffer, "\0\0test", 0, 4);
        BLEX_TEST_CHECK(Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 0, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 1, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 2, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 3, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 3, "te\0\0st"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 4, "te\0\0st"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 5, "te\0\0st"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 6, "te\0\0st"));

        Blex::GenerateWebHareBlowfishPassword(bf_buffer, "\0\0test", 1, 4);
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 0, "\0\0test"));
        BLEX_TEST_CHECK(Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 1, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 2, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 3, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 3, "te\0\0st"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 4, "te\0\0st"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 5, "te\0\0st"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 6, "te\0\0st"));

        Blex::GenerateWebHareBlowfishPassword(bf_buffer, "\0\0test", 2, 4);
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 0, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 1, "\0\0test"));
        BLEX_TEST_CHECK(Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 2, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 3, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 3, "te\0\0st"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 4, "te\0\0st"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 5, "te\0\0st"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 6, "te\0\0st"));

        Blex::GenerateWebHareBlowfishPassword(bf_buffer, "\0\0test", 3, 4);
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 0, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 1, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 2, "\0\0test"));
        BLEX_TEST_CHECK(Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 3, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 3, "te\0\0st"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 4, "te\0\0st"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 5, "te\0\0st"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 6, "te\0\0st"));

        Blex::GenerateWebHareBlowfishPassword(bf_buffer, "te\0\0st", 3, 4);
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 0, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 1, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 2, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 3, "\0\0test"));
        BLEX_TEST_CHECK(Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 3, "te\0\0st"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 4, "te\0\0st"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 5, "te\0\0st"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 6, "te\0\0st"));

        Blex::GenerateWebHareBlowfishPassword(bf_buffer, "te\0\0st", 4, 4);
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 0, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 1, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 2, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 3, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 3, "te\0\0st"));
        BLEX_TEST_CHECK(Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 4, "te\0\0st"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 5, "te\0\0st"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 6, "te\0\0st"));

        Blex::GenerateWebHareBlowfishPassword(bf_buffer, "te\0\0st", 5, 4);
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 0, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 1, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 2, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 3, "\0\0test"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 3, "te\0\0st"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 4, "te\0\0st"));
        BLEX_TEST_CHECK(Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 5, "te\0\0st"));
        BLEX_TEST_CHECK(!Blex::CheckWebHarePassword(sizeof bf_buffer, bf_buffer, 6, "te\0\0st"));

        //higher iteration count
        Blex::GenerateWebHareBlowfishPassword(bf_buffer, "12345678901234567890123456789012345678901234567890123456789012345678901", 71, Blex::BlowfishIterations + 1);
        BLEX_TEST_CHECK(Blex::IsWebHarePasswordStillSecure(Blex::BlowfishPasswordLen, bf_buffer));
}

BLEX_TEST_FUNCTION(TestEVP)
{
        Blex::EVPKey mykey;
        mykey.GenerateKeypair(Blex::KeyType::RSA, 1024, "", std::function< bool() >());

        std::vector<uint8_t> req;
        Blex::SubjectNameParts parts;

        parts.push_back(std::make_pair("C","NL"));
        parts.push_back(std::make_pair("ST","Overijssel"));
        parts.push_back(std::make_pair("L","Enschede"));
        parts.push_back(std::make_pair("O","Example Cooperation"));
        parts.push_back(std::make_pair("CN","www.example.net"));
        mykey.GenerateCertificateRequest(&req, parts, "DNS:www.example.com, DNS:www.example.org");

//        std::cout << std::string(reinterpret_cast<const char*>(&req[0]),reinterpret_cast<const char*>(&req[req.size()])) << "\n";
}
