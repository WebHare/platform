#include <blex/blexlib.h>

#include <netdb.h>
#include <sys/ioctl.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/uio.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/un.h>
#include <resolv.h>
#include <arpa/inet.h>
#include <net/if.h>
#include <fcntl.h>
#include <csignal>
#include <ifaddrs.h>
#define SOCKET_ERROR -1
#define INVALID_SOCKET -1
#define SETSOCKOPTCAST void*
#define SD_BOTH 2 //replace this with a proper check for any #define-s...
#define ioctlsocket(x,y,z) ioctl(x,y,z) //or an ioctlsocket...

#include "pipestream.h"
#include "socket.h"
#include "crypto.h"
#include "logfile.h"
#include <string>
#include <list>
#include <ctime>
#include <iostream>
#include <iomanip>
#include <openssl/bio.h>
#include <openssl/ssl.h>
#include <cerrno>

//#define SOCKETERRORDEBUG //log last socket errors
//#define SSLDEBUG //extensive SSL I/O debugging
#define DEBUG_DNS // Debug async DNS


#ifdef SOCKETERRORDEBUG
#define SOCKETERRORDEBUGPRINT(x) DEBUGPRINT(x)
#else
#define SOCKETERRORDEBUGPRINT(x) (void)0
#endif

#ifdef PRINTSOCKETFAILURE
#define SOCKETFAILURE(x) LOGPRINT(x)
#else
#define SOCKETFAILURE(x) DEBUGPRINT(x)
#endif

#if defined(PRINTSSLDEBUG)
#define SSLDEBUGPRINT(x) LOGPRINT(x)
#elif defined(SSLDEBUG)
#define SSLDEBUGPRINT(x) DEBUGPRINT(x)
#else
#define SSLDEBUGPRINT(x) (void)0
#endif

//Default to posix-style unblocking
#if !defined(UNBLOCK_IOCTL) && !defined(UNBLOCK_NDELAY) && !defined(UNBLOCK_POSIX)
#define UNBLOCK_POSIX
#endif

#ifdef DEBUG_DNS
#define DNS_PRINT(x) DEBUGPRINT("DNS Lookup: " << x)
#else
#define DNS_PRINT(x) (void)0
#endif


//ADDME: Introduce Namespace::Enum for socket errors and states (avoid  common errors eg. confusion between SClosed and Closed)

