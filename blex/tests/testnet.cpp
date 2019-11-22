//---------------------------------------------------------------------------
#include <blex/blexlib.h>
#include <iostream>
#include <string>
#include <vector>
#include "../testing.h"

//---------------------------------------------------------------------------

#include "../socket.h"
//#include "../secsocket.h"
#include "../pipestream.h"
#include "../dispat.h"
#include "../zstream.h"
#include "../logfile.h"
#include "../path.h"
#include "../testing.h"
#include <set>

extern std::string self_app;

const char *test_cert=
"-----BEGIN CERTIFICATE-----\n"
"MIICyzCCAjQCAQAwDQYJKoZIhvcNAQEFBQAwga0xCzAJBgNVBAYTAk5MMRMwEQYD\n"
"VQQIEwpPdmVyaWpzc2VsMREwDwYDVQQHEwhFbnNjaGVkZTEnMCUGA1UEChMeQi1M\n"
"ZXggSW5mb3JtYXRpb24gVGVjaG5vbG9naWVzMREwDwYDVQQLEwhEZW1vIEtleTEZ\n"
"MBcGA1UEAxMQZGVtby5leGFtcGxlLm9yZzEfMB0GCSqGSIb3DQEJARYQZGVtb0Bl\n"
"eGFtcGxlLm9yZzAeFw0wNTExMTMyMDQyMzhaFw0xNTExMTEyMDQyMzhaMIGtMQsw\n"
"CQYDVQQGEwJOTDETMBEGA1UECBMKT3Zlcmlqc3NlbDERMA8GA1UEBxMIRW5zY2hl\n"
"ZGUxJzAlBgNVBAoTHkItTGV4IEluZm9ybWF0aW9uIFRlY2hub2xvZ2llczERMA8G\n"
"A1UECxMIRGVtbyBLZXkxGTAXBgNVBAMTEGRlbW8uZXhhbXBsZS5vcmcxHzAdBgkq\n"
"hkiG9w0BCQEWEGRlbW9AZXhhbXBsZS5vcmcwgZ8wDQYJKoZIhvcNAQEBBQADgY0A\n"
"MIGJAoGBANnT4rEVnHptI18pk4CbiTdOLFlUMcwVTlhgj423IZZZ0ER97TnvFNQg\n"
"Qppm3vtpYGoKepLYzup+DAl4YlERoAzuXu14IH9kNNygDj4AkzryILZenquNKt1l\n"
"AYpN7idHIuqUWt8aCnNdTwfRu0W6dlksySWJ7CDl460bLTUZXcpFAgMBAAEwDQYJ\n"
"KoZIhvcNAQEFBQADgYEAjpRyO7UjPsEGfEqcjuzyn8rkRZzNp9kTofzPIA0C7Hjh\n"
"PSFmGGVDHYLjYtlhUnFedktv/KBPZ+GDBs3DyiJnepJRnG+7Eg/8mP+aJGc4TICY\n"
"RY8UMVbM9JW6NbVwsTK2yLesyLPQXvfIcpanIu7CSf09uL2JGeniDWCw1NsPmXI=\n"
"-----END CERTIFICATE-----";

const char *test_pvt_key=
"-----BEGIN RSA PRIVATE KEY-----\n"
"MIICXAIBAAKBgQDZ0+KxFZx6bSNfKZOAm4k3TixZVDHMFU5YYI+NtyGWWdBEfe05\n"
"7xTUIEKaZt77aWBqCnqS2M7qfgwJeGJREaAM7l7teCB/ZDTcoA4+AJM68iC2Xp6r\n"
"jSrdZQGKTe4nRyLqlFrfGgpzXU8H0btFunZZLMkliewg5eOtGy01GV3KRQIDAQAB\n"
"AoGAbDsWcOyPAlmF8LukuYsOg7dI2920nHWdptXbngt3GdBoZg+3tkhvrfKVhUhF\n"
"1N+H80hfnOUy8lpMusvg9ezu+3MsFtC1x6+dPSD8Wt7YUUIJW1TweXdMa1laf+6O\n"
"2Xap/Y/NmGQq/sxRUUYS0Cyz+IKjXFKymQTVlgNp3G30J2UCQQDuR1KYDc14U1wS\n"
"HGU+vbRxrs7z9IRUkhFr3OGuB0YRyEB/acWChTK7KVFR722N9Veu/7XgrT59IaHr\n"
"AlK+odibAkEA6gcwnEjwAIS0cpsYGuPHHzr6tvrDg1zEibB19KMGfgoqtVuz7y7g\n"
"XVdItS0picga71GFsGiDpiEfxSG1+gfmnwJAR8u/zEckaSQc8uwRaaU5kKOOgh1k\n"
"HiNhEnIcohZY+5SuMnYJaDmAPrrFYP3WsdaCFB3CjK9Gy+dtZWVuzzfvDwJBAKjs\n"
"Qak9eIdXQozK6E5YhZ1ETD4RqVhDeNXOGoZXulL18bfwlmOaGXcmjqPAEpCScOa3\n"
"mGEqP4SFulHnsFvmog8CQBNr6eHA/xJcUAzltljnuhTpJaRXZ/lHRu1dOIUnGRzT\n"
"q3VPZZ8tLO2sm6tZdfcCH0XzaO44ysbPIoUd0XPkHVA=\n"
"-----END RSA PRIVATE KEY-----";

void DoBidirectionalTest(Blex::PipeReadStream &in, Blex::PipeSet &out)
{
        static const char send_buffer[]={"The quick brown fox jumped over the lazy red dog"};
        char byte;

        BLEX_TEST_CHECKEQUAL(false, in.EndOfStream() );
        BLEX_TEST_CHECKEQUAL(false, out.GetWriteEnd().IsPipeBroken() );
        in.SetBlocking(false);
        BLEX_TEST_CHECKEQUAL(0u, in.Read(&byte,1));
        in.SetBlocking(true);
        out.GetWriteEnd().SetBlocking(true);
        for (unsigned i=0;i<strlen(send_buffer);++i)
        {
                BLEX_TEST_CHECKEQUAL(1u, out.GetWriteEnd().Write(&send_buffer[i],1));
                BLEX_TEST_CHECKEQUAL(1u, in.Read(&byte,1));
                BLEX_TEST_CHECKEQUAL(send_buffer[i], byte);
        }
        delete out.ReleaseWriteEnd(); //send an EOF
        BLEX_TEST_CHECKEQUAL(0u,   in.Read(&byte,1));
        BLEX_TEST_CHECKEQUAL(true, in.EndOfStream());
}

