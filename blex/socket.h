#ifndef blex_socket
#define blex_socket

#ifndef blex_stream
#include "stream.h"
#endif
#ifndef blex_datetime
#include "datetime.h"
#endif
#ifndef blex_podvector
#include "podvector.h"
#endif
#ifndef blex_mime
#include "mime.h"
#endif
#ifndef blex_crypto
#include "crypto.h"
#endif

#include <sys/socket.h>
#include <netinet/in.h>

namespace Blex
{

class Socket;
class DebugSocket;

//IPAddress const AnyIPAddress = 0;
//IPAddress const NoIPAddress = 0xFFFFFFFF;
//IPAddress const LocalHost = 0x7F000001;

namespace SocketError
{
        ///Error codes from socket functions
        enum Errors
        {
                ///nothing went wrong
                NoError=0,
                ///a not (yet) supported error
                UnknownError=-1,
                ///the socket/connection has been gracefully closed
                Closed=-2,
                ///there was no connection
                Unconnected=-3,
                ///address already in use
                InUse=-4,
                ///there is still data left to be sent
                DataLeft=-5,
                ///message too big for underlying protocol
                TooBig=-6,
                ///destination unreachable
                Unreachable=-7,
                ///connection refused
                Refused=-8,
                ///a time limited call timed out
                Timeout=-9,
                ///the socket was already connected
                AlreadyConnected=-10,
                ///invalid argument, or invalid action for this socket state/type
                InvalidArgument=-11,
                ///the socket/connection has already been disconnected
                AlreadyDisconnected=-12,
                ///The call would block
                WouldBlock=-13,
                ///Connecting is already in progress
                AlreadyInProgress=-14,
                ///Tis operation requires a nonblocking socket
                SocketIsBlocking=-15,
                ///Unable to resolve hostname
                UnableToResolveHostname=-16,
                ///The connection has been reset
                ConnectionReset=-17,
                ///Address family not supported (eg trying to connect an ipv4 bound socket to a ipv6 port)
                AddressFamilyNotSupported=-18,
                ///Address not available
                AddressNotAvailable=-19,
                ///Access denied (ie <1024 port)
                AccessDenied=-20,
                ///marked to limit the error list: MUST ALWAYS BE LAST - DO NOT ADD ANY ERRORS BELOW SOCKETERRORLIMIT
                SocketErrorLimit=-21
        };

        BLEXLIB_PUBLIC char const * GetErrorText(SocketError::Errors errcode);

} //end namespace SocketError

struct BLEXLIB_PUBLIC SocketAddress
{
        struct sockaddr_storage addr;

        SocketAddress()
        {
                addr.ss_family = 0;
        }
        SocketAddress(std::string const &ip, unsigned port);
        explicit SocketAddress(std::string const &inaddr);

        /*SocketAddress(IPAddress _ip_addr,uint16_t _ip_port)
        : addr(_ip_addr)
        , port(_ip_port)
        {
        }
*/

        /** Does this address match the address (same port, and same ip
            address or this is an Any address) */
        bool Matches(SocketAddress const &rhs) const;

        /** Get network number given a prefix */
        SocketAddress GetNetworkNumber(unsigned prefixlength) const;

        /** Is this address in the specified network (expects a network number, optimized version of IsSameIPPrefixAs ? */
        bool IsInNetwork(SocketAddress const &network, unsigned prefixlength) const;

        /** Do these addresses match, considering the prefix ? */
        bool IsSameIPPrefixAs(SocketAddress const &rhs, unsigned prefixlength) const
        {
              return IsInNetwork(rhs.GetNetworkNumber(prefixlength),prefixlength);
        }

        unsigned GetPort() const;
        bool SetPort(unsigned portnum);

        bool IsIPV4() const
        {
                return addr.ss_family == AF_INET;
        }
        bool IsIPV6() const
        {
                return addr.ss_family == AF_INET6;
        }

        bool IsAnyAddress() const
        {
                return addr.ss_family==0;
        }
        bool IsIPV4AnyAddress() const;
        bool IsSameIPAs(const SocketAddress &rhs) const;

        bool operator==(SocketAddress const &rhs) const
        {
                return IsSameIPAs(rhs) && GetPort()==rhs.GetPort();
        }

        bool operator!=(SocketAddress const &rhs) const
        {
                return!(*this==rhs);
        }