namespace Blex
{

namespace
{

struct SocketData
{
        std::vector<std::string> socketbinders;
};
typedef Blex::InterlockedData<SocketData, Blex::Mutex > LockedSockedData;
LockedSockedData socketdata;

void GetSocketName(SocketAddress *store, int32_t sock)
{
        memset(&store->addr,0,sizeof(store->addr));
        socklen_t len=sizeof(store->addr);
        getsockname (sock,(sockaddr*)&store->addr,&len);
}

SocketError::Errors ConvertSocketError(int errorcode)
{
        switch(errorcode)
        {
        case 0:
                return SocketError::NoError;
        case ECONNREFUSED:
                return SocketError::Refused;
        case EINPROGRESS:
        case EAGAIN:
                return SocketError::WouldBlock;
        case EALREADY:
                return SocketError::AlreadyInProgress;
        case EISCONN:
                return SocketError::AlreadyConnected;
        case EADDRINUSE:
                return SocketError::InUse;
        case EMSGSIZE:
                return SocketError::TooBig;
        case EPIPE:
                return SocketError::AlreadyDisconnected;
        case ECONNRESET:
                return SocketError::ConnectionReset;
        case EAFNOSUPPORT:
                return SocketError::AddressFamilyNotSupported;
        case EADDRNOTAVAIL:
                return SocketError::AddressNotAvailable;
        case EACCES:
                return SocketError::AccessDenied;
        case ETIMEDOUT:
                return SocketError::Timeout;
        default:
                DEBUGPRINT("Cannot convert socket error " << errorcode);
                return SocketError::UnknownError;
        }
}

SocketError::Errors GetLastSocketError()
{
        int errorcode = errno;
        SocketError::Errors translated = ConvertSocketError(errorcode);
        SOCKETERRORDEBUGPRINT("Last OS socket errorcode: " << errorcode << " translates to " << translated << " (" << SocketError::GetErrorText(translated) << ")");
        return translated;
}

/*
 * Copyright (c) 2004 by Internet Systems Consortium, Inc. ("ISC")
 * Copyright (c) 1996-1999 by Internet Software Consortium.
 *
 * Permission to use, copy, modify, and distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND ISC DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS.  IN NO EVENT SHALL ISC BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT
 * OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

/*%
 * WARNING: Don't even consider trying to compile this on a system where
 * sizeof(int) < 4.  sizeof(int) > 4 is fine; all the world's not a VAX.
 */

#define NS_INT16SZ 2
#define NS_IN6ADDRSZ 16
#define NS_INADDRSZ 4

static const char *Myinet_ntop4(const u_char *src, char *dst, socklen_t size);
static const char *Myinet_ntop6(const u_char *src, char *dst, socklen_t size);

/* char *
 * inet_ntop(af, src, dst, size)
 *      convert a network format address to presentation format.
 * return:
 *      pointer to presentation format address (`dst'), or NULL (see errno).
 * author:
 *      Paul Vixie, 1996.
 */
const char *Myinet_ntop(int af, const void * src, char * dst, socklen_t size)
{
        switch (af) {
        case AF_INET:
                return (Myinet_ntop4((uint8_t const*)src, dst, size));
        case AF_INET6:
                return (Myinet_ntop6((uint8_t const*)src, dst, size));
        default:
                return (NULL);
        }
        /* NOTREACHED */
}

/* const char *
 * inet_ntop4(src, dst, size)
 *      format an IPv4 address
 * return:
 *      `dst' (as a const)
 * notes:
 *      (1) uses no statics
 *      (2) takes a u_char* not an in_addr as input
 * author:
 *      Paul Vixie, 1996.
 */
static const char *Myinet_ntop4(const uint8_t *src, char *dst, socklen_t size)
{
        static const char fmt[] = "%u.%u.%u.%u";
        char tmp[sizeof "255.255.255.255"];
        int l;

        l = snprintf(tmp, sizeof(tmp), fmt, src[0], src[1], src[2], src[3]);
        if (l <= 0 || (socklen_t) l >= size) {
                errno = ENOSPC;
                return (NULL);
        }
        strncpy(dst, tmp, size);
        dst[size-1]=0;
        return (dst);
}

/* const char *
 * inet_ntop6(src, dst, size)
 *      convert IPv6 binary address into presentation (printable) format
 * author:
 *      Paul Vixie, 1996.
 */
static const char *
Myinet_ntop6(const uint8_t *src, char *dst, socklen_t size)
{
        /*
         * Note that int32_t and int16_t need only be "at least" large enough
         * to contain a value of the specified size.  On some systems, like
         * Crays, there is no such thing as an integer variable with 16 bits.
         * Keep this in mind if you think this function should have been coded
         * to use pointer overlays.  All the world's not a VAX.
         */
        char tmp[sizeof "ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255"], *tp;
        struct { int base, len; } best, cur;
        u_int words[NS_IN6ADDRSZ / NS_INT16SZ];
        int i;

        /*
         * Preprocess:
         *      Copy the input (bytewise) array into a wordwise array.
         *      Find the longest run of 0x00's in src[] for :: shorthanding.
         */
        memset(words, '\0', sizeof words);
        for (i = 0; i < NS_IN6ADDRSZ; i++)
                words[i / 2] |= (src[i] << ((1 - (i % 2)) << 3));
        best.base = -1;
        best.len = 0;
        cur.base = -1;
        cur.len = 0;
        for (i = 0; i < (NS_IN6ADDRSZ / NS_INT16SZ); i++) {
                if (words[i] == 0) {
                        if (cur.base == -1)
                                cur.base = i, cur.len = 1;
                        else
                                cur.len++;
                } else {
                        if (cur.base != -1) {
                                if (best.base == -1 || cur.len > best.len)
                                        best = cur;
                                cur.base = -1;
                        }
                }
        }
        if (cur.base != -1) {
                if (best.base == -1 || cur.len > best.len)
                        best = cur;
        }
        if (best.base != -1 && best.len < 2)
                best.base = -1;

        /*
         * Format the result.
         */
        tp = tmp;
        for (i = 0; i < (NS_IN6ADDRSZ / NS_INT16SZ); i++) {
                /* Are we inside the best run of 0x00's? */
                if (best.base != -1 && i >= best.base &&
                    i < (best.base + best.len)) {
                        if (i == best.base)
                                *tp++ = ':';
                        continue;
                }
                /* Are we following an initial run of 0x00s or any real hex? */
                if (i != 0)
                        *tp++ = ':';
                /* Is this address an encapsulated IPv4? */
                if (i == 6 && best.base == 0 && (best.len == 6 ||
                    (best.len == 7 && words[7] != 0x0001) ||
                    (best.len == 5 && words[5] == 0xffff))) {
                        if (!Myinet_ntop4(src+12, tp, sizeof tmp - (tp - tmp)))
                                return (NULL);
                        tp += strlen(tp);
                        break;
                }
                tp += sprintf(tp, "%x", words[i]);
        }
        /* Was it a trailing run of 0x00's? */
        if (best.base != -1 && (best.base + best.len) ==
            (NS_IN6ADDRSZ / NS_INT16SZ))
                *tp++ = ':';
        *tp++ = '\0';

        /*
         * Check for overflow, copy, and we're done.
         */
        if ((socklen_t)(tp - tmp) > size) {
                errno = ENOSPC;
                return (NULL);
        }
        strcpy(dst, tmp);
        return (dst);
}

/*%
 * WARNING: Don't even consider trying to compile this on a system where
 * sizeof(int) < 4.  sizeof(int) > 4 is fine; all the world's not a VAX.
 */

static int      Myinet_pton4(const char *src, u_char *dst);
static int      Myinet_pton6(const char *src, u_char *dst);

/* int
 * inet_pton(af, src, dst)
 *      convert from presentation format (which usually means ASCII printable)
 *      to network format (which is usually some kind of binary format).
 * return:
 *      1 if the address was valid for the specified address family
 *      0 if the address wasn't valid (`dst' is untouched in this case)
 *      -1 if some other error occurred (`dst' is untouched in this case, too)
 * author:
 *      Paul Vixie, 1996.
 */
int
Myinet_pton(int af, const char * src, void * dst)
{
        switch (af) {
        case AF_INET:
                return (Myinet_pton4(src, (uint8_t*)dst));
        case AF_INET6:
                return (Myinet_pton6(src, (uint8_t*)dst));
        default:
                return (-1);
        }
        /* NOTREACHED */
}

/* int
 * inet_pton4(src, dst)
 *      like inet_aton() but without all the hexadecimal and shorthand.
 * return:
 *      1 if `src' is a valid dotted quad, else 0.
 * notice:
 *      does not touch `dst' unless it's returning 1.
 * author:
 *      Paul Vixie, 1996.
 */
static int
Myinet_pton4(const char *src, u_char *dst)
{
        static const char digits[] = "0123456789";
        int saw_digit, octets, ch;
        uint8_t tmp[NS_INADDRSZ], *tp;

        saw_digit = 0;
        octets = 0;
        *(tp = tmp) = 0;
        while ((ch = *src++) != '\0') {
                const char *pch;

                if ((pch = strchr(digits, ch)) != NULL) {
                        u_int newi = *tp * 10 + (pch - digits);

                        if (newi > 255)
                                return (0);
                        *tp = newi;
                        if (!saw_digit) {
                                if (++octets > 4)
                                        return (0);
                                saw_digit = 1;
                        }
                } else if (ch == '.' && saw_digit) {
                        if (octets == 4)
                                return (0);
                        *++tp = 0;
                        saw_digit = 0;
                } else
                        return (0);
        }
        if (octets < 4)
                return (0);
        memcpy(dst, tmp, NS_INADDRSZ);
        return (1);
}

/* int
 * inet_pton6(src, dst)
 *      convert presentation level address to network order binary form.
 * return:
 *      1 if `src' is a valid [RFC1884 2.2] address, else 0.
 * notice:
 *      (1) does not touch `dst' unless it's returning 1.
 *      (2) :: in a full address is silently ignored.
 * credit:
 *      inspired by Mark Andrews.
 * author:
 *      Paul Vixie, 1996.
 */
static int
Myinet_pton6(const char *src, u_char *dst)
{
        static const char xdigits_l[] = "0123456789abcdef",
                          xdigits_u[] = "0123456789ABCDEF";
        u_char tmp[NS_IN6ADDRSZ], *tp, *endp, *colonp;
        const char *xdigits, *curtok;
        int ch, seen_xdigits;
        u_int val;

        memset((tp = tmp), '\0', NS_IN6ADDRSZ);
        endp = tp + NS_IN6ADDRSZ;
        colonp = NULL;
        /* Leading :: requires some special handling. */
        if (*src == ':')
                if (*++src != ':')
                        return (0);
        curtok = src;
        seen_xdigits = 0;
        val = 0;
        while ((ch = *src++) != '\0') {
                const char *pch;

                if ((pch = strchr((xdigits = xdigits_l), ch)) == NULL)
                        pch = strchr((xdigits = xdigits_u), ch);
                if (pch != NULL) {
                        val <<= 4;
                        val |= (pch - xdigits);
                        if (++seen_xdigits > 4)
                                return (0);
                        continue;
                }
                if (ch == ':') {
                        curtok = src;
                        if (!seen_xdigits) {
                                if (colonp)
                                        return (0);
                                colonp = tp;
                                continue;
                        } else if (*src == '\0') {
                                return (0);
                        }
                        if (tp + NS_INT16SZ > endp)
                                return (0);
                        *tp++ = (u_char) (val >> 8) & 0xff;
                        *tp++ = (u_char) val & 0xff;
                        seen_xdigits = 0;
                        val = 0;
                        continue;
                }
                if (ch == '.' && ((tp + NS_INADDRSZ) <= endp) &&
                    Myinet_pton4(curtok, tp) > 0) {
                        tp += NS_INADDRSZ;
                        seen_xdigits = 0;
                        break;  /*%< '\\' was seen by inet_pton4(). */
                }
                return (0);
        }
        if (seen_xdigits) {
                if (tp + NS_INT16SZ > endp)
                        return (0);
                *tp++ = (u_char) (val >> 8) & 0xff;
                *tp++ = (u_char) val & 0xff;
        }
        if (colonp != NULL) {
                /*
                 * Since some memmove()'s erroneously fail to handle
                 * overlapping regions, we'll do the shift by hand.
                 */
                const int n = tp - colonp;
                int i;

                if (tp == endp)
                        return (0);
                for (i = 1; i <= n; i++) {
                        endp[- i] = colonp[n - i];
                        colonp[n - i] = 0;
                }
                tp = endp;
        }
        if (tp != endp)
                return (0);
        memcpy(dst, tmp, NS_IN6ADDRSZ);
        return (1);
}


} //end anonymous namespace

SocketAddress::SocketAddress(std::string const &socketaddress)
{
        std::string::const_iterator port_expected_at;
        if(!socketaddress.empty() && socketaddress[0]=='[') //IPv6
        {
                std::string::const_iterator address_end = std::find(socketaddress.begin(),socketaddress.end(),']');
                if(address_end == socketaddress.end() || address_end == socketaddress.begin()+1)
                        throw std::invalid_argument("IPv6 address not properly enclosed in square brackets");
                if(std::find(socketaddress.begin()+1,address_end-1,':')==address_end-1 || !SetIPAddress(std::string(socketaddress.begin()+1, address_end)))
                        throw std::invalid_argument("Invalid IP address for SocketAddress");

                port_expected_at = address_end + 1;
        }
        else
        {
                port_expected_at = std::find(socketaddress.begin(),socketaddress.end(),':');
                if(!SetIPAddress(std::string(socketaddress.begin(), port_expected_at)))
                        throw std::invalid_argument("Invalid IP address for SocketAddress");
        }

        if(port_expected_at + 1 >= socketaddress.end() || port_expected_at[0]!=':')
                throw std::invalid_argument("Socket address does not contain a port number");

        std::pair<unsigned, std::string::const_iterator> port = Blex::DecodeUnsignedNumber<unsigned>(port_expected_at+1,socketaddress.end());
        if(port.second != socketaddress.end() || !SetPort(port.first))
                throw std::invalid_argument("Socket address does not ccontain a valid port number");
}

SocketAddress::SocketAddress(std::string const &ip, unsigned port)
{
        if(!SetIPAddress(ip))
                throw std::invalid_argument("Invalid IP address for SocketAddress");
        if(!SetPort(port))
                throw std::invalid_argument("Invalid port# for SocketAddress");
}

bool SocketAddress::Matches(SocketAddress const &rhs) const
{
        if(GetPort() != rhs.GetPort())
                return false;
        if(IsAnyAddress())
                return true;
        if(addr.ss_family != rhs.addr.ss_family)
                return false;
        if(addr.ss_family == AF_INET && GetIP4SockAddr().sin_addr.s_addr == INADDR_ANY)
                return true;
//        if(addr.ss_family == AF_INET6 && IN6_IS_ADDR_UNSPECIFIED(&GetIP6SockAddr().sin6_addr))
  //              return true;
        return IsSameIPAs(rhs);
}

SocketAddress SocketAddress::GetNetworkNumber(unsigned prefixlength) const
{
        Blex::SocketAddress copy(*this);
        if(copy.addr.ss_family == AF_INET)
        {
                unsigned netmask = prefixlength >= 32 ? 0xFFFFFFFF : ~(0xFFFFFFFF >> prefixlength);
                copy.GetIP4SockAddr().sin_addr.s_addr = htonl(ntohl(GetIP4SockAddr().sin_addr.s_addr) & netmask);
        }
        else if(copy.addr.ss_family == AF_INET6)
        {
                unsigned pos=0;
                while(pos < 16)
                {
                        if(prefixlength<8)
                        {
                                unsigned mask = ~(0xFF >> prefixlength);
                                copy.GetIP6SockAddr().sin6_addr.s6_addr[pos] &= mask;
                                prefixlength=0;
                        }
                        else
                        {
                                prefixlength-=8;

                        }
                        ++pos;
                }
        }
        return copy;
}

bool SocketAddress::IsInNetwork(SocketAddress const &rhs, unsigned prefixlength) const
{
        if(addr.ss_family != rhs.addr.ss_family) //different families never match
                return false;

        return GetNetworkNumber(prefixlength).IsSameIPAs(rhs);
}

bool SocketAddress::IsSameIPAs(SocketAddress const &rhs) const
{
        if(addr.ss_family==0)
                return rhs.addr.ss_family==0;
        if(addr.ss_family == AF_INET)
                return rhs.addr.ss_family == AF_INET && GetIP4SockAddr().sin_addr.s_addr == rhs.GetIP4SockAddr().sin_addr.s_addr;
        if(addr.ss_family == AF_INET6)
                return rhs.addr.ss_family == AF_INET6 && IN6_ARE_ADDR_EQUAL(&GetIP6SockAddr().sin6_addr, &rhs.GetIP6SockAddr().sin6_addr);
        return false;
}
/*
bool SocketAddress::MatchesWithPrefix(SocketAddress const &rhs, unsigned prefixlength) const
{
        if(lhs)
}*/
unsigned SocketAddress::GetPort() const
{
        if(addr.ss_family == AF_INET)
                return ntohs(GetIP4SockAddr().sin_port);
        if(addr.ss_family == AF_INET6)
                return ntohs(GetIP6SockAddr().sin6_port);
        return 0;
}
bool SocketAddress::SetPort(unsigned portnum)
{
        if(portnum>65535)
                return false;

        if(addr.ss_family == AF_INET)
                GetIP4SockAddr().sin_port = htons((uint16_t)portnum);
        else if(addr.ss_family == AF_INET6)
                GetIP6SockAddr().sin6_port = htons((uint16_t)portnum);
        else if (portnum != 0)
                return false; //set addres before port

        return true;
}

bool SocketAddress::IsIPV4AnyAddress() const
{
        return addr.ss_family == AF_INET && GetIP4SockAddr().sin_addr.s_addr == INADDR_ANY;
}
unsigned SocketAddress::GetLength() const
{
        return IsIPV6() ? sizeof(struct sockaddr_in6) : sizeof(struct sockaddr_in);
}

int socket_closeonexec(int domain, int type, int protocol)
{
#ifdef PLATFORM_LINUX
        return socket(domain, type | SOCK_CLOEXEC, protocol);
#else
        int socketfd = socket(domain, type, protocol);
        if(socketfd != -1)
                fcntl(socketfd, F_SETFD, 1);
        return socketfd;
#endif
}


namespace SocketUser //taken from our socket_user.c proof-of-concept (and soon to be example) code
{
  int send_the_socket(int fd_to_send, int receiving_unix_socket, int family, const char *address, int port)
  {
    struct msghdr msg = {0,0,0,0,0,0,0};
    struct cmsghdr *cmsg;
    struct iovec invec;
    std::vector<char> buf(CMSG_SPACE(sizeof (int)));
    char request[512];

    if(strlen(address)>255)
    {
      errno=EINVAL;
      return 0;
    }

    request[0]=1; //request a bind
    request[1]=family;
    request[2]=(unsigned char)(port>>8);
    request[3]=(unsigned char)(port&0xff);
    request[4]=strlen(address);
    strcpy(request+5,address);

    invec.iov_base = request;
    invec.iov_len = 5+strlen(address);
    msg.msg_iov = &invec;
    msg.msg_iovlen = 1;
    msg.msg_control = &buf[0];
    msg.msg_controllen = buf.size();
    cmsg = CMSG_FIRSTHDR(&msg);
    cmsg->cmsg_level = SOL_SOCKET;
    cmsg->cmsg_type = SCM_RIGHTS;
    cmsg->cmsg_len = CMSG_LEN(sizeof (int));
    *(int*)CMSG_DATA(cmsg) = fd_to_send;
    msg.msg_controllen = cmsg->cmsg_len;

    if (sendmsg(receiving_unix_socket, &msg, 0) != (ssize_t)invec.iov_len)
    {
      errno=EINVAL;
      return 0;
    }

    if(recv(receiving_unix_socket,&errno,sizeof(errno),0) != sizeof(errno))
      errno=EINVAL;

    return errno==0;
  }

