#ifndef blex_crc
#define blex_crc

#ifndef blex_blexlib
#include "blexlib.h"
#endif

namespace Blex
{

//Defined here
class Crc32;

/** Crc32 stores and calculates a CRC-32. An instance of the class will act as a state-machine, calculating a total CRC
    of all data going through it. It also offers static members which immediately return a requested CRC*/
class Crc32
{
        private:
        static uint32_t crc_32_tab[256];
        uint32_t crc_sofar;

        uint32_t UPDC32(uint8_t octet,uint32_t crc)
        {
                return crc_32_tab[(crc ^ octet) & 0xff] ^ (crc >> 8);
        }

        public:
        ///Construct a Crc32, initialized to the default start value
        Crc32()
        {
                crc_sofar=0xFFFFFFFF;
        }

        ///Get the current value of a Crc32
        uint32_t GetValue() const
        {
                return ~crc_sofar;
        }

        ///Process a single byte through the CRC calculator
        void Do(uint8_t byte)
        {
                crc_sofar = UPDC32(byte,crc_sofar);
        }

        /** Process a buffer through the CRC calculator
            @param start Beginning of the buffer to process
            @param length Number of byte sto process */
        void Do(const void *start,unsigned length);

        /** Calculate the CRC-32 over a buffer
            @param start Beginning of the buffer to process
            @param length Number of byte sto process
            @return The CRC-32 of the buffer */
        static uint32_t CrcBuffer(const void *start,unsigned length)
        {
                Crc32 crc;
                crc.Do(start,length);
                return crc.GetValue();
        }
};

/** Crc16 stores and calculates a CRC-16. An instance of the class will act as a state-machine, calculating a total CRC
    of all data going through it. It also offers static members which immediately return a requested CRC */
class Crc16
{
        private:
        static uint16_t crc_16_tab[256];

        uint16_t crc_sofar;
        uint16_t UPDC(uint8_t octet,uint16_t crc) { return uint16_t((crc<<8) ^ crc_16_tab[(crc>>8)^octet]); }

        public:
        ///Construct a Crc16, initialized to the default start value
        Crc16(void)
        {
                crc_sofar=0;
        }

        ///Get the current value of a Crc32
        uint16_t GetValue(void) const
        {
                return static_cast<uint16_t>(~crc_sofar);
        }

        ///Process a single byte through the CRC calculator
        void Do(uint8_t byte)
        {
                crc_sofar = UPDC(byte,crc_sofar);
        }

        /** Process a buffer through the CRC calculator
            @param start Beginning of the buffer to process
            @param length Number of byte sto process */
        void Do(const void *start,unsigned length);

        /** Calculate the CRC-16 over a buffer
            @param start Beginning of the buffer to process
            @param length Number of byte sto process
            @return The CRC-16 of the buffer */
        static uint16_t CrcBuffer(const void *start,unsigned length)
        {
                Crc16 crc;
                crc.Do(start,length);
                return crc.GetValue();
        }
};

}

#endif // sentry define
