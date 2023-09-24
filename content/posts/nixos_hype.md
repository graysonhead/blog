+++
title = "Is Nix Worth The Hype?"
date = 2023-09-23
[taxonomies]
	tags = [ "Nix", "NixOS", "Opinion" ]
+++

Sometimes something comes along that legitimately disrupts the software/IT industry. Some examples that come to mind are Ansible, Docker, Kubernetes, etc. But far more often, projects and products come along that make exaggerated claims of being revolutionary, only to die an unceremonious death.

At a certian point it becomes clear to everyone who the winners and the losers are. But by that time they are always so far along their journey of marketplace dominance that the job market is saturated by experts and anyone getting on board is on the laggard side of the adoption curve. 

One thing is clear; [Nix](https://nixos.org/) isn't there yet. But will it ever be? Is it worth your valuable time learning about it now?

# Disambiguating Nix

Its important to make a distinction between Nix: the package manager, and NixOS: the linux distribution that uses the Nix package manager. And then, to make things extra confusing, you also have Nix: the domain specific language. I'll forgive you being confused because I'll be referring to the package manager and the language interchangeably. 

In truth, it won't affect the conclusions of this post because what I want to evaluate the viability of the ecosystem of Nix, which includes all of the aforementioned components. How do these things all add up? Do they really make managing software and systems easier? Or is it just another useless layer of abstraction?

# The Promise of Panacea

Looking back to when I learned ansible, I remember being filled with its promise. I was still working for a company that largely managed servers like cattle (because everyone did in those days except for the rare hyper-scale exceptions.) I remember thinking that Ansible was going to revolutionize the way I provisoined machines, and in all honesty it did. It solved a lot of problems, but more importantly, it changed my mindset on how large herds of computers should be managed.

Ansible had a lot of shortcomings though, for instance, while it tried very hard to be declarative it was still very much operating on an imperative CLI or against imperative APIs. While most of the core plugins were idempotent (you can run them multiple times and it won't mess things up if the system is already in the correct state), there was no functional way of forcing plugin developers to write idempotent plugins. As a result, as you left the officially blessed core plugins, you entered a wild west where side effects and unexpected behavior were more and more likely. 

Ansible was a very important step in improving the way provisioning worked, but it wasn't a panacea. 

Docker was another huge step forward for the industry. It has very minimal scripts (Dockerfiles) that allow you to build an image that can be deployed on systems that contained their own environments. It solved a lot of traditional problems that came from running in the shared library environment of traditional Linux. It made traditionally hard-to-deploy applications much easier.

But this introduced a new class of problems. From tried and true build scripts to fragile Dockerfiles that were often vulnerable to bitrot. Additionally relying on a user defined label instead of a hash by default (don't even get me started on the `latest` tag) led to a lot of potential security issues, and performance problems and bugs that were difficult to debug (why are half of my application servers crashing when they are all running the same version?) Additionally IO and Network issues are commonplace, and vulnerability fixes (meltdown and spectre specifically) resulted in a lot of strange performance bugs inside of containers.

Docker was another huge step, but again, far from a panacea.

# What Problems Does Nix Actually Solve?

The Nix ecosystem is capable of deterministically and repeatably building software, and entire operating systems (including their configuration). It puts guard rails (isolated sandboxes and source control) in place to ensure that the same inputs *always* deliver the same outputs. In short, the same inputs will always give you (bit for bit) the same output. 

Why is this important?

Firstly, it allows you to build software fearlessly. The same inputs will always produce the same outputs, so if you build something 10 different times on 10 different computers (assuming they run the same architecture), you get the same bit-for-bit result 10 times, even if you build the last one several years apart. This allows you to do fun things like building binaries, uploading them to a shared cache, and then transparently substituting the output when the input hash matches. This means your install process is identical to your build process, which gives you immense flexibility. You don't *need* a CI/CD pipeline to build artifacts and then worry about deploying those artifacts to your servers. You can absolutely have a CI/CD pipeline that warms up a cache so you don't build binaries on your application servers, but this is completely optional (you should still have one though, at least for tests.) 

Secondly, it allows you to deterministically build operating systems. If you deploy 10 different servers from the same source, you will get the exact same server with the exact same behavior 10 times. Even if you build them several years apart. This completely eliminates a lot of the problems associated with imperative management schemes (for example, deploying something imperatively on a OS and then deploying something on a slightly newer OS which can result in wildly different performance due to library or OS tuning differences.) In other words, if you fix a problem once, you have inherently fixed it everywhere without having to worry about how to idempotently deploy that fix. Every single time you rebuild the system to deploy a change, you get a brand new fresh operating system (or as Nix calls them, a generation.)

Putting all this together, what it means is that you can have a single repository (or several interconnected ones) that completely describes your server and build environment. And if you need to rebuild your entire environment a year from now, you will get the exact same environment.

Additionally, there are other benefits as well which I'm glossing over, such as the ability to deterministically roll back to a previous state in the case of a failed upgrade, and having an immense amount of flexibility regarding your deployment style. Being able to push (deploy-rs) and pull (rebuild against a Nix Flake in a git repo) in the same repo without configuration changes makes for a very nice workflow of allowing rapid iteration while also being extremely scalable.

I'd also like to stress that deterministically building entire operating systems without any kind of heavy handed image cloning *is a novel thing*. It hasn't really been done before, and it can't really be done without making some of the ground-up design choices that NixOS made (such as abandoning [FHS](https://refspecs.linuxfoundation.org/FHS_3.0/fhs/index.html) in favor of the nix store.)

# What Price Do You Pay For The Upsides?

I'm gonna spoil the conclusion, Nix isn't a panacea either.

Nix as a language can be a real drag. It isn't because it is designed badly. It solves a very specific set of problems, and as a result has a specific set of conventions that may not be obvious or ergonomic to even seasoned developers/operations folk. This is doubly true if they have never used a purely functional language before.

To compound these issues, Nix doesn't really lend itself to toy examples or programs. Its a language to describe configurations, so the only thing you really can do with it is make packages and operating systems. As a result, the minimal viable example for most things is as complex as building a package. The simpler examples don't really teach you anything, and the complexity ramp is quite drastic in many cases.

The last thing any software engineer wants is to be instructed to learn a language they don't care about, and most software engineers don't appear give two hoots about packaging. So twisting the arm of any reasonably large organization, especially one with multiple development teams, to start packaging with Nix is going to be quite difficult unless there are a lot of developers already inclined to explore it.

This is especially true for NixOS adoption specifically, because excluding strategies like running Docker images or VMs on a NixOS box, you need your software and all of its dependencies packaged in Nix in order to deploy and orchestrate things.

I really can't overstate how big this hurdle is.

# What Is Missing?

My opinion is, there are three big things needed to bridge the gap:

## Documentation

The state of Nix documentation is pretty bad.

The two main sources are the [Nix Manual](https://nixos.org/manual/nix/stable/) and the [NixOS manual](https://nixos.org/manual/nixos/stable/).

There is an ideal ratio of time spent writing code to time spent writing documentation. No one knows what it actually is, but most people intuitively know when it isn't followed. However in the case of Nix it isn't so clear. There is, in fact, a *lot* of documentation. Its just that most of it isn't easy to follow. The documentation reads extremely terse, almost like an RFC or standards document. It seems to assume that the reader already groks the theoretical models of Nix and are looking for specific information. 

For a reference manual, this would be fine. But for a guide meant to introduce new users, its just going to make people feel stupid and by extension piss them off. It lacks any kind of narrative. It spends an awful lot of time *describing* how things work, and no time *showing* how it works. The lack of examples in what should be the first stop for new users is a huge problem. 

## Standardized Practices

One of Nix's biggest strengths is its flexibility. You can do a lot of creative things with packaging and systems configuration that are straight up not possible in alternative systems. However, this has a huge drawback: A total lack of standardization between different users and organizations.

[Flakes](https://nixos.wiki/wiki/Flakes) have made some strides in resolving this. Having a standardized input and output set that can be consumed by other Flakes does make collaborative Nix usage a lot more predictable. But anything made before the advent of flakes has a bit of "wild west" feel to it; you never really know how it works until you go read the source.

## Minified Examples

Searching for minified examples of how to do X is difficult when it comes to Nix. I'm honestly not sure why this is, but it is something that I've heard countless colleagues complain about. I myself have run into this dozens of time. How do you include a configuration module in a Flake? How do you change the source of an application using its overrides attribute? How do you combine the result of two build outputs? None of these things are hard in Nix, but figuring out how to do them in the first place is difficult. It usually requires stumbling around in the source code of Nixpkgs or random Flakes until you finally run into what you are trying to do and see how someone else did it. Very few examples exist alone in isolation. 

# The State of Modern Nix and Its Users

Nix has been around since 2003, which is ages in the technology world. This might lead a lot of people to believe that its missed the boat on mass adoption. However, my personal feelings is that before the advent of Nix Flakes, Nix was a novel concept with no practical use outside of a Hobbyist OS. 

For the record Nix Flakes were introduced in 2021 as experimental, and have not yet been marked as stable. However, I think you'd be foolish to try and introduce Nix to a new organization without Flakes. Flakes make Nix composable, and a declaratively built operating system using deterministically constructed software composed from multiple federated repositories is the secret sauce of Nix as an ecosystem. It allows you to define your *entire* infrastructure in Git (which isn't novel), and be able to rebuild it over and over again and get the exact same results every time (which is novel.)

So, considering the relative new-ness of flakes, I'd say modern nix is still very much in the early adopter quadrant of the adoption curve, and it is far from dead in the water.

Furthermore, while I give "old" Nix a lot of crap, Nixpkgs (the monorepo) has a *ton* of software in it. And it all stays pretty well up to date, at least all the less obscure stuff. You are not often going to run into the situation where a package available for Ubuntu or Centos isn't available in Nix. And since the build process for packages doesn't bit rot, keeping packages up to date is often a lot easier than it is with traditional distributions as the amount of work a maintainer needs to exert is far greatly reduced once the initial package is defined.

Functionally re-creating a basic server in Nix using common open source technologies is easy bordering on trivial, once you figure out the `nixos-rebuild` workflow. It doesn't require you to write much Nix at all. This is true up until the point where you start packaging your own software. At that point, you have to package your software (as well as any missing dependencies.) In organizations with lots of in-house software this can be a lot of work

# Is It Worth Using Now?

I have firsthand knowledge of a few companies that either already adopted or are well on their way to adopting Nix as an ecosystem. All of them have encountered some of the problems listed above, and in most cases there does need to be some organic interest within the engineering organization to get efforts off of the ground. 

But, with that being said, the benefits are clear. Package reproducibility and all of its many positive side effects seem to legitimately eliminate a large swathe of problems that relate to fragile build processes. Using Nix to replace your traditional build pipeline in my experience typically means that you get to trust it. Which isn't something I'd typically say of a more traditional pipeline, especially if Groovy scripts or Dockerfiles are involved. 

Furthermore, using Nix to manage your systems has the benefit of your systems being far more consistent than they could be with other deployment mechanisms. At least, not without investing far more effort than would be reasonable. And when you fix a problem, it typically stays fixed. 

If Nix has a theme I imagine it is something along the lines of: "investing a bit more effort in your up-front setup can save you a lot more effort chasing problems later". For me, the answer is clear; the tradeoff is well worth it.