  int connect_to_unix_socket (const char *path)
  {
    struct sockaddr_un addr;
    int socketfd;

    if (strlen(path) >= sizeof(addr.sun_path)-1)
      return -1;

    strcpy(addr.sun_path, path);
    addr.sun_family = AF_UNIX;

    /* connect to the socket */
    socketfd = socket_closeonexec(PF_UNIX, SOCK_STREAM, 0);
    if (socketfd == -1)
      return -1;

    if (connect(socketfd, (struct sockaddr*)&addr, strlen(addr.sun_path)+sizeof(addr.sun_family)+1)==-1)
    {
      close(socketfd);
      return -1;
    }

    return socketfd;
  }

bool TrySocketBinder(int sock, SocketAddress const &newlocaladdress)
{
        DEBUGPRINT("Trying the socketbinder");
        int unixfd = -1;
        {
                LockedSockedData::WriteRef lock(socketdata);
                for(unsigned i=0;i<lock->socketbinders.size() && unixfd == -1;++i)
                        unixfd = connect_to_unix_socket(lock->socketbinders[i].c_str());
        }
        if(unixfd==-1)
        {
                DEBUGPRINT("Socketbinder connection failed");
                return false; //it failed
        }

        //we have a connection. see if it can provide us with a bound socket
        int retval = send_the_socket(sock, unixfd, newlocaladdress.IsIPV6() ? 6 : 4, newlocaladdress.GetIPAddress().c_str(), newlocaladdress.GetPort());
        DEBUGPRINT("Socketbinder returned " << retval << " errno " << errno);
        close(unixfd);
        return retval != 0;
}

}//end namespace SocketUser

std::string SocketAddress::GetIPAddress() const
{
        Blex::SemiStaticPodVector< char, INET6_ADDRSTRLEN > buffer;
        AppendIPAddress(&buffer);
        return std::string(buffer.begin(), buffer.end());
}

void SocketAddress::AppendIPAddress(Blex::PodVector< char > *dest) const
{
        static const char anyaddress[] = "::";
        static const char ipv4anyaddress[] = "0.0.0.0";

        if(IsAnyAddress())
            dest->insert(dest->end(), anyaddress, anyaddress + sizeof(anyaddress) - 1);
        else if (IsIPV4AnyAddress())
            dest->insert(dest->end(), ipv4anyaddress, ipv4anyaddress + sizeof(ipv4anyaddress) - 1);
        else if(addr.ss_family == AF_INET6)
        {
                char buf[INET6_ADDRSTRLEN];
                if(Myinet_ntop(AF_INET6, &GetIP6SockAddr().sin6_addr, buf, sizeof(buf)))
                    dest->insert(dest->end(), buf, buf + strlen(buf));
        }
        else if(addr.ss_family == AF_INET)
        {
                char buf[INET_ADDRSTRLEN];
                if(Myinet_ntop(AF_INET, &GetIP4SockAddr().sin_addr, buf, sizeof(buf)))
                    dest->insert(dest->end(), buf, buf + strlen(buf));
        }
}

bool SocketAddress::SetIPAddress(std::string const &ip)
{
/*        if(ip.empty()) //accept empty string as any
        {
                addr.ss_family = 0;
                return true;
        }*/
        memset(&addr,0,sizeof(addr));

        bool is_ipv4_as_ipv6 = Blex::StrCaseLike(ip,"::ffff:*");

        //try to decode it as IPv6 first
        if(!is_ipv4_as_ipv6 && Myinet_pton(AF_INET6, ip.c_str(), &GetIP6SockAddr().sin6_addr) > 0)
        {
                addr.ss_family = AF_INET6;
                ((struct sockaddr_in6*)&addr)->sin6_port = 0; //mac needs this! not sure why, but port gets messed up ?
                SOCKETERRORDEBUGPRINT("SetIPAddress: " << ip << " is ipv6 and translated to " << *this);
                return true;
        }
        if(Myinet_pton(AF_INET, is_ipv4_as_ipv6 ? ip.c_str() + 7 : ip.c_str(), &GetIP4SockAddr().sin_addr) > 0)
        {
                addr.ss_family = AF_INET;
                ((struct sockaddr_in*)&addr)->sin_port = 0; //mac needs this! not sure why, but port gets messed up ?
                SOCKETERRORDEBUGPRINT("SetIPAddress: " << ip << " is ipv4 and translated to " << *this);
                return true;
        }
        SOCKETERRORDEBUGPRINT("SetIPAddress: " << ip << " was not recognized, our value is now " << *this);
        addr.ss_family=0;
        return false;
}

std::string SocketAddress::ToString() const
{
        std::string retval;
        if(IsIPV6())
                retval = '[' + GetIPAddress() + ']';
        else
                retval = GetIPAddress();
        retval += ':';
        retval += Blex::AnyToString(GetPort());
        return retval;
}

std::ostream& operator <<(std::ostream &str,SocketAddress const &rhs)
{
        return str << rhs.ToString();
}

namespace SocketError
{
const char *GetErrorText(SocketError::Errors whicherror)
{
        static const char *Errors[]=
           {"No error", //0
            "An unknown error occurred", //-1
            "The connection has been closed ", //-2
            "Socket was not connected", //-3
            "Socket tried to use an already bound address", //-4
            "Socket still has data left", //-5
            "Socket does not support messages this large", //-6
            "Destination host cannot be reached", //-7
            "The connection was refused", //-8
            "The operation timed out", //-9
            "Socket was already connected", //-10
            "Socket received an invalid command", //-11
            "The connection has already been disconnected", //-12
            "Socket operation would block", //-13
            "Socket operation already in progress", //-14
            "Socket must be set to non-blocking for this operation to succeed", //-15
            "Unable to resolve hostname", //-16
            "The connection has been reset", //-17
            "Address family not supported", //-18
            "Address not available", //-19
            "Access denied", //-20
        };
        static_assert( (sizeof(Errors) / sizeof(Errors[0])) == (0 - SocketErrorLimit), "SocketErrorLimit does not correspond with nr of errors");

        if (whicherror>SocketErrorLimit && whicherror<=NoError)
            return Errors[-whicherror];
        else
            return NULL;
}
} //end namespace SocketError

Socket::Socket(Protocols prot)
: Blex::Stream(false)
, sockstate(SClosed)
, protocol(prot)
, sock(-1)
//, sock(socket(AF_INET,prot==Stream ? SOCK_STREAM : SOCK_DGRAM,0)) //FIXME Prevent early allocation of socket for named pipes
, is_blocking(true)
{
//        if (sock == INVALID_SOCKET)
//            throw std::runtime_error("Cannot allocate new socket");
}

Socket::~Socket()
{
        if (sockstate != SClosed)
            Close();
}


//FIXME: Recycle the PipeWait thingies (perhaps delayed per socket alloc?) and let them keep their internal handles allocated!

//        Blex::DateTime maxwait=delay >= 0 ? Blex::DateTime::Now() + Blex::DateTime::Msecs(delay) : Blex::DateTime::Max();
std::pair<SocketError::Errors, int32_t> Socket::TimedSend(void const *data, unsigned numbytes, Blex::DateTime maxwait)
{
        //ADDME: If a command is queued on the trigger, handle that first to prevent starvation of aborts
        if(is_blocking)
            return std::make_pair(SocketError::SocketIsBlocking, 0); //TimedConnect requires a nonblocking socket

        unsigned totalbytessent = 0;
        while(numbytes>0)
        {
                int nowsent = Send(data, numbytes);
                if(nowsent <= 0 && nowsent != SocketError::WouldBlock) //socket error
                    return std::make_pair((SocketError::Errors)nowsent, totalbytessent);

                if(nowsent>0) //(partial) success
                {
                        data = static_cast<uint8_t const*>(data) + nowsent;
                        numbytes -= nowsent;
                        totalbytessent += nowsent;
                        if(numbytes==0)
                            break;
                }

                //Okay: then wait
                Blex::PipeWaiter waiter;
                waiter.AddSocket(*this, false, true);
                if (!waiter.Wait(maxwait))
                    return std::make_pair(SocketError::Timeout, totalbytessent);
        }
        return std::make_pair(SocketError::NoError, totalbytessent);
}

std::pair<SocketError::Errors, int32_t> Socket::TimedReceive(void *receivebuffer, unsigned maxreceivelen, Blex::DateTime maxwait)
{
        //ADDME: If a command is queued on the trigger, handle that first to prevent starvation of aborts
        if(is_blocking)
            return std::make_pair(SocketError::SocketIsBlocking, 0); //TimedConnect requires a nonblocking socket
        if(maxreceivelen==0)
            return std::make_pair(SocketError::InvalidArgument, 0); //Don't call me for 0 bytes!

        while(true)
        {
                int bytesread = Receive(receivebuffer, maxreceivelen);
                if(bytesread<=0 && bytesread != SocketError::WouldBlock)
                    return std::make_pair((SocketError::Errors)bytesread, 0);
                if(bytesread>0)
                    return std::make_pair(SocketError::NoError, bytesread);

                //Okay: then wait

                Blex::PipeWaiter waiter;
                SSLDEBUGPRINT("TimedReceive fd " << sock << " must wait. SSLneedswrite = " << SSLNeedsWrite());
                waiter.AddSocket(*this, true, false);
                if (!waiter.Wait(maxwait))
                    return std::make_pair(SocketError::Timeout, 0);
        }
}

SocketError::Errors Socket::RestoreSocket(bool ipv6)
{
        //Restore a socket to a usable state after a SClosed
        if(sockstate==SFree)
            return SocketError::NoError;
        if(sockstate!=SClosed)
            return SocketError::InvalidArgument;

        sock = socket_closeonexec(ipv6 ? AF_INET6 : AF_INET, protocol==Stream ? SOCK_STREAM : SOCK_DGRAM,0);
        if (sock == INVALID_SOCKET)
        {
                if(errno == EAFNOSUPPORT)
                        return SocketError::AddressFamilyNotSupported;
                throw std::runtime_error("Cannot restore socket for reuse");
        }

        SOCKETERRORDEBUGPRINT("<S:" << sock << "> created " << (ipv6?"ipv6":"ipv4") << " socket");

        sockstate = SFree;

        SocketError::Errors retval = SocketError::NoError;

        //Restore options
        if (!is_blocking)
            retval = InnerSetBlocking(false);

        if(retval == SocketError::NoError && !bindlocaladdress.IsAnyAddress())
            retval = Bind(bindlocaladdress);

        return retval;
}

SocketError::Errors Socket::TimedConnect(SocketAddress const &_remoteaddress, Blex::DateTime maxwait)
{
        if(is_blocking)
            return SocketError::SocketIsBlocking; //TimedConnect requires a nonblocking socket

        SocketError::Errors retval = SocketError::WouldBlock;
        if(sockstate != SConnecting)
        {
                retval = Connect(_remoteaddress);
                if (retval != SocketError::WouldBlock)
                    return retval;
        }

        while(retval==SocketError::WouldBlock)
        {
                //Okay: then wait
                Blex::PipeWaiter waiter;
                waiter.AddSocket(*this, false, true);
                if (!waiter.Wait(maxwait))
                    return SocketError::Timeout;

                int errorcode = 0;
                int errno_length = sizeof(errorcode);
                getsockopt(sock, SOL_SOCKET, SO_ERROR, (char *)&errorcode, (socklen_t*)&errno_length);
                retval = ConvertSocketError(errorcode);
        }

        if (retval == SocketError::NoError)
        {
                sockstate = SConnected;
                GetSocketName(&localaddress, sock);
        }
        else
        {
                Close();
        }
        return retval;
}

SocketError::Errors Socket::Bind(SocketAddress const &newlocaladdress)
{
        if (!newlocaladdress.IsIPV4() && !newlocaladdress.IsIPV6())
        {
                DEBUGPRINT("Bind: the specified address " << newlocaladdress << " is neither ipv4 nor ipv6");
                return SocketError::InvalidArgument;
        }
        if(sockstate == SClosed)
        {
                bindlocaladdress = SocketAddress();
                SocketError::Errors retval = RestoreSocket(newlocaladdress.IsIPV6());
                if(retval!=SocketError::NoError)
                    return retval;
        }
        if (sockstate != SFree)
            return SocketError::InvalidArgument;

        //We'll try to open the port
        bindlocaladdress = newlocaladdress;
        localaddress = newlocaladdress;

        //enable reuse address
        int i = 1;

        if (setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, (SETSOCKOPTCAST)&i, sizeof(int)) == -1)
        {
                DEBUGPRINT("Failed to enable reuse address");
                return SocketError::UnknownError;
        }

#ifdef IPV6_V6ONLY
        i=1;
        if (newlocaladdress.IsIPV6() && setsockopt(sock, IPPROTO_IPV6, IPV6_V6ONLY, &i, sizeof(int)) == -1)
        {
                DEBUGPRINT("Failed to enable IPV6_V6ONLY");
                return SocketError::UnknownError;
        }
#endif
        if (bind(sock, (struct sockaddr*)&localaddress.addr, localaddress.GetLength())==-1)
        {
                SocketError::Errors error = GetLastSocketError();
                if(error == SocketError::NoError) //huh?
                    error = SocketError::UnknownError;
                if( (error == SocketError::AccessDenied) && SocketUser::TrySocketBinder(sock, localaddress))
                    error = SocketError::NoError;
                if(error != SocketError::NoError)
                {
                        DEBUGPRINT("Lower level bind failed, passing on error");
                        return GetLastSocketError();
                }
        }
        GetSocketName(&localaddress, sock);
        return SocketError::NoError;
}

