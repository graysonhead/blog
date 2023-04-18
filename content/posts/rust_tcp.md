+++
title = "Async TCP in Rust Without Shooting Yourself in the Foot"

date = 2023-04-14

[taxonomies]
	tags = ["Rust", "Networking", "TCP", "Tutorials"]
+++

As someone who came to Rust from high level languages, lower level networking was something
that I was very excited to work with in Rust. While Python's TCP and UDP implementations are
great, the speed of Python often felt very constraining when writing services that needed
to move lots of data quickly and concurrently. 

I was glad to discover that working with the async implementations of TCP and UDP sockets in
Rust using [Tokio](https://tokio.rs/) was quite intuitive, for the most part. While getting traffic flowing was
easy, getting traffic flowing *reliably* required some steps beyond the boilerplate in the 
documentation. So, let my lessons be your lessons, lets send some segments!

## TCP Basics

Frankly, TCP is a complicated way of getting data from point A to point B. There are a lot 
of steps to set up, send data, acknowledge the receipt of data, and terminate the connection.
Fortunately, the OS handles most of this for us. The sockets our program will interact
with seem a lot like magical data gateways, and that is the point of TCP in a nutshell. 

Compared to User Datagram Protocl (UDP), TCP has a lot of advantages. Namely:
* Delivery order of data is guaranteed
* Re-transmission of data is automatic if not acknowledged by the other side
* Flow and Congestion control
* You can easily send blocs of data larger than your network's Maximum Transmission Unit (MTU)

But, there is a price to pay:
* Programs using TCP are often more complex. This is primarily due to keeping track of more connection states
* TCP itself has some overhead, a system using many TCP sessions may use more memory than one using UDP for 
the same purpose
* Due to complex flow handling and congestion control algorithms, sometimes its harder to troubleshoot TCP performance issues

Generally, TCP is useful if you need guaranteed delivery of data in a specific order. It can also reduce the complexity of 
programs that need a lot of bidirectional connections between a single server and multiple clients. It also can make it 
easier to send large blocs of data larger than your MTU, but there are no shortage of libraries that make this just as easy with
UDP.

# Getting Started: Streams and Listeners

Lets get some connections going. Lets start a project and add a dependency for our async runtime, Tokio:

```
cargo new rust-tcp-tutorial  
cargo add tokio --features socket2 --features macros --features rt-multi-thread --features net --features sync --features io-util
```

Next, we will add two rust files in `/src/bin/`:

```rust
// src/bin/server.rs
use tokio::net::TcpListener;

#[tokio::main]
async fn main() {
    let bind_addr = "0.0.0.0:1234";
    listen(bind_addr).await;
}

async fn listen(bind_addr: &str) {
    let listener = TcpListener::bind(bind_addr).await.unwrap();
    loop {
        let (stream, _) = listener.accept().await.unwrap();
        println!("Connection from {}", stream.peer_addr().unwrap());
    }
}
```

```rust
// src/bin/client.rs
use tokio::net::TcpStream;

#[tokio::main]
async fn main() {
    let server_addr = "127.0.0.1:1234";
    let stream: TcpStream = TcpStream::connect(server_addr).await.unwrap();
    println!("Connected to {}", stream.peer_addr().unwrap());
}

```

Our first example doesn't do much useful. If you run the two programs at the same time, you 
will see that all they do is initiate a connection.

 
You can run any rust file in `/src/bin` like this:  
`cargo run --bin server`  
`cargo run --bin client`

On the server, you will get the output:  
```
Connection from 127.0.0.1:55586
```

And on the client:  
```
Connected to 127.0.0.1:1234
```

Taking a closer look at what is happening thus far: On the server,
we are binding to a socket address, which is represented by a bind IP and port. A bind address
is a mechanism to inform the host operating system upon which interfaces this listener will be bound.

For instance, say we have a system with the following Interface layout:  
```
eth0 10.1.1.15
eth1 172.16.0.25
lo 127.0.0.1
```

If the bind address were set to `127.0.0.1:1234`, any request to `eth0` or `eth1` would fail (usually with
a connection refused error), but a request sent to the local loopback address of `127.0.0.1` with a 
destination port of `1234` would succeed.

A bind address of of `10.5.5.15:1234` would allow connections to `eth0` but not `eth1` or the local loopback.

If you want to bind to all available interfaces, you can use an bind IP of `0.0.0.0:1234`.

The call to `TcpListener::bind()`, unsurprisingly returns a [TcpListener](https://docs.rs/tokio/latest/tokio/net/struct.TcpListener.html). 

Once a client connects, we can call `listener.accept()` to get a [TcpStream](https://docs.rs/tokio/latest/tokio/net/struct.TcpStream.html)
for this connection. This is the mechanism that allows you to send and receive data to and from this client.

On the client side, you will notice that `TcpStream::connect()` of course also gives us a `TcpStream`. This is 
convenient as there can be a lot of commonality in the way clients and servers interact.


So, to sum up, a TCP Server binds to a port, which returns a Listener. These Listeners then give us Streams, and 
streams are what we will use in the next section to actually send and receive data. 

## Using Streams

Before getting into some examples, I want to point out that the [Tokio docs](https://docs.rs/tokio/latest) are a wonderful resource, and you
will see the skeleton of the examples in a lot of production code. But, they quite minimal, and they don't go over (or at least don't explain)
some of the more common pitfalls you may run into. The following not-so-minimal example will show a lot of this behavior.

Extending our previous code, lets add relay functionality to the server:

```rust
// src/bin/server.rs
use std::{error::Error, io};
use tokio::{
    io::{AsyncReadExt, Interest},
    net::{TcpListener, TcpStream},
};

#[tokio::main]
async fn main() {
    let bind_addr = "0.0.0.0:1234";
    listen(bind_addr).await;
}

async fn listen(bind_addr: &str) {
    let listener = TcpListener::bind(bind_addr).await.unwrap();
    loop {
        let (stream, _) = listener.accept().await.unwrap();
        tokio::spawn(async move {
            handle_stream(stream).await.unwrap();
        });
    }
}

async fn handle_stream(stream: TcpStream) -> Result<(), Box<dyn Error>> {
    println!("Connection from {}", stream.peer_addr().unwrap());
    let mut reply_queue: Vec<Vec<u8>> = Vec::new();
    let mut buf: [u8; 1024];
    loop {
        let ready = stream
            .ready(Interest::READABLE | Interest::WRITABLE)
            .await?;
        if ready.is_readable() {
	    buf = [0; 1024];
            match stream.try_read(&mut buf) {
                Ok(n) => {
                    println!("read {} bytes", n);
                    let mut result_buffer: Vec<u8> = Vec::with_capacity(n);
                    buf.take(n as u64).read_to_end(&mut result_buffer).await?;
                    reply_queue.push(buf.to_vec());
                }
                Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {
                    continue;
                }
                Err(e) => {
                    return Err(e.into());
                }
            }
        }

        if ready.is_writable() {
            if let Some(msg) =  reply_queue.pop() {
                match stream.try_write(&msg) {
                    Ok(n) => {
                        println!("Wrote {} bytes", n);
                    }
                    Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {
                        continue;
                    }
                    Err(e) => {
                        return Err(e.into());
                    }
                }
            }
        }
    }
}
```

```rust
// src/bin/client.rs
use std::error::Error;
use std::io;
use tokio::io::AsyncReadExt;
use tokio::net::TcpStream;

#[tokio::main]
async fn main() {
    let server_addr = "127.0.0.1:1234";
    let stream: TcpStream = TcpStream::connect(server_addr).await.unwrap();
    println!("Connected to {}", stream.peer_addr().unwrap());
    send_request(stream).await.unwrap();
}

async fn send_request(stream: TcpStream) -> Result<(), Box<dyn Error>> {
    loop {
        stream.writable().await?;
        match stream.try_write(b"Hello!") {
            Ok(n) => {
                println!("Wrote {} bytes", n);
                break;
            }
            Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {
                continue;
            }
            Err(e) => {
                return Err(e.into());
            }
        }
    }

    let mut buf: [u8; 4096];
    loop {
        stream.readable().await?;
        buf = [0; 4096];
        match stream.try_read(&mut buf) {
            Ok(n) => {
                let mut vec = Vec::with_capacity(n);
                buf.take(n as u64).read_to_end(&mut vec).await?;
                let s = String::from_utf8(buf.to_vec()).unwrap();
                println!("Got reply from host: {}", s);
                break;
            }
            Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {
                continue;
            }
            Err(e) => return Err(e.into()),
        }
    }

    Ok(())
}
```

Lets go over some of the more important parts of these changes. 

The client is quite a naive example, as it very deterministically sends a request and then waits for a reply, but we
do see the start of two patterns you will see throughout the rest of this tutorial. Specifically, the `try_read` and `try_write`
match blocks.

```rust
loop {
    stream.writable().await?;
    match stream.try_write(b"Hello!") {
        Ok(n) => {
            println!("Wrote {} bytes", n);
            break;
        }
        Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {
            continue;
        }
        Err(e) => {
            return Err(e.into());
        }
    }
}
```
So first, we check to see if the stream is actually ready to be written to. It often can't, for various reasons. And 
sometimes it thinks it is, but it actually isn't. Notice that this method is async and thus is `await`ed. 

There is a lot of really cool logic happening in this one line. On Linux operating systems, when Tokio
created the TcpStream, it registered an [epoll](https://en.wikipedia.org/wiki/Epoll) waiter for the stream. When we
await on the `writeable` method, Tokio puts the task to sleep until the Kernel informs us either that the stream is
ready to be written to, or that data has been received
and is ready to be read on the stream. What this means is, this task will consume practically no system resources 
until there is data for it to process. Pretty neat, huh?

Next, we match the result of the `try_write` method. Now, this isn't async, but `try_write` will ensure that the call
doesn't block on IO unnecessarily. However, this creates a quandry, as sometimes the `writable` method gives us false
positives because of weird messy kernel programming reasons. As a result, we need to be prepared to deal with that, and 
we deal with it by matching on the `WouldBlock` error type. If we get this Error, we restart the loop and await it again.
Eventually, we will enter the loop on a true positive, and be able to write our data. 

While this arrangement may sound complex, it can reduce the busy time of programs doing network IO *significantly*.

Reading response uses mostly the same pattern, but with more logic to handle copying data from buffers:  
```rust
loop {
        let mut buf: [u8; 4096];
        stream.readable().await?;
        buf = [0; 4096];
        match stream.try_read(&mut buf) {
            Ok(n) => {
                let mut vec = Vec::with_capacity(n);
                buf.take(n as u64).read_to_end(&mut vec).await?;
                let s = String::from_utf8(buf.to_vec()).unwrap();
                println!("Got reply from host: {}", s);
                break;
            }
            Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {
                continue;
            }
            Err(e) => return Err(e.into()),
        }
    }
```


Now, for the server. Up first, our listen function is now spawning a Tokio Task on each new stream.  
```rust
async fn listen(bind_addr: &str) {
    let listener = TcpListener::bind(bind_addr).await.unwrap();
    loop {
        let (stream, _) = listener.accept().await.unwrap();
        tokio::spawn(async move {
            handle_stream(stream).await.unwrap();
        });
    }
}
```

Keep in mind, Tokio Tasks are not threads. Thread count is determined by the Tokio runtime. Tasks will 
run on a thread until they `await`, at which point another task will usually take its place. So don't feel bad about
spinning up a bunch of tasks to handle individual client connections. Unless you are doing blocking io operations in them,
in which case you should feel bad.

Notice how we are spawning a task for each stream, and running the `handle_stream` function inside of it. While not 
always necessary, this is a very common pattern for applications that want to process traffic for multiple clients
simultaneously. This also takes advantage of async IO, as the program will never block while waiting for messages 
from hosts that haven't sent any.

And now, lets break the `handle_stream` function into a few distinct sections:  
```rust
println!("Connection from {}", stream.peer_addr().unwrap());
let mut reply_queue: Vec<Vec<u8>> = Vec::new();
let mut buf: [u8; 1024];
```
In this "preamble", we are setting up a mutable `reply_queue` which we will use to store messages that we want to
relay back to the client. Since each client's stream exists within its own Tokio task running this function, this
isolates communication per client by default, which is a nice aspect of this pattern and lends itself well to serving
many clients simultaneously.

Now, getting into the loop:
```rust
 let ready = stream
            .ready(Interest::READABLE | Interest::WRITABLE)
            .await?;
```
This method returns a [Ready](https://docs.rs/tokio/latest/tokio/io/struct.Ready.html) object describing the current
state of the Stream. This allows you to handle one write operation, or one read operation per loop. This also ensures that
your writes don't block your reads, your reads don't block your writes. Since it is `await`ed, it also ensures that the 
Task will sleep while it has no ability to perform IO.

There will be a lot of cases in more complex programs where you need to split your `TcpStream` into a `WriteHalf` and a `ReadHalf`, but that is
a topic for another day.

Now, lets run the code. But first make sure you know where your `ctrl + c` keys are:

Client:  
```
Connected to 127.0.0.1:1234
Wrote 6 bytes
Got reply from host: Hello!
```

Server:  
```
read 6 bytes
Wrote 6 bytes
Wrote 0 bytes
read 0 bytes
Wrote 0 bytes
read 0 bytes
Wrote 0 bytes
read 0 bytes
Wrote 0 bytes
read 0 bytes
Wrote 0 bytes
read 0 bytes
Wrote 0 bytes
read 0 bytes
Wrote 0 bytes
read 0 bytes
Wrote 0 bytes
read 0 bytes
Wrote 0 bytes
read 0 bytes
Wrote 0 bytes
read 0 bytes
Wrote 0 bytes
read 0 bytes
...
```

## Whats Up With the Zero Byte Buffer?

Well, that is something...

What is happening here is some convention surrounding Rusts buffers (At least those that implement the [Read](https://doc.rust-lang.org/std/io/trait.Read.html#) trait) that isn't exactly obvious. 

If you go down the buffer rabbit hole far enough, you will find this rather vauge description on `std::io::Read`'s doc page:  

>If the return value of this method is Ok(n), then implementations must guarantee that 0 <= n <= buf.len(). A nonzero n value indicates that the buffer buf has been filled in with n bytes of data from this source. If n is 0, then it can indicate one of two scenarios:
>
>1. This reader has reached its “end of file” and will likely no longer be able to produce bytes. Note that this does not mean that the reader will always no longer be able to produce bytes. As an example, on Linux, this method will call the recv syscall for a TcpStream, where returning zero indicates the connection was shut down correctly. While for File, it is possible to reach the end of file and get zero as result, but if more data is appended to the file, future calls to read will return more data.
>2. The buffer specified was 0 bytes in length.


What this usually means in the context of a TCPStream, is that the other side closed the connection. When the TCPStream on the client side falls out of scope as the client unwinds, it 
closes It's side. Since the buffer for the TCPStream will no longer produce any more bytes, it is considered closed. In *most* cases, you can interpret an `Ok(0)` result from this
method as a graceful disconnect. So lets modify the match block to reflect that.

```rust
if ready.is_readable() {
            buf = [0; 1024];
            match stream.try_read(&mut buf) {
                Ok(0) => {
                    println!("Client disconnected");
                    return Ok(());
                }
                Ok(n) => {
                    println!("read {} bytes", n);
                    let mut result_buffer: Vec<u8> = Vec::with_capacity(n);
                    buf.take(n as u64).read_to_end(&mut result_buffer).await?;
                    reply_queue.push(result_buffer.to_vec());
                }
                Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {
                    continue;
                }
                Err(e) => {
                    return Err(e.into());
                }
            }
        }
```

Now, when we get a 0 length buffer from the `try_read` method, the TCPStream handler method will exit, and all of its connections and buffers
will be automatically cleaned up as they fall out of scope.

Lets run the example code again:  
```rust
Connection from 127.0.0.1:58682
read 6 bytes
Wrote 6 bytes
Client disconnected
```

While this behavior isn't very intuitive to people not already familiar, it can be dealt with in a pretty succinct way. And, as you can see, now that you know what it 
means you have a program that will reliably handle all manner of connections, disconnections, reconnections, etc without having to address all those specific cases.

# Some Other Pitfalls

## Wait, How Did I Just Send Data to a Disconnected Host?

Well, the short answer is, you didn't. It just looked like you did.

Imagine this scenario:

Two systems have a long-running TCP Connection between them. 

The server crashes or otherwise loses it's connection to the client.

The client then sends some data via the `try_write` method, which succeeds. What the heck?

Well, what we've succeeded in doing is writing data into a kernel networking buffer on a stream that, as far as the kernel is concerned, is still alive and healthy.

Networking problems are not uncommon, and many of them are recoverable. TCP is a protocol that, as mentioned in the intro, is capable of retrying and retransmitting lost data.
This takes time though, and by the time the complete retransmission process has finished, our program will have long moved on to another context (assuming it isn't blocking on 
IO, which as previously established, is a bad thing.)

How has the kernel not realized there is a problem yet?

Well, in the case of Linux, the answer is hiding in proc:
```
$ cat /proc/sys/net/ipv4/tcp_keepalive_time
7200
$ cat /proc/sys/net/ipv4/tcp_keepalive_probes 
9
$ cat /proc/sys/net/ipv4/tcp_keepalive_intvl 
75
```

These are generally the default values for the three parameters of a TCP Connection that govern detecting failed connections.

As is so excellently explained by [wikipedia](https://en.wikipedia.org/wiki/Keepalive):  
> * Keepalive time is the duration between two keepalive transmissions in idle condition. TCP keepalive period is required to be configurable and by default is set to no less than 2 hours.
> * Keepalive interval is the duration between two successive keepalive retransmissions, if acknowledgement to the previous keepalive transmission is not received.
> * Keepalive retry is the number of retransmissions to be carried out before declaring that remote end is not available


So, in the case of an idle connection, it will take more than 2 hours for a TCP connection to be considered failed, at which point calling `try_write` will result in an IOError.

But, there is something we can do about it. Upon creating TCP Connections, the Kernel will allow us to pass in our own values for each of these settings. Unfortunately, Tokio doesn't provide convenience methods for these as far as I can tell, so we need to do a little bit of excessive type conversions:  
```rust
let stream = TcpStream::connect(&socket_addr_string).await.unwrap()
let stream: std::net::TcpStream = stream.into_std().unwrap();
let socket: socket2::Socket = socket2::Socket::from(stream);
let keepalive = TcpKeepalive::new()
    .with_time(Duration::from_secs(10))
    .with_interval(Duration::from_secs((5));
socket.set_tcp_keepalive(&keepalive).unwrap();
let stream: std::net::TcpStream = socket.into();
let stream: tokio::net::TcpStream = tokio::net::TcpStream::from_std(stream).unwrap();
```

While TCP Keepalive is a pretty low-overhead operation, bear in mind that you probably don't want to set a one-second interval on a service
that maintains tens of thousands of connections.

Now, I do hear a few of you yelling at your monitor that I should have just constructed the socket using a `socket2` builder in the first place, but I disagree because of...

## DNS Lookups and Socket Address Type Conversions

One thing you may want to keep in mind, especially if you are going to implement connection retry functionality into your program, is where your DNS lookups take place.
In a robust long-running daemon, you probably want to perform a DNS lookup on each successive connection, otherwise you may not discover until restarting your application
that the DNS records on the other side changed. This can result in really annoying behavior that frustrates operators.

So, where do DNS lookups take place?

A big clue can be gleaned by looking at the [SocketAddr](https://doc.rust-lang.org/std/net/enum.SocketAddr.html) type:  
```rust
pub enum SocketAddr {
    V4(SocketAddrV4),
    V6(SocketAddrV6),
}
```

Sure enough, there is no such thing as a `SocketAddr` that contains a DNS name, it must either be an IPv4 or IPv6 address + destination port. So, we can safely assume
that any time we convert from an address string to a `SocketAddr`, a DNS lookup must take place. This is one place where it is very easy for blocking IO to sneak it's 
way into your otherwise async application. For instance, if you construct a socket in a non-async framework, and then convert it to an async socket, you may have performed
a non-async DNS lookup.

Now, in some cases you may want the lookup to only be performed once, in which case feel free to stick a conversion from string to `SocketAddr` directly in your [clap](https://docs.rs/clap/latest/clap/) arguments, in which case your application will perform exactly one DNS lookup when the arguments are parsed and converted.

But, if that isn't the behavior you want, feel free to keep passing around you addresses as strings (or another intermediary type) for a bit longer.


# Closing

Don't be intimidated by lower level network protocols in Rust, or any language really. While they tend to require a little more work to get right than, say a HTTP REST call, they still have
their place in modern software engineering. Especially if you have a lot of data you need to get somewhere really fast with as little overhead as possible. 

Just bear in mind, there are definitely some ways to shoot yourself in the foot. So make sure you test well, and have a basic understanding of what is actually going on 
with the magical data portal that is a TCPStream.

You can access the complete source code used as an example [here](https://github.com/graysonhead/rust-tcp-tutorial).