        unsigned GetLength() const;
        struct sockaddr_in& GetIP4SockAddr()
        {
                return *(sockaddr_in*)&addr;
        }
        struct sockaddr_in6& GetIP6SockAddr()
        {
                return *(sockaddr_in6*)&addr;
        }
        struct sockaddr_in const& GetIP4SockAddr() const
        {
                return *(sockaddr_in const*)&addr;
        }
        struct sockaddr_in6 const& GetIP6SockAddr() const
        {
                return *(sockaddr_in6 const*)&addr;
        }
        void AppendIPAddress(Blex::PodVector< char > *dest) const;
        std::string GetIPAddress() const;
        bool SetIPAddress(std::string const &ip);
        std::string ToString() const;
        friend std::ostream& operator <<(std::ostream &str,SocketAddress const &rhs);

  //      IP4Address addr;
    //    uint16_t port;
};


/** BSD-style wrapper around the system's TCP/IP interface.
    ADDME: The underlying TCP/IP interface is generally thread-safe, even when
    accessing the same socket. However, many members of this class are not
    thread safe. Eliminating at least the seperate Error variable would go
    a long way to making this class easier to use without locks in a MT
    environment. */
class BLEXLIB_PUBLIC Socket : public Blex::Stream
{
        public:
        ///States our socket can be in
        enum SocketState
        {
                /** The socket is not yet connected */
                SFree,
                ///The socket is listening for connections
                SListening,
                ///The socket is trying to connect
                SConnecting,
                ///The socket has been connected to a remote endpoint
                SConnected,
                ///The socket has been hungup by the remote side
                SHungup,
                ///The socket is closed and in an unusable state (after Close)
                SClosed
        };

        //Local types
        enum Protocols { Stream, Datagram };

        typedef int32_t SocketFd;

        explicit Socket(Protocols prot);
        ~Socket();

        SocketFd GetFd() const
        {
                return sock;
        }

        //Last Read/Write error
        SocketError::Errors lasterror;

        SocketAddress const& GetLocalAddress() const
        { return localaddress; }
        SocketAddress const& GetRemoteAddress() const
        { return remoteaddress; }

        Protocols GetProtocol() const
        { return protocol; }

        /** Binds to an IP and a hostname.
            @param localaddress Address to bind to (if ip address is 0, will bind to all IP addresses. if port is 0, will bind to any port)
            @return NoError if bind was succesful, otherwise an error code */
        SocketError::Errors Bind(SocketAddress const &localaddress);

        //Listen on the bound address.
        SocketError::Errors Listen(unsigned int backlog=25);

        SocketError::Errors SetSecure(SSLContext *context);

        SocketError::Errors BindNamedPipe(std::string const &pipename);

        //----UDP functions.----
        //Returns the # of received bytes, or -1 upon error.
        //Never returns 0. Check GetError() for more info
        int ReceiveDatagram(void  *buf,unsigned maxbuflen,SocketAddress *remoteaddress) const;

        //sends the # of bytes, -1 upon error, or 0 when the sendbuffer was full
        int SendDatagram(const void *buf,unsigned len,SocketAddress const &remoteaddress);

        //----TCP functions.----

        /** Receive a connection on a listening port. Will return 0 if there
            are no connections waiting. The socket is allocated on the heap by
            Accept, and the program receiving it should take care of delete-ing
            it himself! */
        SocketError::Errors Accept(Socket *accept_on) const;

        //Connect to a remote port/IP. Will block until an error occurs, or
        //the connection succeeded
        SocketError::Errors Connect(SocketAddress const &remoteaddress);
        SocketError::Errors FinishNonBlockingConnect(bool cancel);
        SocketError::Errors TimedConnect(SocketAddress const &remoteaddress, Blex::DateTime maxwait);

        SocketError::Errors SetNagle(bool enable);
        SocketError::Errors SetSendBufferSize(uint32_t sendbuffersize);
        SocketError::Errors SetReceiveBufferSize(uint32_t receivebuffersize);
        SocketError::Errors GetSendBufferSize(uint32_t *buffersize);
        SocketError::Errors GetReceiveBufferSize(uint32_t *buffersize);

        std::size_t Read(void *buf,std::size_t maxbufsize);
        bool EndOfStream();
        std::size_t Write(void const *buf, std::size_t bufsize);

        //Send returns -1 upon error, or otherwise the number of bytes successfully
        //delivered to the network (this does not guarantee their delivery at the
        //other end!)
        int Send (void const *buf, unsigned buflen);

        int Receive (void *buf, unsigned buflen);

        SocketError::Errors Shutdown(bool sread, bool swrite);

        void SendSSLShutdown();

        //Returns false if the close fails (unless you force it to close)
        //See Accept for more information
        SocketError::Errors Close();

        /** Release the socket FD - reset the socket class like Close(), but
            returns the fd instead of actually closing it */
        SocketFd ShutdownAndReleaseFd();