SocketError::Errors Socket::Listen(unsigned int backlog)
{
        if (sockstate != SFree || protocol != Stream || backlog == 0)
            return SocketError::InvalidArgument;

        if (listen(sock,backlog)!=0)
            return GetLastSocketError();

        sockstate = SListening;
        return SocketError::NoError;
}

SocketError::Errors Socket::SetBlocking(bool setblocking)
{
        if (sockstate == SClosed)
        {
                is_blocking = setblocking;
                return SocketError::NoError;
        }

        if (setblocking == is_blocking)
            return SocketError::NoError;

        SocketError::Errors retval = SocketError::NoError;
        if(!sslconn.get())
            retval = InnerSetBlocking(setblocking);

        if(retval==SocketError::NoError)
            is_blocking = setblocking;

        return retval;
}

SocketError::Errors Socket::InnerSetBlocking(bool setblocking)
{
#if defined(UNBLOCK_IOCTL)

        //SUN-style/Win32 style unblocking
        unsigned long on=setblocking ? 0 : 1;
        if (ioctlsocket(sock,FIONBIO,&on))
            return SocketError::UnknownError;
#else  //UNBLOCK_IOCTL
        int res;

        if ((res = fcntl(sock, F_GETFL, 0)) == -1)
            return SocketError::UnknownError;

#ifdef UNBLOCK_POSIX
        if (fcntl(sock, F_SETFL, (res & ~O_NONBLOCK) | (setblocking ? 0 : O_NONBLOCK)) == -1)
            return SocketError::UnknownError;
#elif defined(UNBLOCK_NDELAY)
        if (fcntl(sock, F_SETFL, (res & ~O_NDELAY) | (setblocking ? 0 : O_NDELAY)) == -1)
            return SocketError::UnknownError;
#else
#error Unsupported non-blocking mode
Unsupported_non_blocking_mode();
#endif

#endif //UNBLOCK_IOCTL
        return SocketError::NoError;
}

SocketError::Errors Socket::Connect(SocketAddress const &_remoteaddress)
{
        if (sockstate == SClosed)
        {
                SocketError::Errors retval = RestoreSocket(_remoteaddress.IsIPV6());
                if(retval!=SocketError::NoError)
                    return retval;
        }

        if (sockstate != SFree)
            return SocketError::InvalidArgument;

        //We'll try to open the port
        remoteaddress=_remoteaddress;

        if(connect(sock, (struct sockaddr*)&remoteaddress.addr, remoteaddress.GetLength()) == -1)
        {
                SocketError::Errors result = GetLastSocketError();
                if (result==SocketError::WouldBlock)
                {
                        sockstate=SConnecting;
                }
                else
                {
                        //socket reuse doesn't work on darwin, so recover it (ADDME a separate but externally invisible state 'recover me if reconnecting' ?P
                        Close();
                }
                return result;
        }

        sockstate = SConnected;
        GetSocketName(&localaddress, sock);
        return SocketError::NoError;
}

SocketError::Errors Socket::FinishNonBlockingConnect(bool cancel)
{
        if (sockstate != SConnecting)
            return SocketError::InvalidArgument;

        if (cancel)
        {
                Close();
                return SocketError::NoError;
        }

        int errorcode = 0;
        int errno_length = sizeof(errorcode);
        getsockopt(sock, SOL_SOCKET, SO_ERROR, (char *)&errorcode, (socklen_t*)&errno_length);
        SocketError::Errors result = ConvertSocketError(errorcode);

        if (result == SocketError::NoError)
        {
                sockstate = SConnected;
                GetSocketName(&localaddress, sock);
        }
        else if (result != SocketError::WouldBlock)
        {
                //socket reuse doesn't work on darwin, so recover it (ADDME a separate but externally invisible state 'recover me if reconnecting' ?P
                Close();
        }

        return result;
}

/*

              The socket is non-blocking and the  connection  cannot  be  com-
              pleted  immediately.  It is possible to select(2) or poll(2) for
              completion by selecting the socket  for  writing.  After  select
              indicates  writability,  use  getsockopt(2) to read the SO_ERROR
              option at level SOL_SOCKET to  determine  whether  connect  com-
              pleted   successfully   (SO_ERROR  is  zero)  or  unsuccessfully
              (SO_ERROR is one of the usual error codes listed here,  explain-
              ing the reason for the failure).
*/

SocketError::Errors Socket::SetNagle(bool enable)
{
        if (protocol!=Stream || (sockstate != SConnected && sockstate != SHungup))
            return SocketError::InvalidArgument;

        int val = !enable;
        if (setsockopt(sock, IPPROTO_TCP, TCP_NODELAY, (SETSOCKOPTCAST)&val, sizeof(val)) !=0)
            return SocketError::UnknownError;

        return SocketError::NoError;
}

SocketError::Errors Socket::SetSendBufferSize(uint32_t sendbuffersize)
{
        if (protocol != Stream)
            return SocketError::InvalidArgument;

        if (setsockopt(sock, SOL_SOCKET, SO_SNDBUF, (SETSOCKOPTCAST)&sendbuffersize, sizeof(sendbuffersize)) != 0)
            return GetLastSocketError();

        return SocketError::NoError;
}

SocketError::Errors Socket::GetSendBufferSize(uint32_t *newbuffersize)
{
        uint32_t newlen = 0;
        socklen_t optlen = 4;
        if (getsockopt(sock, SOL_SOCKET, SO_SNDBUF, (SETSOCKOPTCAST)&newlen, &optlen) !=0)
            return GetLastSocketError();
        *newbuffersize = newlen;

        return SocketError::NoError;
}

SocketError::Errors Socket::SetReceiveBufferSize(uint32_t receivebuffersize)
{
        if (protocol != Stream)
            return SocketError::InvalidArgument;
        if (setsockopt(sock, SOL_SOCKET, SO_RCVBUF, (SETSOCKOPTCAST)&receivebuffersize, sizeof(receivebuffersize)) !=0)
            return SocketError::UnknownError;

        return SocketError::NoError;
}