BLEX_TEST_FUNCTION(TestSocketAddress)
{
        Blex::SocketAddress test;
        BLEX_TEST_CHECKEQUAL("127.0.0.1", Blex::SocketAddress("127.0.0.1",0).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("127.0.0.1", Blex::SocketAddress("127.000.000.001",0).GetIPAddress()); //verify some compatibility with the old 'masks'
        BLEX_TEST_CHECKEQUAL(true, Blex::SocketAddress("127.0.0.1",0).IsIPV4());
        BLEX_TEST_CHECKEQUAL("127.0.0.1", Blex::SocketAddress("::ffff:127.0.0.1",0).GetIPAddress());
        BLEX_TEST_CHECKEQUAL(true, Blex::SocketAddress("::ffff:127.0.0.1",0).IsIPV4());
        BLEX_TEST_CHECKEQUAL("130.89.0.0", Blex::SocketAddress("130.089.000.000",0).GetIPAddress());
        BLEX_TEST_CHECKEQUAL(true, Blex::SocketAddress("::ffff:127.0.0.1",0).IsIPV4());

        BLEX_TEST_CHECKEQUAL("1.2.3.4", Blex::SocketAddress("001.002.003.004",0).GetNetworkNumber(32).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("1.2.3.4", Blex::SocketAddress("001.002.003.004",0).GetNetworkNumber(64).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("1.2.3.4", Blex::SocketAddress("001.002.003.004",0).GetNetworkNumber(63).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("1.2.3.255", Blex::SocketAddress("001.002.003.255",0).GetNetworkNumber(32).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("1.2.3.255", Blex::SocketAddress("001.002.003.255",0).GetNetworkNumber(64).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("1.2.3.255", Blex::SocketAddress("001.002.003.255",0).GetNetworkNumber(63).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("1.2.3.0", Blex::SocketAddress("001.002.003.000",0).GetNetworkNumber(32).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("1.2.3.0", Blex::SocketAddress("001.002.003.000",0).GetNetworkNumber(24).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("1.2.0.0", Blex::SocketAddress("1.2.3.4",0).GetNetworkNumber(16).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("1.0.0.0", Blex::SocketAddress("1.2.3.4",0).GetNetworkNumber(8).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("0.0.0.0", Blex::SocketAddress("1.2.3.4",0).GetNetworkNumber(0).GetIPAddress());

        BLEX_TEST_CHECKEQUAL("252.253.254.255", Blex::SocketAddress("252.253.254.255",0).GetNetworkNumber(32).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("252.253.254.254", Blex::SocketAddress("252.253.254.255",0).GetNetworkNumber(31).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("252.253.254.240", Blex::SocketAddress("252.253.254.255",0).GetNetworkNumber(28).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("252.253.254.0", Blex::SocketAddress("252.253.254.255",0).GetNetworkNumber(24).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("252.253.254.0", Blex::SocketAddress("252.253.254.255",0).GetNetworkNumber(23).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("252.128.0.0", Blex::SocketAddress("252.253.254.255",0).GetNetworkNumber(9).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("252.0.0.0", Blex::SocketAddress("252.253.254.255",0).GetNetworkNumber(6).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("128.0.0.0", Blex::SocketAddress("252.253.254.255",0).GetNetworkNumber(1).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("0.0.0.0", Blex::SocketAddress("252.253.254.255",0).GetNetworkNumber(0).GetIPAddress());

        BLEX_TEST_CHECKEQUAL("::", Blex::SocketAddress("0::0",0).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("::1", Blex::SocketAddress("::1",0).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("1::", Blex::SocketAddress("1::",0).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("fe80::2aa:ff:fe9a:4ca2", Blex::SocketAddress("FE80:0:0:0:2AA:FF:FE9A:4CA2",0).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("ff02::2", Blex::SocketAddress("FF02:0:0:0:0:0:0:0002",0).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("1:2:3::6:7:8", Blex::SocketAddress("1:2:3:0:0:6:7:8",0).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("1:2:3::", Blex::SocketAddress("1:2:3:0:0:0:0:0",0).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("::4:5:6", Blex::SocketAddress("0:0:0:0:0:4:5:6",0).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("0:1:0:0:1::", Blex::SocketAddress("0:1:0:0:1:0:0:0",0).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("fe80::2aa:ff:fe9a:4ca2", Blex::SocketAddress("FE80:0:0:0:2AA:FF:FE9A:4CA2",0).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("fe80::2aa:ff:fe9a:4ca2", Blex::SocketAddress("FE80:0:0:0:2AA:FF:FE9A:4CA2",0).GetNetworkNumber(256).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("fe80::2aa:ff:fe9a:4ca2", Blex::SocketAddress("FE80:0:0:0:2AA:FF:FE9A:4CA2",0).GetNetworkNumber(129).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("fe80::2aa:ff:fe9a:4ca2", Blex::SocketAddress("FE80:0:0:0:2AA:FF:FE9A:4CA2",0).GetNetworkNumber(128).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("fe80::2aa:ff:fe9a:4ca2", Blex::SocketAddress("FE80:0:0:0:2AA:FF:FE9A:4CA2",0).GetNetworkNumber(127).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("fe80::2aa:ff:fe9a:4ca0", Blex::SocketAddress("FE80:0:0:0:2AA:FF:FE9A:4CA2",0).GetNetworkNumber(126).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("fe80:0:2aa:ff::", Blex::SocketAddress("FE80:0:2AA:FF::FE9A:4CA2",0).GetNetworkNumber(64).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("fe80:0:2aa:fe::", Blex::SocketAddress("FE80:0:2AA:FF::FE9A:4CA2",0).GetNetworkNumber(63).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("fe80::", Blex::SocketAddress("FE80:0:0:0:2AA:FF:FE9A:4CA2",0).GetNetworkNumber(16).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("c000::", Blex::SocketAddress("FE80:0:0:0:2AA:FF:FE9A:4CA2",0).GetNetworkNumber(2).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("::", Blex::SocketAddress("FE80:0:0:0:2AA:FF:FE9A:4CA2",0).GetNetworkNumber(0).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("2001:1690:22:100::", Blex::SocketAddress("2001:1690:22:100:7100::2",0).GetNetworkNumber(65).GetIPAddress());
        BLEX_TEST_CHECKEQUAL("2001:1690:22:100:8000::", Blex::SocketAddress("2001:1690:22:100:F100::2",0).GetNetworkNumber(65).GetIPAddress());

        //RFC5952: When the length of the consecutive 16-bit 0 fields are equal, the first sequence of zero   bits MUST be shortened
        BLEX_TEST_CHECKEQUAL("2001:db8::1:0:0:1", Blex::SocketAddress("2001:db8:0:0:1:0:0:1",0).GetIPAddress());
        //RFC5952: The symbol "::" MUST NOT be used to shorten just one 16-bit 0 field.
        BLEX_TEST_CHECKEQUAL("2001:db8:0:1:1:1:1:1", Blex::SocketAddress("2001:db8::1:1:1:1:1",0).GetIPAddress());

        BLEX_TEST_CHECKEQUAL(true, Blex::SocketAddress("127.0.0.1",0).IsSameIPPrefixAs(Blex::SocketAddress("127.0.0.1",0),32));
        BLEX_TEST_CHECKEQUAL(true, Blex::SocketAddress("127.0.0.1",0).IsSameIPPrefixAs(Blex::SocketAddress("127.0.0.1",0),64));
        BLEX_TEST_CHECKEQUAL(true, Blex::SocketAddress("127.0.0.1",0).IsSameIPPrefixAs(Blex::SocketAddress("127.0.0.1",0),0));
        BLEX_TEST_CHECKEQUAL(true, Blex::SocketAddress("127.0.0.1",0).IsSameIPPrefixAs(Blex::SocketAddress("127.0.0.0",0),31));
        BLEX_TEST_CHECKEQUAL(false, Blex::SocketAddress("127.0.0.1",0).IsSameIPPrefixAs(Blex::SocketAddress("127.0.0.2",0),31));
        BLEX_TEST_CHECKEQUAL(true, Blex::SocketAddress("130.89.1.2",0).IsSameIPPrefixAs(Blex::SocketAddress("130.89.0.0",0),16));
        BLEX_TEST_CHECKEQUAL(false, Blex::SocketAddress("130.89.1.2",0).IsSameIPPrefixAs(Blex::SocketAddress("130.88.255.255",0),16));
        BLEX_TEST_CHECKEQUAL(true, Blex::SocketAddress("84.241.137.69",0).IsSameIPPrefixAs(Blex::SocketAddress("84.241.137.65",0),26));
        BLEX_TEST_CHECKEQUAL(true, Blex::SocketAddress("84.241.137.127",0).IsSameIPPrefixAs(Blex::SocketAddress("84.241.137.65",0),26));
        BLEX_TEST_CHECKEQUAL(false, Blex::SocketAddress("84.241.137.63",0).IsSameIPPrefixAs(Blex::SocketAddress("84.241.137.65",0),26));
        BLEX_TEST_CHECKEQUAL(false, Blex::SocketAddress("84.241.137.128",0).IsSameIPPrefixAs(Blex::SocketAddress("84.241.137.65",0),26));

        BLEX_TEST_CHECKEQUAL(false, Blex::SocketAddress("::1",0).IsSameIPPrefixAs(Blex::SocketAddress("::2",0),128));
        BLEX_TEST_CHECKEQUAL(false, Blex::SocketAddress("::1",0).IsSameIPPrefixAs(Blex::SocketAddress("::2",0),127));
        BLEX_TEST_CHECKEQUAL(true, Blex::SocketAddress("::1",0).IsSameIPPrefixAs(Blex::SocketAddress("::2",0),126));
        BLEX_TEST_CHECKEQUAL(false, Blex::SocketAddress("::1",0).IsSameIPPrefixAs(Blex::SocketAddress("::",0),128));
        BLEX_TEST_CHECKEQUAL(true, Blex::SocketAddress("::1",0).IsSameIPPrefixAs(Blex::SocketAddress("::",0),127));
        BLEX_TEST_CHECKEQUAL(true, Blex::SocketAddress("::1",0).IsSameIPPrefixAs(Blex::SocketAddress("::",0),126));
        BLEX_TEST_CHECKEQUAL(true, Blex::SocketAddress("2001:1690:22:100::2",0).IsSameIPPrefixAs(Blex::SocketAddress("2001:1690:22:100::1",0),64));
        BLEX_TEST_CHECKEQUAL(false, Blex::SocketAddress("2001:1690:22:100::2",0).IsSameIPPrefixAs(Blex::SocketAddress("2001:1690:21:101::1",0),64));
        BLEX_TEST_CHECKEQUAL(false, Blex::SocketAddress("2001:1690:22:100::2",0).IsSameIPPrefixAs(Blex::SocketAddress("2001:1690:21:101::1",0),48));
        BLEX_TEST_CHECKEQUAL(false, Blex::SocketAddress("2001:1690:22:100::2",0).IsSameIPPrefixAs(Blex::SocketAddress("2001:1690:21:101::1",0),56));
        BLEX_TEST_CHECKEQUAL(false, Blex::SocketAddress("2001:1690:21:200::2",0).IsSameIPPrefixAs(Blex::SocketAddress("2001:1690:21:101::1",0),56));
        BLEX_TEST_CHECKEQUAL(true, Blex::SocketAddress("2001:1690:21:200::2",0).IsSameIPPrefixAs(Blex::SocketAddress("2001:1690:21:101::1",0),48));
        BLEX_TEST_CHECKEQUAL(true,  Blex::SocketAddress("2001:1690:22:100:F100::2",0).IsSameIPPrefixAs(Blex::SocketAddress("2001:1690:22:100:101::1",0),64));
        BLEX_TEST_CHECKEQUAL(false, Blex::SocketAddress("2001:1690:22:100:F100::2",0).IsSameIPPrefixAs(Blex::SocketAddress("2001:1690:22:100:101::1",0),65));

        BLEX_TEST_CHECKTHROW(Blex::SocketAddress("127.0.0.1",65536), std::invalid_argument);
        BLEX_TEST_CHECKTHROW(Blex::SocketAddress("127.0.0.256",80), std::invalid_argument);
        BLEX_TEST_CHECKEQUAL("127.0.0.1:80", Blex::SocketAddress("127.0.0.1:80").ToString());
        BLEX_TEST_CHECKEQUAL("[::1]:80", Blex::SocketAddress("[::1]:80").ToString());
        BLEX_TEST_CHECKTHROW(Blex::SocketAddress("127.0.0.1"), std::invalid_argument);
        BLEX_TEST_CHECKTHROW(Blex::SocketAddress("[::1]"), std::invalid_argument);
        BLEX_TEST_CHECKTHROW(Blex::SocketAddress("::1:80"), std::invalid_argument);
        BLEX_TEST_CHECKTHROW(Blex::SocketAddress("[127.0.0.1]:80"), std::invalid_argument);
}

BLEX_TEST_FUNCTION(TestPipes)
{
        //Create the pipes first
        Blex::PipeSet temp;

        DoBidirectionalTest(temp.GetReadEnd(),temp);

        //Test whether we can abort reads
        Blex::PipeSet test_read_abort;
        BLEX_TEST_CHECK(test_read_abort.GetWriteEnd().WriteLsb<uint8_t>(1));
        BLEX_TEST_CHECKEQUAL(1u, test_read_abort.GetReadEnd().ReadLsb<uint8_t>());

        //Try to cleanup the read end (may hang if cancellation is handelled improperly)
        delete test_read_abort.ReleaseReadEnd();

        //Test whether we can abort reads with non blocking read pipes
        Blex::PipeSet test_read_abort2;
        test_read_abort2.GetReadEnd().SetBlocking(false);
        BLEX_TEST_CHECK(test_read_abort2.GetWriteEnd().WriteLsb<uint8_t>(1));

        /* This test used to assume that written data IMMEDIATELY appears on
           the read end, but that's not guaranteed (the Win95 implementation
           has a race condition in this test, as its SubThread may be too slow
           to signal received data before the readend.Read() comes up

           Attempt to work around: loop & yield until we get some data */
        while(test_read_abort2.GetReadEnd().ReadLsb<uint8_t>() != 1)
            Blex::YieldThread();

        //Try to cleanup the read end (may hang if cancellation is handelled improperly)
        delete test_read_abort2.ReleaseReadEnd();
}

BLEX_TEST_FUNCTION(TestMultipipe)
{
        Blex::PipeSet pipe1,pipe2,pipe3;
        Blex::PipeWaiter wait;

        pipe1.GetReadEnd().SetBlocking(false);
        pipe2.GetReadEnd().SetBlocking(false);
        pipe3.GetReadEnd().SetBlocking(false);

        wait.AddReadPipe(pipe1.GetReadEnd());
        wait.AddReadPipe(pipe2.GetReadEnd());
        wait.AddReadPipe(pipe3.GetReadEnd());
        BLEX_TEST_CHECKEQUAL(true, wait.RemoveReadPipe(pipe3.GetReadEnd()));
        BLEX_TEST_CHECKEQUAL(false, wait.RemoveReadPipe(pipe3.GetReadEnd()));

        //no pipe should be alive yet..
        BLEX_TEST_CHECK(wait.Wait(Blex::DateTime::Min())==false);

        uint8_t byte=5;
        pipe1.GetWriteEnd().WriteLsb(byte);

        //check if the pipe is really alive..
        BLEX_TEST_CHECK(wait.Wait(Blex::DateTime::Max()));
        BLEX_TEST_CHECKEQUAL(true,wait.GotRead(pipe1.GetReadEnd()));
        BLEX_TEST_CHECKEQUAL(false,wait.GotRead(pipe2.GetReadEnd()));

        BLEX_TEST_CHECK(wait.Wait(Blex::DateTime::Min()));
        BLEX_TEST_CHECKEQUAL(true,wait.GotRead(pipe1.GetReadEnd()));
        BLEX_TEST_CHECKEQUAL(false,wait.GotRead(pipe2.GetReadEnd()));

        BLEX_TEST_CHECK(pipe1.GetReadEnd().ReadLsb<uint8_t>() == byte);
        BLEX_TEST_CHECK(wait.Wait(Blex::DateTime::Min())==false);

        //do something with the second pipe
        pipe2.GetWriteEnd().WriteLsb(byte);
        BLEX_TEST_CHECK(wait.Wait(Blex::DateTime::Max()));
        BLEX_TEST_CHECKEQUAL(false,wait.GotRead(pipe1.GetReadEnd()));
        BLEX_TEST_CHECKEQUAL(true,wait.GotRead(pipe2.GetReadEnd()));
        BLEX_TEST_CHECK(pipe2.GetReadEnd().ReadLsb<uint8_t>() == byte);

        //check that both pipes are now marked unreadable
        BLEX_TEST_CHECK(wait.Wait(Blex::DateTime::Min())==false);
        BLEX_TEST_CHECKEQUAL(false,wait.GotRead(pipe1.GetReadEnd()));
        BLEX_TEST_CHECKEQUAL(false,wait.GotRead(pipe2.GetReadEnd()));

        //make both pipes writable
        pipe1.GetWriteEnd().WriteLsb(byte);
        pipe2.GetWriteEnd().WriteLsb(byte);
        BLEX_TEST_CHECK(wait.Wait(Blex::DateTime::Max()));
        BLEX_TEST_CHECKEQUAL(true,wait.GotRead(pipe1.GetReadEnd()) || wait.GotRead(pipe2.GetReadEnd()));

        //Read a byte from at least one of the pipes
        if (wait.GotRead(pipe1.GetReadEnd()))
            BLEX_TEST_CHECK(pipe1.GetReadEnd().ReadLsb<uint8_t>() == byte);
        else
            BLEX_TEST_CHECK(pipe2.GetReadEnd().ReadLsb<uint8_t>() == byte);

        //Wait again
        BLEX_TEST_CHECK(wait.Wait(Blex::DateTime::Max()));
        BLEX_TEST_CHECKEQUAL(true,wait.GotRead(pipe1.GetReadEnd()) || wait.GotRead(pipe2.GetReadEnd()));
        BLEX_TEST_CHECKEQUAL(false,wait.GotRead(pipe1.GetReadEnd()) && wait.GotRead(pipe2.GetReadEnd()));

        //Read a byte from The other pipe
        if (wait.GotRead(pipe1.GetReadEnd()))
            BLEX_TEST_CHECK(pipe1.GetReadEnd().ReadLsb<uint8_t>() == byte);
        else
            BLEX_TEST_CHECK(pipe2.GetReadEnd().ReadLsb<uint8_t>() == byte);
}

BLEX_TEST_FUNCTION(TestPipeLoopback)
{
        //create two unidirectional pipes
        Blex::PipeSet input;
        Blex::PipeSet output;

        input.GetReadEnd().SetBlocking(true);
        input.GetWriteEnd().SetBlocking(true);
        output.GetReadEnd().SetBlocking(true);
        output.GetWriteEnd().SetBlocking(true);

        Blex::Process testloopback;
        testloopback.RedirectInput(input.GetReadEnd());
        testloopback.RedirectOutput(output.GetWriteEnd(),false);

        //Launch the loopback process
        std::vector <std::string> args;
        args.push_back("loopback");
        BLEX_TEST_CHECK(testloopback.Start(self_app,args,"",false));

        //Also test the new process management functions
        BLEX_TEST_CHECKEQUAL(false, testloopback.IsFinished());
        BLEX_TEST_CHECKEQUAL(false, testloopback.TimedWaitFinish(Blex::DateTime::Now() + Blex::DateTime::Msecs(100)));

        DoBidirectionalTest(output.GetReadEnd(),input);
        testloopback.WaitFinish();
        BLEX_TEST_CHECKEQUAL(true, testloopback.IsFinished());
        BLEX_TEST_CHECKEQUAL(true, testloopback.TimedWaitFinish(Blex::DateTime::Now() + Blex::DateTime::Msecs(100)));
}

BLEX_TEST_FUNCTION(TestSocketSet)
{
        Blex::SocketSet sockets(Blex::Socket::Stream, false);
        char writebuf[] = "Test Data";
        char readbuf[sizeof writebuf];

        //test sending from left to right, and DataAvailable()
        BLEX_TEST_CHECKEQUAL(sizeof writebuf,sockets.GetLeftEnd().Send(writebuf,sizeof writebuf));
        BLEX_TEST_CHECKEQUAL(1,sockets.GetRightEnd().Receive(readbuf,1));
        BLEX_TEST_CHECKEQUAL((sizeof writebuf) - 1,sockets.GetRightEnd().Receive(readbuf + 1,(sizeof writebuf) - 1));
        BLEX_TEST_CHECK(std::equal(writebuf,writebuf+sizeof writebuf,readbuf));

        //test reverse direction sending from left to right
        std::reverse(writebuf,writebuf+sizeof writebuf);
        BLEX_TEST_CHECKEQUAL(sizeof writebuf,sockets.GetRightEnd().Send(writebuf,sizeof writebuf));
        BLEX_TEST_CHECKEQUAL(sizeof writebuf,sockets.GetLeftEnd().Receive(readbuf,sizeof writebuf));
        BLEX_TEST_CHECK(std::equal(writebuf,writebuf+sizeof writebuf,readbuf));
}

BLEX_TEST_FUNCTION(TestSocketWait)
{
        uint8_t buf[4096];

        Blex::SocketSet sockets(Blex::Socket::Stream, false);

        Blex::PipeWaiter waiter;
        sockets.GetRightEnd().SetBlocking(false);
        waiter.AddSocket(sockets.GetRightEnd(),true,false); //listen for readability

        BLEX_TEST_CHECKEQUAL(false, waiter.Wait(Blex::DateTime::Min()));
        BLEX_TEST_CHECKEQUAL(false, waiter.GotRead(sockets.GetRightEnd()));

        memset(buf,0,sizeof (buf));
        strcpy(reinterpret_cast<char*>(buf),"The quick brown fox....  yada yada yada");

        unsigned in_buf = sockets.GetLeftEnd().Send(buf, sizeof(buf));

        BLEX_TEST_CHECK(waiter.Wait(Blex::DateTime::Now() + Blex::DateTime::Seconds(5)));
        BLEX_TEST_CHECKEQUAL(true, waiter.GotRead(sockets.GetRightEnd()));

        in_buf -= sockets.GetRightEnd().Receive(buf, in_buf - 1);

        BLEX_TEST_CHECK(waiter.Wait(Blex::DateTime::Now() + Blex::DateTime::Seconds(5)));
        BLEX_TEST_CHECKEQUAL(true, waiter.GotRead(sockets.GetRightEnd()));

        while (in_buf) in_buf -= sockets.GetRightEnd().Receive(buf, in_buf);

        BLEX_TEST_CHECKEQUAL(false, waiter.Wait(Blex::DateTime::Min()));
        BLEX_TEST_CHECKEQUAL(false, waiter.GotRead(sockets.GetRightEnd()));
}

//these tests are unreliable on OSX? writing 4096 suddenly started to hang when wirting, 512 worked here, but i can't even find the "4096 bytes won't block" guarantee in the OSX specs..
#ifndef PLATFORM_DARWIN
BLEX_TEST_FUNCTION(TestMixedWaiters)
{
        uint8_t buf[4096];

        Blex::SocketSet sockets(Blex::Socket::Stream, false);
        Blex::PipeSet pipe;

        Blex::PipeWaiter waiter;
        sockets.GetRightEnd().SetBlocking(false);
        pipe.GetReadEnd().SetBlocking(false);
        waiter.AddSocket(sockets.GetRightEnd(),true,false); //listen for readability
        waiter.AddReadPipe(pipe.GetReadEnd()); //listen for readability

        BLEX_TEST_CHECKEQUAL(false, waiter.Wait(Blex::DateTime::Min()));
        BLEX_TEST_CHECKEQUAL(false, waiter.GotRead(pipe.GetReadEnd()));
        BLEX_TEST_CHECKEQUAL(false, waiter.GotRead(sockets.GetRightEnd()));

        memset(buf,0,sizeof (buf));
        strcpy(reinterpret_cast<char*>(buf),"The quick brown fox....  yada yada yada");

        unsigned in_socket_buf = sockets.GetLeftEnd().Send(buf, sizeof(buf));

        BLEX_TEST_CHECK(waiter.Wait(Blex::DateTime::Now() + Blex::DateTime::Seconds(5)));
        BLEX_TEST_CHECKEQUAL(false, waiter.GotRead(pipe.GetReadEnd()));
        BLEX_TEST_CHECKEQUAL(true, waiter.GotRead(sockets.GetRightEnd()));

        unsigned in_pipe_buf = pipe.GetWriteEnd().Write(buf,sizeof buf);

        BLEX_TEST_CHECK(waiter.Wait(Blex::DateTime::Now() + Blex::DateTime::Seconds(5)));
        BLEX_TEST_CHECKEQUAL(true, waiter.GotRead(pipe.GetReadEnd()) || waiter.GotRead(sockets.GetRightEnd()));

        while (in_socket_buf)
            in_socket_buf -= sockets.GetRightEnd().Receive(buf, in_socket_buf);

        BLEX_TEST_CHECK(waiter.Wait(Blex::DateTime::Now() + Blex::DateTime::Seconds(5)));
        BLEX_TEST_CHECKEQUAL(true, waiter.GotRead(pipe.GetReadEnd()));
        BLEX_TEST_CHECKEQUAL(false, waiter.GotRead(sockets.GetRightEnd()));

        while (in_pipe_buf)
            in_pipe_buf -= pipe.GetReadEnd().Read(buf,in_pipe_buf);

        BLEX_TEST_CHECKEQUAL(false, waiter.Wait(Blex::DateTime::Min()));
        BLEX_TEST_CHECKEQUAL(false, waiter.GotRead(pipe.GetReadEnd()));
        BLEX_TEST_CHECKEQUAL(false, waiter.GotRead(sockets.GetRightEnd()));

        //waiter.AddSocket(sockets.GetRightEnd(),false).GetIPAddress(); //listen for writability
}

BLEX_TEST_FUNCTION(TestWriteWait)
{
        uint8_t buf[4096];
        unsigned numbyteswritten=0;

        Blex::PipeSet pipe;
        Blex::PipeWaiter waiter;

        pipe.GetWriteEnd().SetBlocking(false);

        waiter.AddWritePipe(pipe.GetWriteEnd());
        BLEX_TEST_CHECKEQUAL(true, waiter.Wait(Blex::DateTime::Min()));
        BLEX_TEST_CHECKEQUAL(true, waiter.GotWrite(pipe.GetWriteEnd()));

        memset(buf,0,sizeof (buf));
        strcpy(reinterpret_cast<char*>(buf),"The quick brown fox....  yada yada yada");

        while (unsigned numbytes = pipe.GetWriteEnd().Write(buf,sizeof buf))
            numbyteswritten += numbytes;

        //Buffer should now be full!
        BLEX_TEST_CHECKEQUAL(false, waiter.Wait(Blex::DateTime::Min()));
        BLEX_TEST_CHECKEQUAL(false, waiter.GotWrite(pipe.GetWriteEnd()));

        //Read all written bytes from the read side
        while (numbyteswritten > 0)
        {
                unsigned numbytes = pipe.GetReadEnd().Read(buf,sizeof buf);
                numbyteswritten -= numbytes;
        }

        //Buffer should now be writable again
        BLEX_TEST_CHECKEQUAL(true, waiter.Wait(Blex::DateTime::Min()));
        BLEX_TEST_CHECKEQUAL(true, waiter.GotWrite(pipe.GetWriteEnd()));
}
#endif

void SecureListener(Blex::Socket *rightend)
{
        Blex::SSLContext ccontext(false, "");
        rightend->SetSecure(&ccontext);

        while(true)
        {
                uint8_t byte;
                int retval = rightend->TimedReceive(&byte,1,Blex::DateTime::Max()).second;
                if(retval==Blex::SocketError::Closed)
                    return;
                if(retval!=1)
                {
                        rightend->Close();
                        return;
                }
                retval=rightend->TimedSend(&byte,1,Blex::DateTime::Max()).second;
                if(retval!=1)
                {
                        //ignore - caused by unclean shutdowns Blex::ErrStream() << "SecureListener: unexpected Write error: " << retval;
                        rightend->Close();
                        return;
                }
        }
}

BLEX_TEST_FUNCTION(TestSecureSockets)
{
        Blex::SocketSet sockets(Blex::Socket::Stream, false);
        sockets.GetLeftEnd().SetBlocking(false);
        sockets.GetRightEnd().SetBlocking(false);
        Blex::SSLContext scontext(true, "");
        Blex::Thread listener(std::bind(SecureListener, &sockets.GetRightEnd()));
        listener.Start();

        BLEX_TEST_CHECK(scontext.LoadPrivateKey(test_pvt_key,strlen(test_pvt_key)));
        BLEX_TEST_CHECK(scontext.LoadCertificate(test_cert,strlen(test_cert)));
        BLEX_TEST_CHECKEQUAL(Blex::SocketError::NoError,sockets.GetLeftEnd().SetSecure(&scontext));

        char writebuf[] = "Test Data";

        //Try to send data to the output socket..
        //test sending from left to right, and DataAvailable()
        std::pair<Blex::SocketError::Errors, int32_t> sres = sockets.GetLeftEnd().TimedSend(writebuf,sizeof writebuf,Blex::DateTime::Max());
        Blex::ErrStream() << "sres: " << sres.first << ":" << sres.second;
        BLEX_TEST_CHECKEQUAL(sizeof writebuf,sres.second);

        for(unsigned i=0;i<sizeof writebuf;++i)
        {
                uint8_t byte;
                BLEX_TEST_CHECKEQUAL(1,sockets.GetLeftEnd().TimedReceive(&byte,1,Blex::DateTime::Max()).second);
                BLEX_TEST_CHECKEQUAL(byte,writebuf[i]);
        }

        //ADDME: Nice shutdown?!
        sockets.GetLeftEnd().Close();
        //ADDME: Send some more data to verify proper shutdown and protocol state
}

BLEX_TEST_FUNCTION(TestSecureNonBlockingSockets)
{
        Blex::DebugSocket lhs(Blex::Socket::Stream), rhs(Blex::Socket::Stream);
#ifdef DEBUG
//        lhs.SetDebugMode(Blex::DebugSocket::Calls);
  //      rhs.SetDebugMode(Blex::DebugSocket::Calls);
#endif
        BLEX_TEST_CHECK(TryConnectSockets(lhs, rhs, false));

        Blex::SSLContext scontext(true,""),ccontext(false,"");
        lhs.SetBlocking(false);
        rhs.SetBlocking(false);

        BLEX_TEST_CHECK(scontext.LoadPrivateKey(test_pvt_key,strlen(test_pvt_key)));
        BLEX_TEST_CHECK(scontext.LoadCertificate(test_cert,strlen(test_cert)));
        BLEX_TEST_CHECKEQUAL(Blex::SocketError::NoError,lhs.SetSecure(&scontext));
        BLEX_TEST_CHECKEQUAL(Blex::SocketError::NoError,rhs.SetSecure(&ccontext));

        //Send from server to client
        Blex::PipeWaiter wait;

        for(unsigned i=0;i<42;++i)
        {
                DEBUGPRINT("----------------------------------- iteration " << i << " ----------------------");
                std::string testdata="This is some test data " + Blex::AnyToString(i) + ".";
                wait.AddSocket(lhs, false, true);
                wait.AddSocket(rhs, true, false);

                unsigned sendptr=0;
                std::string received;
                while(received.size() != testdata.size())
                {
                        wait.Wait(Blex::DateTime::Max());
                        if (wait.GotWrite(lhs))
                        {
                                int result = lhs.Send(&testdata[sendptr], 1);
                                if(result<=0 && result!=Blex::SocketError::WouldBlock)
                                    BLEX_TEST_CHECKEQUAL(1, result);
                                if(result>0)
                                {
                                        ++sendptr;
                                        //DEBUGPRINT("WRITE: Now completed " << sendptr<< " bytes: " << std::string(testdata.begin(), testdata.begin()+sendptr));
                                        if(sendptr == testdata.size() || i==0)
                                            wait.AddSocket(lhs, false, false); //stop reading (in first iteration, always cease write after a succesful byte)
                                }
                        }
                        if (wait.GotRead(rhs))
                        {
                                uint8_t data;
                                int result = rhs.Receive(&data, 1);
                                if(result<=0 && result!=Blex::SocketError::WouldBlock)
                                    BLEX_TEST_CHECKEQUAL(1, result);
                                if(result>0)
                                {
                                        received.push_back(data);
                                        //DEBUGPRINT("READ: Now completed " << received.size() << " bytes: " << received);
                                        if(i==0)
                                            wait.AddSocket(lhs, false, true); //reenable the writer
                                }
                        }
                }
                BLEX_TEST_CHECKEQUAL(testdata, received);
        }
}

BLEX_TEST_FUNCTION(SocketTCPTest)
{
        Blex::DebugSocket accepting_socket(Blex::Socket::Stream), connecting_socket(Blex::Socket::Stream), connecting_socket_2(Blex::Socket::Stream);
#ifdef DEBUG
        accepting_socket.SetDebugMode(Blex::DebugSocket::Calls);
        connecting_socket.SetDebugMode(Blex::DebugSocket::Calls);
        connecting_socket_2.SetDebugMode(Blex::DebugSocket::Calls);
#endif

//          TestEqualBoolean(1, TRUE, BindSocket(accepting_socket, "", 0));
//should fail, socket not yet open
        BLEX_TEST_CHECKEQUAL(Blex::SocketError::Refused, connecting_socket.Connect(Blex::SocketAddress("127.0.0.1", 65430)));

        //bind the socket to a local port (we don't care which)
        BLEX_TEST_CHECKEQUAL(Blex::SocketError::NoError, accepting_socket.Bind(Blex::SocketAddress("127.0.0.1", 0)));
#ifndef __APPLE__ /* On apple, connecting to a bound non-listening socket hangs */
        BLEX_TEST_CHECKEQUAL(Blex::SocketError::Refused, connecting_socket.Connect(accepting_socket.GetLocalAddress()));
#endif
        BLEX_TEST_CHECKEQUAL(Blex::SocketError::SocketIsBlocking, connecting_socket.TimedConnect(accepting_socket.GetLocalAddress(), Blex::DateTime::Max()));
        BLEX_TEST_CHECKEQUAL(Blex::SocketError::NoError, connecting_socket.SetBlocking(false));
#ifndef __APPLE__ /* On apple, connecting to a bound non-listening socket hangs */
        BLEX_TEST_CHECKEQUAL(Blex::SocketError::Refused, connecting_socket.TimedConnect(accepting_socket.GetLocalAddress(), Blex::DateTime::Max()));
#endif
        BLEX_TEST_CHECKEQUAL(Blex::SocketError::NoError, connecting_socket.SetBlocking(true));

        BLEX_TEST_CHECKEQUAL(Blex::SocketError::NoError, accepting_socket.Listen());
        BLEX_TEST_CHECKEQUAL(Blex::SocketError::NoError, connecting_socket.Connect(accepting_socket.GetLocalAddress()));
        BLEX_TEST_CHECKEQUAL(Blex::SocketError::SocketIsBlocking, connecting_socket_2.TimedConnect(accepting_socket.GetLocalAddress(), Blex::DateTime::Max()));
        connecting_socket_2.SetBlocking(false);
        BLEX_TEST_CHECKEQUAL(Blex::SocketError::NoError, connecting_socket_2.TimedConnect(accepting_socket.GetLocalAddress(), Blex::DateTime::Max()));
}

BLEX_TEST_FUNCTION(GetLocalIPsTest)
{
         std::vector<Blex::SocketAddress> ips;
         Blex::GetLocalIPs(&ips);

         bool found_localhost_ipv4 = false;
         for(unsigned i=0;i<ips.size();++i)
         {
                 if(ips[i].GetIPAddress()=="127.0.0.1")
                         found_localhost_ipv4 = true;
         }
         BLEX_TEST_CHECK(found_localhost_ipv4);
}

bool HaveIPV6()
{
         std::vector<Blex::SocketAddress> ips;
         Blex::GetLocalIPs(&ips);

         for(unsigned i=0;i<ips.size();++i)
         {
                if(ips[i].GetIPAddress()=="::1")
                        return true;
         }
         return false;
}

BLEX_TEST_FUNCTION(SocketIPv6Test)
{
        if(!HaveIPV6())
        {
                Blex::ErrStream() << "No IPv6, skipping IPv6 tests\n";
                return;
        }

        Blex::SocketSet sockets(Blex::Socket::Stream, true/*ipv6*/);
        char writebuf[] = "Test IPv6 Data";
        char readbuf[sizeof writebuf];

        //test sending from left to right, and DataAvailable()
        BLEX_TEST_CHECKEQUAL(sizeof writebuf,sockets.GetLeftEnd().Send(writebuf,sizeof writebuf));
        BLEX_TEST_CHECKEQUAL(1,sockets.GetRightEnd().Receive(readbuf,1));
        BLEX_TEST_CHECKEQUAL((sizeof writebuf) - 1,sockets.GetRightEnd().Receive(readbuf + 1,(sizeof writebuf) - 1));
        BLEX_TEST_CHECK(std::equal(writebuf,writebuf+sizeof writebuf,readbuf));
}

class MyDispatchConn : public Blex::Dispatcher::Connection
{
        uint8_t outbuf[16];
        uint8_t largebuf[65536];
        unsigned outstanding_blocks;

public:
        MyDispatchConn(void *dispatcher)
        : Blex::Dispatcher::Connection(dispatcher)
        {
                outstanding_blocks = 0;
                memset(largebuf, 0, sizeof(largebuf));
        }


        void HookIncomingData(uint8_t const *start, unsigned bufferlen)
        {
                // No blocks may be outstanding when this function is called
                BLEX_TEST_CHECKEQUAL(0, outstanding_blocks);

                unsigned bytescopied=0;
                for (; bytescopied < sizeof( outbuf ) && bytescopied < bufferlen; ++bytescopied)
                    outbuf[bytescopied] = start[bytescopied] ^ 0xFF;

                Blex::Dispatcher::SendData out(outbuf, bytescopied);
                AsyncQueueSend(1, &out);
                ++outstanding_blocks;

                if (start[0] == 'S')
                {
                        // Sending 8meg extra bytes
                        for (unsigned idx = 0; idx < 128; ++idx)
                        {
                                Blex::Dispatcher::SendData out2(largebuf, sizeof(largebuf));
                                AsyncQueueSend(1, &out2);
                                ++outstanding_blocks;
                        }
                }

                ClearIncomingData(bytescopied);
        }

        void HookSignal(Blex::Dispatcher::Signals::SignalType )
        {
        }

        void HookDataBlocksSent(unsigned x)
        {
                // Don't call when no blocks have been sent FIXME: disabled for now, see call site of HookDataBlocksSent for reason
//                BLEX_TEST_CHECK(x != 0);

                outstanding_blocks -= x;
        }

        bool HookExecuteTask(Blex::Dispatcher::Task *)
        {
                return true;
        }

        void HookEventSignalled(Blex::Event *)
        {
        }
};

MyDispatchConn* CreateDispatchConn(void *disp)
{
        return new MyDispatchConn(disp);
}

Blex::CoreMutex  dispatlock;
std::unique_ptr<Blex::Dispatcher::Dispatcher> dispat;

void DispatcherThread(Blex::SocketAddress tcplistener, Blex::SocketAddress securetcplistener/*, std::string const &pipelistener*/)
{
        std::unique_ptr< Blex::FileStream > keyfile, certfile;
        keyfile.reset(Blex::FileStream::OpenRead(Blex::Test::GetTestFilePath("dispatcher_ssl_test.key")));
        certfile.reset(Blex::FileStream::OpenRead(Blex::Test::GetTestFilePath("dispatcher_ssl_test.crt")));

        Blex::Dispatcher::ListenAddress addr[2/*3*/];
        addr[0].sockaddr = tcplistener;
        addr[1].sockaddr = securetcplistener;
        addr[1].privatekey = Blex::ReadStreamAsString(*keyfile);
        addr[1].certificatechain = Blex::ReadStreamAsString(*certfile);

        dispatlock.Lock();
        dispat.reset(new Blex::Dispatcher::Dispatcher (&CreateDispatchConn));
        dispatlock.Unlock();
        dispat->UpdateListenPorts(2/*3*/, addr);
        dispat->RebindSockets(NULL);
        dispat->Start(2,90, false);

        dispat.reset();
}

#ifdef DEBUG
#define SOCKETTYPE Blex::DebugSocket
#else
#define SOCKETTYPE Blex::Socket
#endif

void TestPipe(Blex::Stream &str)
{
        std::string indata("12345678901234567890123456789012");
        std::string outdata;

        BLEX_TEST_CHECKEQUAL(indata.size(), str.Write(indata.data(), indata.size()));
        while(outdata.size() < indata.size())
        {
                unsigned curoutdatalen = outdata.size();
                outdata.resize(curoutdatalen + 32);
                int bytesread = str.Read(&outdata[curoutdatalen], outdata.size() - curoutdatalen);
                outdata.resize(curoutdatalen + std::max(bytesread,0));
                if(bytesread < 0)
                    break;
        }
        BLEX_TEST_CHECKEQUAL(outdata.size(), indata.size());
        for(unsigned i=0;i<indata.size();++i)
            outdata[i] ^= 0xFF;
        BLEX_TEST_CHECKEQUAL(indata, outdata);
}

void TestConn(SOCKETTYPE &sock)
{
        std::string indata("12345678901234567890123456789012");
        std::string outdata;

        BLEX_TEST_CHECKEQUAL(indata.size(), sock.Send(indata.data(), indata.size()));
        while(outdata.size() < indata.size())
        {
                unsigned curoutdatalen = outdata.size();
                outdata.resize(curoutdatalen + 32);
                int bytesread = sock.Receive(&outdata[curoutdatalen], outdata.size() - curoutdatalen);
                outdata.resize(curoutdatalen + std::max(bytesread,0));
                if(bytesread < 0)
                    break;
        }
        BLEX_TEST_CHECKEQUAL(outdata.size(), indata.size());
        for(unsigned i=0;i<indata.size();++i)
            outdata[i] ^= 0xFF;
        BLEX_TEST_CHECKEQUAL(indata, outdata);
}

BLEX_TEST_FUNCTION(DispatTest)
{
        Blex::SocketAddress socket_addr("127.0.0.1", 34343); //ADDME Dynamic or random port
        Blex::SocketAddress secure_socket_addr("127.0.0.1", 34344); //ADDME Dynamic or random port

        Blex::Thread listener(std::bind(&DispatcherThread, socket_addr, secure_socket_addr/*, pipepath*/));
        listener.Start();

        //Try to connect
#ifdef DEBUG
        Blex::DebugSocket tcpsock(Blex::Socket::Stream, Blex::DebugSocket::All);
#else
        Blex::Socket tcpsock(Blex::Socket::Stream);
#endif
        for(unsigned i=0;i<30;i++)
        {
                if (tcpsock.Connect(socket_addr)==0)
                    break;
                Blex::SleepThread(250);
        }
        TestConn(tcpsock);

        dispatlock.Lock();
        dispat->InterruptHandler(1);
        dispatlock.Unlock();
}

BLEX_TEST_FUNCTION(DispatSSLDataTest)
{
        Blex::ErrStream() << "DispatSSLDataTest";

        Blex::SocketAddress socket_addr("127.0.0.1", 34345); //ADDME Dynamic or random port
        Blex::SocketAddress secure_socket_addr("127.0.0.1", 34346); //ADDME Dynamic or random port

        Blex::Thread listener(std::bind(&DispatcherThread, socket_addr, secure_socket_addr/*, pipepath*/));
        listener.Start();

#if defined(DEBUG) and 0
        Blex::DebugSocket tcpsock(Blex::Socket::Stream, Blex::DebugSocket::All);
#else
        Blex::Socket tcpsock(Blex::Socket::Stream);
#endif

        for(unsigned i=0;i<30;i++)
        {
                if (tcpsock.Connect(secure_socket_addr)==0)
                    break;
                Blex::SleepThread(250);
        }

        Blex::SSLContext ccontext(false, "");
        tcpsock.SetSecure(&ccontext);
        tcpsock.SetBlocking(false);

        char tosend[20] = "S123456789ABCDEF012";
        char toreceive[65536];
        tcpsock.TimedSend(tosend, 19, Blex::DateTime::Max());

        Blex::SleepThread(100);

        tcpsock.SendSSLShutdown();
        tcpsock.Shutdown(false, true);

        // Wait for dispatcher to process & send a lot
        Blex::SleepThread(1000);

        signed res = tcpsock.TimedReceive(toreceive, 19, Blex::DateTime::Max()).second;

        // Receive 8 meg
        unsigned left = 65536 * 128;
        while (left > 0)
        {
                res = tcpsock.TimedReceive(toreceive, left, Blex::DateTime::Max()).second;
                if (res <= 0)
                    break;
                left -= res;
                DEBUGPRINT("Still wanting " << left << " bytes");
        }

        dispatlock.Lock();
        dispat->InterruptHandler(1);
        dispatlock.Unlock();
}

BLEX_TEST_FUNCTION(PipeWaiterManyWaits)
{
        std::vector< std::pair< std::shared_ptr< Blex::Socket >, std::shared_ptr< Blex::Socket > > > socketpairs;

        unsigned wait_count = 150;

        Blex::PipeWaiter waiter;
        for (unsigned i = 0; i < wait_count; ++i)
        {
                Blex::SocketSet sockets(Blex::Socket::Stream, false);
                socketpairs.push_back(std::make_pair(std::shared_ptr< Blex::Socket >(sockets.ReleaseLeftEnd()), std::shared_ptr< Blex::Socket >(sockets.ReleaseRightEnd())));
                socketpairs.back().second->SetBlocking(false);
                waiter.AddSocket(*socketpairs.back().second, true, false);
        }

        for (unsigned i = 0; i < wait_count * 2; ++i)
        {
                unsigned socknr = (i * 17) % wait_count;
                socketpairs[socknr].first->WriteLsb(uint8_t(i));
                waiter.Wait(Blex::DateTime::Now()+Blex::DateTime::Seconds(60)); //needs a safety margin on mac
                BLEX_TEST_CHECKEQUAL(true, waiter.GotRead(*socketpairs[socknr].second));
                BLEX_TEST_CHECKEQUAL(socketpairs[socknr].second->ReadLsb<uint8_t>(), uint8_t(i));
        }
}