        /** Have SSL data to read? */
        bool SSLHaveRead();
        /** Have room for outgoing SSL data ? */
        bool SSLHaveWriteRoom();
        /** Does the underlying SSL code need to read? */
        bool SSLNeedsRead() const { return sslconn.get() && sslconn->ssl_wants_read; }
        /** Does the underlying SSL code need to write ? */
        bool SSLNeedsWrite() { return sslconn.get() && sslconn->GetOutgoingDataLen()>0; }

        /** Does the underlying SSL code disallow writing until incoming data has arrived? */
        bool SSLBlockedUntilRead() const { return sslconn.get() && sslconn->ssl_blocked_until_read; }

        std::string GetSSLError() const;

        /** A time-limited receive on a socket
                @param receivebuffer Buffer used to store incoming data
                @param maxreceivelen Maximum number of bytes to receive
                @param trigger Async trigger to use for waiting
                @param maxwait End time of wait operation
                        first: The error that occurred during operation
                        second: Number of bytes received */
        std::pair<SocketError::Errors, int32_t> TimedReceive(void *receivebuffer, unsigned maxreceivelen, Blex::DateTime maxwait);
        /** A time-limited send on a socket
                @param sendbuffer Buffer of data to be send
                @param numbytes Number of bytes to be send
                @param sendoffset Offset within the buffer to start send opreation
                @param trigger Async trigger to use for waiting
                @param maxwait End time of wait operation
                        first: The error that occurred during operation
                        second: Number of bytes send */
        std::pair<SocketError::Errors, int32_t> TimedSend(void const *sendbuffer, unsigned numbytes, Blex::DateTime maxwait);

        SocketError::Errors SetBlocking(bool enable);
        bool IsBlocking() const
        {
                return is_blocking;
        }

        /** Set the hostname of the remote end (for SSL virtual hosting)
        */
        void SetRemoteHostname(std::string const &remotehostname);

        bool GetPeerCertificateChain(std::string *dest);

        private:
        void InnerCloseSocket();
        SocketError::Errors InnerSetBlocking(bool enable);

        int RawSend (void const *buf, unsigned buflen);
        int RawReceive (void *buf, unsigned buflen);

        SocketError::Errors RestoreSocket(bool ipv6);

        ///Do something, anything. Return >0 if there was forward progress
        int SSLDoSomething();

        SocketState sockstate;
        Protocols const protocol;

        SocketFd sock;
        SocketAddress bindlocaladdress;
        SocketAddress localaddress;
        SocketAddress remoteaddress;

        std::unique_ptr<SSLConnection> sslconn;
        std::string sni_hostname;
        bool is_blocking;

        friend class DebugSocket;
};

/** The socket class. Just a dummy if nothing happens, but it provides
    wrappers around all socket calls in debugging mode */
class BLEXLIB_PUBLIC DebugSocket : public Blex::Stream
{
        public:
        ///Socket debugging modes
        enum DebuggingMode
        {
                ///transparant, keep debugging silent
                None,
                ///print messages about errors
                Errors,
                ///debug all calls
                Calls,
                ///both calls, and dumb data to scren
                All
        };

        explicit DebugSocket(Socket::Protocols prot, DebuggingMode mode=None);
        ~DebugSocket();

        void SetDebugMode(DebuggingMode _mode)
        {
                mode=_mode;
        }

        std::size_t Read(void *buf,std::size_t maxbufsize);
        bool EndOfStream();
        std::size_t Write(void const *buf, std::size_t bufsize);

        //the debugged code
        int ReceiveDatagram(void *buf,unsigned maxbuflen,SocketAddress *remoteaddress) const;
        int SendDatagram(void const *buf,unsigned len,SocketAddress const &remoteaddress);
        SocketError::Errors Accept(Socket *accept_on) const;
        int Send (void const *buf, unsigned buflen);
        int Receive (void *buf, unsigned buflen);
        SocketError::Errors Close();
        SocketError::Errors Shutdown(bool sread, bool swrite);
        Socket::SocketFd ShutdownAndReleaseFd();
        SocketError::Errors Connect(SocketAddress const &remoteaddress);
        SocketError::Errors FinishNonBlockingConnect(bool cancel);
        SocketError::Errors Bind(SocketAddress const &remoteaddress);
        SocketError::Errors Listen(unsigned backlog=25);
        SocketError::Errors SetNagle(bool enable);
        SocketError::Errors SetSendBufferSize(uint32_t sendbuffersize);
        SocketError::Errors SetReceiveBufferSize(uint32_t receivebuffersize);
        SocketError::Errors GetSendBufferSize(uint32_t *buffersize);
        SocketError::Errors GetReceiveBufferSize(uint32_t *buffersize);