SocketError::Errors Socket::GetReceiveBufferSize(uint32_t *newbuffersize)
{
        socklen_t newlen = 0;
        socklen_t optlen = 4;
        if (getsockopt(sock, SOL_SOCKET, SO_RCVBUF, (SETSOCKOPTCAST)&newlen, &optlen) !=0)
            return SocketError::UnknownError;
        *newbuffersize = newlen;

        return SocketError::NoError;
}

SocketError::Errors Socket::Shutdown(bool sread, bool swrite)
{
        if (sockstate == SClosed || sock==INVALID_SOCKET)
            return SocketError::AlreadyDisconnected;

        if(sread||swrite)
        {
                if(shutdown(sock, sread && swrite ? SHUT_RDWR : sread ? SHUT_RD : SHUT_WR)!=0)
                    return SocketError::UnknownError;
        }
        return SocketError::NoError;

}

SocketError::Errors Socket::Close()
{
        if (sockstate == SClosed || sock==INVALID_SOCKET)
            return SocketError::AlreadyDisconnected;

        if (close(sock)!=0)
            return SocketError::UnknownError;

        InnerCloseSocket();
        return SocketError::NoError;
}

Socket::SocketFd Socket::ShutdownAndReleaseFd()
{
        if (sockstate == SClosed)
            return INVALID_SOCKET;

        shutdown(sock,SD_BOTH);

        int32_t retval = sock;
        InnerCloseSocket();
        return retval;
}

void Socket::InnerCloseSocket()
{
        sslconn.reset();
        sockstate = SClosed;
        sock = -1;
}

SocketError::Errors Socket::Accept(Socket *newsock) const //in seconds
{
        if (sockstate != SListening || !newsock)
            return SocketError::InvalidArgument;

        /* FIXME: Socket approach is WRONG. WE shouldn't be creating and destroying sockets for Accept-on-new sockets like we do now.
                  Don't call socket() in the constructor until we're sure we will not be accept()-ing on 'newsock' */
        if(newsock->sock != INVALID_SOCKET)
            close(newsock->sock);

        int len=sizeof(newsock->remoteaddress);
#ifdef PLATFORM_LINUX
        newsock->sock = accept4(sock,(struct sockaddr*)&newsock->remoteaddress, (socklen_t*)&len, SOCK_CLOEXEC);
#else
        newsock->sock = accept(sock,(struct sockaddr*)&newsock->remoteaddress, (socklen_t*)&len);
#endif
        if (newsock->sock==INVALID_SOCKET)
            return GetLastSocketError();

#ifndef PLATFORM_LINUX
        fcntl(newsock->sock, F_SETFD, 1);
#endif

        if(!newsock->is_blocking)
        {
                SocketError::Errors retval = newsock->InnerSetBlocking(false);
                if(retval < 0)
                {
                        newsock->Close();
                        return retval;
                }
        }
        newsock->sockstate = SConnected;
        GetSocketName(&newsock->localaddress, newsock->sock);
        return SocketError::NoError;
}

int Socket::SSLDoSomething()
{
        SSLDEBUGPRINT("SSLDoSomething enter");
        bool progress=false;

        //Can we feed outgoing data?
        if(sslconn->GetOutgoingDataLen()!=0)
        {
                int bytessent = RawSend(sslconn->GetOutgoingDataPtr(), sslconn->GetOutgoingDataLen());
                SSLDEBUGPRINT("SSLDoSomething: fd " << sock << " try to send " << sslconn->GetOutgoingDataLen() << " bytes of encrypted data. result = " << bytessent);
                if (bytessent > 0)
                {
                        //Handle send success!
                        sslconn->DiscardOutgoingBytes(bytessent);
                        progress=true;
                }
                if(bytessent < 0 && bytessent != SocketError::WouldBlock)
                {
                        SOCKETFAILURE("SSLDoSomething outgoing data failure. " << localaddress << " <=> " << remoteaddress << ": " << GetLastSSLErrors());
                        return bytessent;
                }
        }

        //Can we feed incoming data;
        if (sslconn->ssl_wants_read)
        {
                if (sslconn->feed_read_buffer_len < sizeof(sslconn->feed_read_buffer))
                {
                        int bytesread = RawReceive(sslconn->feed_read_buffer + sslconn->feed_read_buffer_len, sizeof(sslconn->feed_read_buffer) - sslconn->feed_read_buffer_len);
                        SSLDEBUGPRINT("SSLDoSomething: fd " << sock << " try to read " << sizeof(sslconn->feed_read_buffer) - sslconn->feed_read_buffer_len << " bytes. result = " << bytesread);
                        if (bytesread < 0 && bytesread != SocketError::WouldBlock)
                        {
                                SOCKETFAILURE("SSLDoSomething outgoing data failure. " << localaddress << " <=> " << remoteaddress << ": " << GetLastSSLErrors() << " existing bufferlen = " << sslconn->feed_read_buffer_len);
                                return bytesread;
                        }

                        if (bytesread > 0)
                        {
                                sslconn->ssl_wants_read=false;
                                sslconn->feed_read_buffer_len += bytesread;
                                SSLDEBUGPRINT("SSLDoSomething: fd " << sock << " received " << bytesread << " bytes of encrypted data. bufferlen = " << sslconn->feed_read_buffer_len);
                                progress=true;
                        }
                }
                else
                {
                        SOCKETFAILURE("SSLDoSomething outgoing data failure. " << localaddress << " <=> " << remoteaddress << ": it needs more data but our buffers are full");
                        return SocketError::UnknownError; //SSL
                }
        }
        if (sslconn->feed_read_buffer_len > 0)
        {
                int bytesprocessed = sslconn->FeedIncomingData(sslconn->feed_read_buffer,sslconn->feed_read_buffer_len);
                if (bytesprocessed>0)
                {
                        SSLDEBUGPRINT("SSLDoSomething: fd " << sock << " offered " << sslconn->feed_read_buffer_len << " bytes of unencrypted data. passed on " << bytesprocessed << ". still " << (sslconn->feed_read_buffer_len-bytesprocessed) << " in buffer");
                        sslconn->feed_read_buffer_len -= bytesprocessed;
                        if (sslconn->feed_read_buffer_len)
                            memmove(&sslconn->feed_read_buffer[0], &sslconn->feed_read_buffer[bytesprocessed], sslconn->feed_read_buffer_len);
                        progress=true;
                }
                if(bytesprocessed<0)
                {
                        SOCKETFAILURE("SSLDoSomething feedincomingdata failure. " << localaddress << " <=> " << remoteaddress << ": it " << GetLastSSLErrors());
                        return bytesprocessed;
                }
        }

        SSLDEBUGPRINT("SSLDoSomething: fd " << sock << " done. returning progress? " << (progress?1:0));
        return progress?1:0;
}

std::size_t Socket::Read(void *buf,std::size_t maxbufsize)
{
        int retval = Receive(buf, maxbufsize);
        lasterror = retval < 0 ? (SocketError::Errors)retval : SocketError::NoError;
        return retval > 0 ? retval : 0;
}
bool Socket::EndOfStream()
{
        return sockstate != SConnected;
}
std::size_t Socket::Write(void const *buf, std::size_t bufsize)
{
        int retval = Send(buf, bufsize);
        lasterror = retval < 0 ? (SocketError::Errors)retval : SocketError::NoError;
        return retval > 0 ? retval : 0;
}

int Socket::Send(void const *buf,unsigned buflen)
{
        SSLDEBUGPRINT("Socket::Send enter: fd " << sock << " write @ " << buf << " " << buflen << " bytes");

        if (!sslconn.get())
            return RawSend (buf, buflen);

        if (IsBlocking())
        {
                ErrStream() << "Socket::Send is not allowed for blocking SSL sockets";
                Blex::FatalAbort();
        }

        int totalbytesfed=0;
        while(buflen>0)
        {
                //How much will the SSL encryptor eat?
                int bytesfed = 0;
                if(!sslconn->MustWaitWithFeedOutgoingData()) //only feed BIO if its small, as it will never stop accepting data
                {
                        bytesfed = sslconn->FeedOutgoingData(buf, buflen);
                        SSLDEBUGPRINT("SocketSend: " << sock << " FeedOutgoingData: offered " << buflen << " result " << bytesfed);
                        if(bytesfed>0)
                        {
                                totalbytesfed += bytesfed;
                                buflen-=bytesfed;
                                buf = static_cast<uint8_t const*>(buf) + bytesfed;
                        }
                        if(bytesfed<0)
                        {
                                SOCKETFAILURE("Send failure. " << localaddress << " <=> " << remoteaddress << ": " << GetLastSSLErrors());
                                return SocketError::UnknownError; //error, consider everything dead?
                        }
                }
                else
                {
                        SSLDEBUGPRINT("SocketSend: " << sock << " FeedOutgoingData: not offering " << buflen << " bytes, too much outgoing data in bio");
                }

                //Will the SSL do something ?
                int somethingresult = SSLDoSomething();
                //Done?
                if (somethingresult<0)
                    return SocketError::UnknownError; //error!

                if (somethingresult==0 && bytesfed==0 && !is_blocking) //no forward progress
                    break;
        }

        SSLDEBUGPRINT("Socket::Send ssl exit, have sent " << totalbytesfed << " bytes");

        return totalbytesfed>0 ? totalbytesfed : SocketError::WouldBlock;
}

bool Socket::SSLHaveRead()
{
        if(!sslconn.get())
            return false;
        if(sslconn->GetIncomingDataLen()>0)
            return true;
        return !sslconn->PollIncomingData() /*handle the error*/ || sslconn->GetIncomingDataLen()>0;
}
bool Socket::SSLHaveWriteRoom()
{
        return sslconn.get() && !sslconn->MustWaitWithFeedOutgoingData();
}

int Socket::Receive(void *buf,unsigned buflen)
{
        SSLDEBUGPRINT("Socket::Receive enter: fd " << sock << " read @ " << buf << " " << buflen << " bytes");

        if (!sslconn.get())
            return RawReceive(buf, buflen);

        if (IsBlocking())
        {
                ErrStream() << "Socket::Receive is not allowed for blocking SSL sockets";
                Blex::FatalAbort();
        }

        while(true)
        {
                if (sslconn->GetIncomingDataLen()==0)
                  if (!sslconn->PollIncomingData())
                {
                        SOCKETFAILURE("SSL failure on PollIncomingData " << sock << " for " << localaddress << " <=> " << remoteaddress << ": " << sslconn->ssl_broken_error << " - " << GetLastSSLErrors());
                        return SocketError::UnknownError;
                }

                //If we have some(any?) data, we'll return that immediately
                if (sslconn->GetIncomingDataLen()>0)
                {
                        int bytesreceived = std::min(sslconn->GetIncomingDataLen(), buflen);
                        memcpy(buf, sslconn->GetIncomingDataPtr(), bytesreceived);

                        SSLDEBUGPRINT("Socket::Receive ssl exit, have " << bytesreceived << " decrypted bytes");

                        sslconn->DiscardIncomingBytes(bytesreceived);
                        return bytesreceived;
                }

                //Any outgoing data? If no, force a SSL read
                if(sslconn->GetOutgoingDataLen()==0 && !sslconn->ssl_wants_read)
                {
                        SSLDEBUGPRINT("Socket::Receive: fd " << sock << " Receive: outgoingdatalen=0, forcing ssl wants read");
                        sslconn->ssl_wants_read=true;
                }

                //Will the SSL do something ?
                int somethingresult = SSLDoSomething();
                //Done?
                if (somethingresult<0)
                {
                        SOCKETFAILURE("SSLReceive dosomething failed for " << localaddress << " <=> " << remoteaddress << ": " << GetLastSSLErrors());
                        return SocketError::UnknownError; //error!
                }
                if (!is_blocking && somethingresult==0 && sslconn->GetIncomingDataLen()==0) //still no data
                    return SocketError::WouldBlock; //no data
        }
}

int Socket::RawSend (void const *buf,unsigned buflen)
{
        if(sockstate != SConnected && sockstate != SHungup && !(sockstate==SFree && protocol==Datagram))
            return SocketError::Unconnected;

        int i;

        i=send(sock,reinterpret_cast<const char*>(buf),buflen,0);
        SSLDEBUGPRINT("Socket::RawSend: fd " << sock << " write @ " << buf << " " << buflen << " bytes, retval: " << i);

        if (i==SOCKET_ERROR)
            return GetLastSocketError();

        return i;
}

int Socket::SendDatagram(void const *buf,unsigned len,SocketAddress const &remoteaddress)
{
        int a;

        if (sockstate == SClosed || protocol != Datagram)
            return SocketError::InvalidArgument;

        a=sendto(sock,reinterpret_cast<char const*>(buf),len,0,(struct sockaddr*)&remoteaddress.addr,sizeof(remoteaddress.addr));

        if (a==SOCKET_ERROR)
            return GetLastSocketError();

        return len;
}

int Socket::RawReceive(void *buf, unsigned buflen)
{
        if(sockstate==SHungup)
            return SocketError::Closed;
        if(sockstate != SConnected && !(sockstate==SFree && protocol==Datagram))
            return SocketError::Unconnected;

        int a=recv(sock,reinterpret_cast<char*>(buf),buflen,0);
        SSLDEBUGPRINT("Socket::Rawreceive: fd " << sock << " read @ " << buf << " " << buflen << " bytes, retval: " << a);
        //LOGPRINT("Recv " << a << " errno " << errno);

        if (a==SOCKET_ERROR)
            return GetLastSocketError();
        else if (a == 0) //Can't find it in the manpages, but apparently Linux recv() returns 0 when the connection is closed.
        {
                sockstate = SHungup;
                return SocketError::Closed;
        }

        return a;
}


int Socket::ReceiveDatagram(void *buf,unsigned maxbuflen,SocketAddress *remoteaddress) const
{
        if ( sockstate == SClosed || protocol != Datagram)
            return SocketError::InvalidArgument;

        socklen_t len=sizeof(remoteaddress->addr);

        int a=recvfrom(sock,reinterpret_cast<char*>(buf),maxbuflen,0,(struct sockaddr*)&remoteaddress->addr,&len);

        if (a==SOCKET_ERROR)
            return GetLastSocketError();
        return a;
}

void Socket::SendSSLShutdown()
{
        if(!sslconn.get())
            return;

        SOCKETFAILURE("SSL connection shutting down on " << sock << " for " << localaddress << " <=> " << remoteaddress);
        sslconn->Shutdown();
        SSLDoSomething();
}

std::string Socket::GetSSLError() const
{
        return sslconn.get() ? sslconn->ssl_broken_error : std::string();
}

SocketError::Errors Socket::SetSecure(SSLContext *context)
{
        // Check socket state
        if (sockstate != Socket::SConnected || protocol != Stream)
            return SocketError::InvalidArgument;

        if (sslconn.get())
        {
                //ADDME: Do proper SSL_Shutdown
                sslconn.reset();
        }

        if(context)
        {
                SSLDEBUGPRINT("Establishing SSL connection on " << sock << ", hostname '" << sni_hostname << "'");

                sslconn.reset(new SSLConnection(*context));
                sslconn->SetRemoteHostname(sni_hostname);
                sslconn->DoEstablish();
                int errorcode = SSLDoSomething();
                if(errorcode<0)
                    return (SocketError::Errors)errorcode;

                SOCKETFAILURE("SSL connection established on " << sock << " for " << localaddress << " <=> " << remoteaddress);

                InnerSetBlocking(false); //because SSL can be busy without us being busy, we cannot keep blocking up
        }
        return SocketError::NoError;
}

void Socket::SetRemoteHostname(std::string const &remotehostname)
{
        sni_hostname = remotehostname;
}

bool Socket::GetPeerCertificateChain(std::string *dest)
{
        SSLDEBUGPRINT("Socket::GetPeerCertificateChain, have_ssl: " << bool(sslconn.get()));

        if (sslconn.get())
            return sslconn->GetPeerCertificateChain(dest);
        return true;
}

#define SOCKETPRINT(x) LOGPRINT("Socket " << debuggedsocket.GetFd() << ":" << x)

DebugSocket::DebugSocket(Socket::Protocols prot, DebuggingMode mode)
: Stream(false)
, debuggedsocket(prot)
, mode(mode)
{
        if (mode>=Calls)
            SOCKETPRINT("DebugSocket()");
}
DebugSocket::~DebugSocket()
{
        if (mode>=Errors && debuggedsocket.sockstate != Socket::SFree && debuggedsocket.sockstate !=Socket::SClosed)
        {
                SOCKETPRINT("Destroying socket that was not properly closed (from " << debuggedsocket.GetLocalAddress() << " to " << debuggedsocket.GetRemoteAddress() << ")");
        }

        if (mode>=Calls)
            SOCKETPRINT("~DebugSocket()");
}
SocketError::Errors DebugSocket::Bind(SocketAddress const &localaddress)
{
        if (mode>=Calls)
        {
                SOCKETPRINT("Bind " << localaddress);
        }

        SocketError::Errors retval=debuggedsocket.Bind(localaddress);

        if (mode>=Calls || (mode>=Errors && retval!=SocketError::NoError))
            SOCKETPRINT("Bind returned " << SocketError::GetErrorText(retval));

        return retval;
}
SocketError::Errors DebugSocket::Listen(unsigned int backlog)
{
        if (mode>=Calls)
            SOCKETPRINT("Listen backlog " << backlog);

        SocketError::Errors retval=debuggedsocket.Listen(backlog);

        if (mode>=Calls || (mode>=Errors && retval!=SocketError::NoError))
            SOCKETPRINT("Listen returned " << SocketError::GetErrorText(retval));

        return retval;
}
SocketError::Errors DebugSocket::SetSecure(SSLContext *context)
{
        if (mode>=Calls)
            SOCKETPRINT("SetSecure(" << (void*)context << ")");

        SocketError::Errors retval=debuggedsocket.SetSecure(context);

        if (mode>=Calls || (mode>=Errors && retval!=SocketError::NoError))
            SOCKETPRINT("SetSecure returned " << SocketError::GetErrorText(retval));

        return retval;
}
SocketError::Errors DebugSocket::SetBlocking(bool enable)
{
        if (mode>=Calls)
            SOCKETPRINT("SetBlocking(" << enable << ")");

        SocketError::Errors retval=debuggedsocket.SetBlocking(enable);

        if (mode>=Calls || (mode>=Errors && retval!=SocketError::NoError))
            SOCKETPRINT("SetBlocking returned " << SocketError::GetErrorText(retval));

        return retval;
}
SocketError::Errors DebugSocket::SetNagle(bool enable)
{
        if (mode>=Calls)
            SOCKETPRINT("SetNagle(" << enable << ")");

        SocketError::Errors retval=debuggedsocket.SetNagle(enable);

        if (mode>=Calls || (mode>=Errors && retval!=SocketError::NoError))
            SOCKETPRINT("SetNagle returned " << SocketError::GetErrorText(retval));

        return retval;
}
SocketError::Errors DebugSocket::SetSendBufferSize(uint32_t sendbuffersize)
{
        if (mode>=Calls)
            SOCKETPRINT("SetSendBufferSize(" << sendbuffersize << ")");

        SocketError::Errors retval=debuggedsocket.SetSendBufferSize(sendbuffersize);

        if (mode>=Calls || (mode>=Errors && retval!=SocketError::NoError))
            SOCKETPRINT("SetSendBufferSize returned " << SocketError::GetErrorText(retval));

        return retval;
}

SocketError::Errors DebugSocket::GetSendBufferSize(uint32_t *newbuffersize)
{
        if (mode>=Calls)
            SOCKETPRINT("GetSendBufferSize()");

        SocketError::Errors retval=debuggedsocket.GetSendBufferSize(newbuffersize);

        if (mode>=Calls || (mode>=Errors && retval!=SocketError::NoError))
            SOCKETPRINT("GetSendBufferSize returned " << SocketError::GetErrorText(retval) << " size: " << *newbuffersize);

        return retval;
}

SocketError::Errors DebugSocket::SetReceiveBufferSize(uint32_t receivebuffersize)
{
        if (mode>=Calls)
            SOCKETPRINT("SetReceiveBufferSize(" << receivebuffersize << ")");

        SocketError::Errors retval=debuggedsocket.SetReceiveBufferSize(receivebuffersize);

        if (mode>=Calls || (mode>=Errors && retval!=SocketError::NoError))
            SOCKETPRINT("SetReceiveBufferSize returned " << SocketError::GetErrorText(retval));

        return retval;
}