        SocketError::Errors TimedConnect(SocketAddress const &remoteaddress, Blex::DateTime maxwait);
        std::pair<SocketError::Errors , int32_t> TimedSend(void const *sendbuffer, unsigned numbytes, Blex::DateTime maxwait);
        std::pair<SocketError::Errors , int32_t> TimedReceive(void *receivebuffer, unsigned maxreceivelen, Blex::DateTime maxwait);

        SocketError::Errors SetBlocking(bool enable);
        SocketAddress const& GetLocalAddress() const { return debuggedsocket.GetLocalAddress(); }
        SocketAddress const& GetRemoteAddress() const { return debuggedsocket.GetRemoteAddress(); }
        Socket::Protocols GetProtocol() const { return debuggedsocket.GetProtocol(); }
        SocketError::Errors SetSecure(SSLContext *context);
        void SendSSLShutdown();

        inline SocketError::Errors Accept(DebugSocket *accept_on) const
        {
                return Accept(&accept_on->debuggedsocket);
        }
        inline operator Socket&() { return debuggedsocket; }

        Socket::SocketFd GetFd() const
        {
                return debuggedsocket.GetFd();
        }

        std::string GetSSLError() const
        {
                return debuggedsocket.GetSSLError();
        }

        /** Set the hostname of the remote end (for SSL virtual hosting)
        */
        void SetRemoteHostname(std::string const &remotehostname) { debuggedsocket.SetRemoteHostname(remotehostname); }

        bool GetPeerCertificateChain(std::string *dest) { return debuggedsocket.GetPeerCertificateChain(dest); }

        private:
        /** Dump a packet to the debug output
            @param len Length of the packet
            @param buf Buffer of packet */
        void DumpPacket(unsigned len,void const *buf) const;

        Socket debuggedsocket;

        ///Current debugging mode
        DebuggingMode mode;
};

/** Create a bidirectional socket pair. The two sockets are called 'left' and
    'right', although they are indistinguishable. Writes from one socket are
    read on the other, and vice versa*/
struct BLEXLIB_PUBLIC SocketSet
{
        /** Create the sockets, throw bad_alloc if socket creation fails
            @param protocol Protocol for the new sockets (Stream = TCP, Datagram = UDP)*/
        explicit SocketSet(Blex::Socket::Protocols protocol, bool ipv6);

        ///Destructor
        ~SocketSet();

        /** Get the left end of the socket pair */
        Socket& GetLeftEnd() const { return *leftend; }

        /** Get the right end of the socket pair */
        Socket& GetRightEnd() const { return *rightend; }

        /** Release the left end of the socket pair. The caller becomes responsible for deleting the socket */
        Socket* ReleaseLeftEnd() { return leftend.release(); }

        /** Release the right end of the socket pair. The caller becomes responsible for deleting the socket */
        Socket* ReleaseRightEnd() { return rightend.release(); }

        private:
        /** The left socket */
        std::unique_ptr<Socket> leftend;
        /** The right socket */
        std::unique_ptr<Socket> rightend;

        SocketSet(SocketSet const &); //not implemented
        SocketSet& operator=(SocketSet const &); //not implemented
};

/** Get the system's host name */
BLEXLIB_PUBLIC std::string GetSystemHostName(bool completehostname);
/** Connect two sockets together (creating a bidirectional pipe) */
BLEXLIB_PUBLIC bool TryConnectSockets(Socket &lhs, Socket &rhs, bool ipv6);

/** Resolve a hostname address to an IP adress. Returns AnyIPAddress if resolving failed*/
BLEXLIB_PUBLIC SocketAddress ResolveHostname(std::string const &hostname);
/** Resolve a hostname address to an IP adress, getting multiple IP addresses, if present*/
BLEXLIB_PUBLIC void ResolveHostnameAllIPs(std::string const &hostname, std::vector<SocketAddress> *results);
/** Returns the list of local IP addresses*/
BLEXLIB_PUBLIC void GetLocalIPs(std::vector<SocketAddress> *results);

/** Resolve an IP address to a hostname. Returns an empty string if resolving failed*/
BLEXLIB_PUBLIC std::string ResolveIPAddress(SocketAddress const &ipaddress);

///Add a path to a socket_binder
BLEXLIB_PUBLIC void AddSocketBinderPath(std::string const &socketbinder);

BLEXLIB_PUBLIC std::ostream& operator <<(std::ostream &str,SocketAddress const &rhs);
//std::string IPAddressToString(IPAddress ip_addr);
///Parse an IPv4 address. Returns Blex::NoIPAddress if the parsing fails
//IPAddress IPAddressFromString(std::string const &ip_addr);


} //end of namespace Blex

#endif