SocketError::Errors DebugSocket::GetReceiveBufferSize(uint32_t *newbuffersize)
{
        if (mode>=Calls)
            SOCKETPRINT("GetReceiveBufferSize()");

        SocketError::Errors retval=debuggedsocket.GetReceiveBufferSize(newbuffersize);

        if (mode>=Calls || (mode>=Errors && retval!=SocketError::NoError))
            SOCKETPRINT("GetReceiveBufferSize returned " << SocketError::GetErrorText(retval) << " size: " << *newbuffersize);

        return retval;
}
SocketError::Errors DebugSocket::Connect(SocketAddress const &remoteaddress)
{
        if (mode>=Calls)
            SOCKETPRINT("Connect " << remoteaddress << " currentstate " << debuggedsocket.sockstate);

        SocketError::Errors retval=debuggedsocket.Connect(remoteaddress);

        if (mode>=Calls || (mode>=Errors && retval!=SocketError::NoError))
        {
                SOCKETPRINT("Connect " << remoteaddress << " returned " << SocketError::GetErrorText(retval));
        }
        return retval;
}
SocketError::Errors DebugSocket::FinishNonBlockingConnect(bool cancel)
{
        if (mode>=Calls)
            SOCKETPRINT("FinishNonBlockingConnect currentstate " << debuggedsocket.sockstate);

        SocketError::Errors retval=debuggedsocket.FinishNonBlockingConnect(cancel);

        if (mode>=Calls || (mode>=Errors && retval!=SocketError::NoError))
        {
                SOCKETPRINT("FinishNonBlockingConnect returned " << SocketError::GetErrorText(retval));
        }
        return retval;
}
SocketError::Errors DebugSocket::TimedConnect(SocketAddress const &remoteaddress, Blex::DateTime maxwait)
{
        if (mode>=Calls)
            SOCKETPRINT("TimedConnect " << remoteaddress << " maxwait " << maxwait);

        SocketError::Errors retval = debuggedsocket.TimedConnect(remoteaddress, maxwait);

        if (mode>=Calls || (mode>=Errors && retval!=SocketError::NoError))
                SOCKETPRINT("TimedConnect returned " << SocketError::GetErrorText(retval));
        return retval;
}
int DebugSocket::ReceiveDatagram(void *buf,unsigned maxbuflen,SocketAddress *remoteaddress) const
{
        if (mode>=Calls)
            SOCKETPRINT("ReceiveDatagram into " << buf << " want " << maxbuflen << " bytes, address store" << remoteaddress);

        int retval=debuggedsocket.ReceiveDatagram(buf,maxbuflen,remoteaddress);

        if (retval>0 && mode>=All)
        {
                SOCKETPRINT("ReceiveDatagram received from " << *remoteaddress);
                DumpPacket(retval,buf);
        }

        if (mode>=Errors && retval<0)
            SOCKETPRINT("ReceiveDatagram returned " << retval << ": " << SocketError::GetErrorText((SocketError::Errors)retval));
        else if (mode>=Calls)
            SOCKETPRINT("ReceiveDatagram returned " <<retval);

        return retval;
}
std::size_t DebugSocket::Read(void *buf,std::size_t maxbufsize)
{
        int retval = Receive(buf, maxbufsize);
        debuggedsocket.lasterror = retval < 0 ? (SocketError::Errors)retval : SocketError::NoError;
        return retval > 0 ? retval : 0;
}
bool DebugSocket::EndOfStream()
{
        return debuggedsocket.EndOfStream();
}
std::size_t DebugSocket::Write(void const *buf, std::size_t bufsize)
{
        int retval = Send(buf, bufsize);
        debuggedsocket.lasterror = retval < 0 ? (SocketError::Errors)retval : SocketError::NoError;
        return retval > 0 ? retval : 0;
}
int DebugSocket::Receive(void *buf, unsigned buflen)
{
        if (mode>=Calls)
        {
            SOCKETPRINT("Receive into " << buf << " want " << buflen << " bytes");
        }

        int retval=debuggedsocket.Receive(buf,buflen);

        if (retval>0 && mode>=All)
            DumpPacket(retval,buf);

        if (mode>=Errors && retval<0)
            SOCKETPRINT("Receive returned " << SocketError::GetErrorText((SocketError::Errors)retval));
        else if (mode>=Calls)
            SOCKETPRINT("Receive returned " << retval);

        return retval;
}
std::pair<SocketError::Errors, int32_t> DebugSocket::TimedReceive(void *buf, unsigned buflen, Blex::DateTime maxwait)
{
        if (mode>=Calls)
        {
                SOCKETPRINT("TimedReceive into " << buf << " (want " << buflen << " bytes) maxwait " << maxwait);
        }
        std::pair<SocketError::Errors,int32_t> retval=debuggedsocket.TimedReceive(buf,buflen,maxwait);

        if (retval.second>0 && mode>=All)
            DumpPacket(retval.second,buf);

        if (mode>=Errors && retval.first<0)
            SOCKETPRINT("TimedReceive returned " << SocketError::GetErrorText(retval.first) << " (" << retval.second << " bytes received)");
        else if (mode >= Calls)
            SOCKETPRINT("TimedReceive returned " << retval.first << " (" << retval.second << " bytes received )");

        return retval;
}
int DebugSocket::SendDatagram(const void *buf,unsigned len,SocketAddress const &remoteaddress)
{
        if (mode>=Calls)
        {
                SOCKETPRINT("SendDatagram " << buf << " (" << len << " bytes) to " << remoteaddress);
        }

        if (mode>=All)
            DumpPacket(len,buf);

        int retval=debuggedsocket.SendDatagram(buf,len,remoteaddress);

        if (mode>=Errors && retval<0)
            SOCKETPRINT("SendDatagram returned " << SocketError::GetErrorText((SocketError::Errors)retval));
        else if (mode>=Calls)
            SOCKETPRINT("SendDatagram returned " << retval);

        return retval;
}

int DebugSocket::Send(const void  *buf,unsigned buflen)
{
        if (mode>=Calls)
        {
                SOCKETPRINT("Send " << buf << " (" << buflen << " bytes");
        }

        if (mode>=All)
            DumpPacket(buflen,buf);

        int retval=debuggedsocket.Send(buf,buflen);

        if (mode>=Errors && retval<0)
            SOCKETPRINT("Send returned " << SocketError::GetErrorText((SocketError::Errors)retval));
        else if (mode>=Calls)
            SOCKETPRINT("Send returned " << retval);

        return retval;
}
std::pair<SocketError::Errors, int32_t> DebugSocket::TimedSend(void const *buf, unsigned buflen, Blex::DateTime maxwait)
{
        if (mode>=Calls)
            SOCKETPRINT("TimedSend " << buf << " (" << buflen << " bytes) maxwait " << maxwait);

        if (mode>=All)
            DumpPacket(buflen,buf);

        std::pair<SocketError::Errors,int32_t> retval=debuggedsocket.TimedSend(buf,buflen,maxwait);
        if (mode>=Errors && retval.first<0)
            SOCKETPRINT("TimedSend returned " << SocketError::GetErrorText(retval.first) << " (" << retval.second << " bytes sent)");
        else if (mode >= Calls)
            SOCKETPRINT("TimedSend returned " << retval.first << " (" << retval.second << " bytes sent)");

        return retval;
}
SocketError::Errors DebugSocket::Accept(Socket *accepton) const
{
        if (mode>=Calls)
            SOCKETPRINT("Accept");

        SocketError::Errors retval=debuggedsocket.Accept(accepton);

        if (mode>=Errors && retval!=SocketError::NoError)
            SOCKETPRINT("Accept returned " << SocketError::GetErrorText(retval));
        else if (mode>=Calls)
            SOCKETPRINT("Accept returned. New connection FD is " << accepton->GetFd() << " local " << accepton->GetLocalAddress() << " remote " << accepton->GetRemoteAddress());

        return retval;
}

void DebugSocket::SendSSLShutdown()
{
        debuggedsocket.SendSSLShutdown();
}

SocketError::Errors DebugSocket::Shutdown(bool sread, bool swrite)
{
        if (mode>=Calls)
            SOCKETPRINT("Shutdown " << (sread?"read":"") << (swrite?"write":""));

        SocketError::Errors retval=debuggedsocket.Shutdown(sread, swrite);

        if (mode>=Calls || (mode>=Errors && retval!=SocketError::NoError))
        {
                SOCKETPRINT("Shutdown returned " << SocketError::GetErrorText(retval));
        }

        return retval;
}

SocketError::Errors DebugSocket::Close()
{
        if (mode>=Calls)
            SOCKETPRINT("Close");

        SocketError::Errors retval=debuggedsocket.Close();

        if (mode>=Calls || (mode>=Errors && retval!=SocketError::NoError))
        {
                SOCKETPRINT("Close returned " << SocketError::GetErrorText(retval));
        }

        return retval;
}

Socket::SocketFd DebugSocket::ShutdownAndReleaseFd()
{
        if (mode>=Calls)
            SOCKETPRINT("ShutdownAndReleaseFd");

        Socket::SocketFd retval=debuggedsocket.ShutdownAndReleaseFd();

        if (mode>=Errors && retval==INVALID_SOCKET)
        {
                SOCKETPRINT("ReleaseFD returned INVALID_SOCKET");
        }
        else if (mode>=Calls)
        {
                SOCKETPRINT("ReleaseFD returned " << retval);
        }

        return retval;
}

void DebugSocket::DumpPacket(unsigned len,void  const *buf) const
{
        for (unsigned i=0;i<len;i+=16)
        {
                std::string line;
                for (unsigned j=0;j<16;++j)
                {
                        uint8_t inbyte = static_cast<const uint8_t*>(buf)[i+j];
                        if (i+j<len)
                        {
                                Blex::EncodeBase16(&inbyte, &inbyte+1, std::back_inserter(line));
                                line+=' ';
                        }
                        else
                            line += "   ";

                        if (j==7)
                            line += "  ";
                }
                line += " ";

                for (unsigned j=0;j<16;++j)
                {
                        if (i+j<len)
                            line += char( static_cast<const uint8_t*>(buf)[i+j]>=32 && static_cast<const uint8_t*>(buf)[i+j]<=127 ? static_cast<const uint8_t*>(buf)[i+j] : '.');
                        if (j==7)
                            line += "  ";
                }
                SOCKETPRINT(line);
            }
}

///////////////////////////////////////////////////////////////////////////////
//
// Socket sets
//

bool TryConnectSockets(Socket &lhs, Socket &rhs, bool ipv6)
{
        if (lhs.GetProtocol()!=rhs.GetProtocol() || lhs.GetProtocol()==Socket::Datagram)
           return false;

        //DebugSocket listener(Socket::Stream, DebugSocket::All);
        Socket listener(Socket::Stream);

        //Bind the listener to a port so that we can establish a connection
        if (listener.Bind(SocketAddress(ipv6 ? "::1" : "127.0.0.1",0)) != SocketError::NoError || listener.Listen(1) != SocketError::NoError)
            return false;

        //Connect the left side to the listener
        if (lhs.Connect(listener.GetLocalAddress()) != SocketError::NoError)
            return false;

        //Accept the connection on the right side
        if (listener.Accept(&rhs) != SocketError::NoError)
            return false;

        return lhs.GetLocalAddress() == rhs.GetRemoteAddress()
               && lhs.GetRemoteAddress() == rhs.GetLocalAddress();
}

SocketSet::SocketSet(Socket::Protocols protocol, bool ipv6)
{
        for(unsigned tries=0; tries<10; ++tries)
        {
                leftend.reset(new Socket(protocol));
                rightend.reset(new Socket(protocol));
                //ADDME recreation for every attempt is probably unneeded
                if(TryConnectSockets(*leftend, *rightend, ipv6))
                    return;
        }
        throw std::runtime_error("Failed to establish a socket set");
}

SocketSet::~SocketSet()
{
}

void AddResolvedIPsToList(addrinfo *aresult, std::vector<SocketAddress> *results)
{
        // Add all addresses
        for (addrinfo *current = aresult; current != 0; current = current->ai_next)
        {
                if (current->ai_addr->sa_family == AF_INET || current->ai_addr->sa_family == AF_INET6)
                {
                        SocketAddress newaddr;
                        memcpy(&newaddr.addr, current->ai_addr, current->ai_addrlen);

                        if(std::find(results->begin(), results->end(), newaddr) == results->end()) //not yet in the list
                            results->push_back(newaddr);
                }
        }
}

namespace
{
#ifdef PLATFORM_LINUX_DISABLED
/** Pending DNS request. Kept in a shared_ptr to ensure existance while processing the request.
    Cleanup of resources is done by this class
*/
class DNSRequest
{
    public:
        /// Initialize for a single request
        DNSRequest(std::string const &_hostname);
        ~DNSRequest();

        /// Hostname for which the request is done
        std::string hostname;

        /// Request addrinfo (icb.ar_request points to this structure)
        addrinfo hints;

        /// Request structure
        gaicb icb;

        /// Returns whether the request is still pending
        bool is_pending() { return gai_error(&icb) == EAI_INPROGRESS; }

        /// Returns whether the requst was finished with success (so the icb.ar_result contains the result)
        bool is_success() { return gai_error(&icb) == 0; }
};

///
DNSRequest::DNSRequest(std::string const &_hostname)
: hostname(_hostname)
{
        memset(&hints, 0, sizeof(hints));
        memset(&icb, 0, sizeof(icb));
        icb.ar_name = hostname.c_str();
        icb.ar_service = nullptr;
        icb.ar_request = &hints;
        icb.ar_result = nullptr;
}

DNSRequest::~DNSRequest()
{
        if (icb.ar_result)
        {
                if (!is_pending())
                    freeaddrinfo(icb.ar_result);
                else
                    DNS_PRINT("Leaking pending DNS request for '" << hostname << "'");
        }
}

struct DNSPendingRequests
{
        std::list< std::shared_ptr< DNSRequest > > requests;
};

typedef Blex::InterlockedData<DNSPendingRequests, Blex::Mutex > LockedDNSPendingRequests;

/// List of currently pending requests
LockedDNSPendingRequests pendingrequests;

/** Add a new pending request. Must be done before calling getaddrinfo_a
    @param to_add Request to be scheduled. Must be the only request scheduled, with sigev_value equal to &to_add->icb
*/
void AddRequest(std::shared_ptr< DNSRequest > const &to_add)
{
        DNS_PRINT("Adding pending request for " << to_add->hostname << ", code " << &to_add->icb);
        LockedDNSPendingRequests::WriteRef lock(pendingrequests);
        lock->requests.insert(lock->requests.end(), to_add);
}

/** Signal callback, to be passed to getaddrinfo_a (mode SIGEV_THREAD). Removes references to finished requests
*/
void RemoveHandledRequests(sigval_t sigev_value)
{
        DNS_PRINT("Got finish call, code " << sigev_value.sival_ptr);
        LockedDNSPendingRequests::WriteRef lock(pendingrequests);

        for (auto itr = lock->requests.begin(); itr != lock->requests.end(); ++itr)
            if (sigev_value.sival_ptr == &(*itr)->icb)
            {
                    DNS_PRINT(" done: request for " << (*itr)->hostname << ", success: " << (*itr)->is_success());
                    lock->requests.erase(itr);
                    break;
            }
}

#endif
}

void ResolveHostnameAllIPs(std::string const &hostname, std::vector<SocketAddress> *results)
{
        results->clear();

#ifdef PLATFORM_LINUX_DISABLED

        // Create the request info
        std::shared_ptr< DNSRequest > req(new DNSRequest(hostname));
        req->hints.ai_flags |= AI_ADDRCONFIG; //make sure we get IP addresses that are accessible

        // List of requests to do (only one)
        gaicb* list = &req->icb;

        // No signalling, we'll just suspend
        sigevent sevp;
        memset(&sevp, 0, sizeof(sevp));
        sevp.sigev_notify = SIGEV_THREAD;
        sevp.sigev_notify_function = &RemoveHandledRequests;
        sevp.sigev_value.sival_ptr = &req->icb;

        // Start async request, for addrinfo with all inet addresses

        AddRequest(req);

        int error = getaddrinfo_a(GAI_NOWAIT, &list, 1, &sevp);
        DNS_PRINT("getaddrinfo_a " << hostname << " result " << error);
        if (error != 0)
        {
                // Failure. Try to cancel, if that isn't possible we'll just wait
                DNS_PRINT(" failure, cancelling");
                gai_cancel(&req->icb);
                return;
        }

        // 15 seconds timeout
        timespec timeout;
        timeout.tv_sec = 15;
        timeout.tv_nsec = 0;

        // Wait until the timeout, or done, or a signal
        gai_suspend(&list, 1, &timeout);
        DNS_PRINT("gai_suspend " << hostname << " suspend done, pending " << (req->is_pending()?1:0) << " success " << (req->is_success()?1:0));

        // Just check the request if it's done
        if (req->is_pending())
        {
                DNS_PRINT(" still pending, cancelling");
                gai_cancel(&req->icb);
                return;
        }
        else if (!req->is_success())
        {
                DNS_PRINT(" returned error");
                return; // request has finished, no cancel needed anymore
        }

        DNS_PRINT(" got ips, returning them");

        // Result is returned in icb.ar_result, extract the IPs
        AddResolvedIPsToList(req->icb.ar_result, results);
#else
        addrinfo *aresult = 0;
        addrinfo hints;

        memset(&hints, 0, sizeof(hints));
        hints.ai_flags |= AI_ADDRCONFIG; //make sure we get IP addresses that are accessible

        // Get addrinfo with all inet addresses
        int error = getaddrinfo(hostname.c_str(), NULL, &hints, &aresult);
        if (error != 0)
            return;

        // Result is returned in icb.ar_result, extract the IPs
        AddResolvedIPsToList(aresult, results);

        freeaddrinfo(aresult);

#endif
}

/** Resolve a hostname address to an IP adress. Returns AnyAddress if resolving failed
*/
SocketAddress ResolveHostname(std::string const &hostname)
{
        std::vector<SocketAddress> allresults;
        ResolveHostnameAllIPs(hostname, &allresults);
        if(allresults.empty())
                return SocketAddress();
        else
                return allresults[0];
}

/** Resolve an IP address to a hostname. Returns an empty string if resolving failed*/
std::string ResolveIPAddress(SocketAddress const &ipaddress)
{
        char hbuf[NI_MAXHOST], sbuf[NI_MAXSERV];

        if (getnameinfo((struct sockaddr *)&ipaddress.addr, sizeof ipaddress.addr, hbuf, sizeof(hbuf), sbuf, sizeof(sbuf), NI_NAMEREQD))
        {
                return "";
        }
        return hbuf;
}

/** Returns the list of local IP addresses*/
void GetLocalIPs(std::vector<SocketAddress> *results)
{
        results->clear();

        ifaddrs *addrs;
        int res = getifaddrs(&addrs);
        if (res == 0)
        {
                for (ifaddrs *it = addrs; it; it = it->ifa_next)
                {
                        if (!it->ifa_addr)
                            continue;

                        if (!(it->ifa_flags & IFF_UP))
                            continue;

                        if (it->ifa_addr->sa_family == AF_INET)
                        {
                              SocketAddress addr;
                              addr.addr.ss_family = AF_INET;
                              addr.GetIP4SockAddr() = *(struct sockaddr_in *)(it->ifa_addr);
                              results->push_back(addr);
                        }
                        else if (it->ifa_addr->sa_family == AF_INET6)
                        {
                              SocketAddress addr;
                              addr.addr.ss_family = AF_INET6;
                              addr.GetIP6SockAddr() = *(struct sockaddr_in6 *)(it->ifa_addr);
                              results->push_back(addr);
                        }
                }
        }

        freeifaddrs(addrs);
        //erase duplicates
        for (unsigned i=0;i<results->size();++i)
                for (unsigned j=results->size()-1; j > i; --j)
                        if( (*results)[i] == (*results)[j] )
                                results->erase(results->begin()+j);
}


std::string GetSystemHostName(bool completehostname)
{
        std::string result;

        char buf[1024];
        if (gethostname(buf, sizeof(buf)-1)==0)
        {
                buf[1023]=0;
                result=buf;
                //FIXME: Any suggestions on how to do this on win32?
                //No dot yet? Try to complete the hostname
                if (completehostname && std::find(result.begin(),result.end(),'.')==result.end())
                {
                        struct addrinfo hints, *info, *p;

                        memset(&hints, 0, sizeof hints);
                        hints.ai_family = AF_UNSPEC; //either IPV4 or IPV6
                        hints.ai_socktype = SOCK_STREAM;
                        hints.ai_flags = AI_CANONNAME;

                        int gai_result = getaddrinfo(buf, "http", &hints, &info);
                        if(gai_result==0)
                        {
                                for(p = info; p != NULL; p = p->ai_next)
                                {
                                        if(p->ai_canonname && strchr(p->ai_canonname,'.') != NULL) //contains a dot
                                        {
                                                return p->ai_canonname;
                                        }
                                }
                        }
                }
        }
        return result;
}

void AddSocketBinderPath(std::string const &socketbinder)
{
        LockedSockedData::WriteRef lock(socketdata);
        if(std::find(lock->socketbinders.begin(), lock->socketbinders.end(), socketbinder) == lock->socketbinders.end())
                lock->socketbinders.push_back(socketbinder);
}

} //namespace Blex
