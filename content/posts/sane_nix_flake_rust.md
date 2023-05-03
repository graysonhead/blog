+++
title = "Nix Powered Dev Environments: Rust"

date = 2023-04-24

[taxonomies]
	tags = ["Tutorials", "Nix", "NixOS", "Rust", "rust-overlay", "naersk" ]
+++

Nix is a lot of things, a language, a package manager, even an operating system, but really its an ecosystem. 
And that ecosystem can do some really neat things.

This tutorial is targeted for someone who is getting their feet wet with Nix, using the Nix
package manager on Linux or MacOS. But, it also demonstrates a development workflow
that can be used by other crazy people like me that daily drive NixOS.

I started using Nix about a year and a half ago, and since then I've 
gone deep down the rabbit hole. To the point where my entire home setup runs 
NixOS primarily. Having a consistent experience across all
of my computers is a wonderful thing, and one of the best parts is 
having truly 100% isolated development environments. 

While bootstrapping these is a bit more work, (due to an intentional complete 
lack of development tools in my system path), having near 
guaranteed isolation between projects is 
quite an incredible thing.

The core components of this development workflow center around [Nix Flakes](https://nixos.wiki/wiki/Flakes) and [Direnv](https://direnv.net/).

# Flake Templates

Due to the increased initial cost of setting up a new project, its almost mandatory to 
create standardized Flake templates to save yourself time when kickstarting a new project.

I maintain a repo of [Flake Templates](https://github.com/graysonhead/nix-templates) customized for my use, but they are MIT licensed so feel free to use them.

Today we are going to explore the Rust templates that I still actively use.

# Simple: Naersk + Nixpkgs

Here is a simple, but useful, Rust Flake example:

{{ remote_code(url="https://raw.githubusercontent.com/graysonhead/nix-templates/main/rust/naersk/flake.nix", code_language="nix")}}

You can setup this repo locally with this command:    
```
nix flake new --template github:graysonhead/nix-templates#rust-naersk ./changeme
```

This is the base template I use for any simple rust project I use that will be based off of
nixpgks and not require a nightly (or otherwise specific) build of Rust. Its a good starting
point, and it is already pretty flexible. For instance, if you are building something that
requires openssl you only need to change one line to add it:

```nix
{
  buildInputs = with pkgs; [
    openssl
  ];
}
```

Using it is also simple. First, you shoud familiarize yourself with the output of `nix flake show`:  
```
$ nix flake show
git+file:///home/grayson/RustProjects/naersk-template
├───defaultPackage
│   ├───aarch64-darwin: package 'naersk-template-0.1.0'
│   ├───aarch64-linux: package 'naersk-template-0.1.0'
│   ├───x86_64-darwin: package 'naersk-template-0.1.0'
│   └───x86_64-linux: package 'naersk-template-0.1.0'
└───devShell
    ├───aarch64-darwin: development environment 'nix-shell'
    ├───aarch64-linux: development environment 'nix-shell'
    ├───x86_64-darwin: development environment 'nix-shell'
    └───x86_64-linux: development environment 'nix-shell'

```

Here we can see a tree of the output set (the set that the nix flake returns) in a more visually appealing form. This command is 
extremely useful on more complex flakes with dozens or even hundreds of outputs, but here it gives us a good idea of what is going on.

First, notice that both our `defaultPackage` and `devShell` have outputs for each architecture already. This is a result of the 
`flake-utils.lib.eachDefaultSystem` function that we wrapped our output set in. It ensures that the flake is repeated for each system type.

As a result, our flake will work on Linux and MacOS on both x86 and ARM systems. Best of all, we got that functionality practically for free!

Since we defined a `defaultPackage`, we can build the application by running `nix build`, or run it with `nix run`. You can enter the development
shell with `nix develop`, which will allow you to compile your program with native tools such as `cargo` as well as `clippy`.

To target a specific output, you can simply trace down the tree to your desired output, and call `nix build` or `nix run` like this:
`nix run .#defaultPackage.x86_64-linux`, or whatever arch you are on.

# Containers

Another nice thing about Nix flakes, is that you can easily build 
docker containers without needing a fragile dockerfile. For instance, you can
modify the output set and add a seperate output for building a container image:


```nix
{
		packages =
          {
            app = naersk'.buildPackage {
              # Naersk will look for a `Cargo.toml` in this directory
              src = ./.;
              # Our buildinputs from above are specified here
              nativeBuildInputs = nativeBuildInputs;
              buildInputs = buildInputs;
            };
            contianer = pkgs.dockerTools.buildImage
              {
                name = "app";
                config = {
                  entrypoint = [ "${packages.app}/bin/app" ];
                };
              };
          };
}
```


This allows you to build a container image by running `nix build .#container`, which
can be loaded into docker via `docker load -i ./result`. 

# Multi-Workspace Projects

Flakes also allow you to utilize workspaces as well, although the process for doing that 
in Naersk isn't exactly straightforward. 

To build a project in a workspace, you can add this to your package output definition:

```nix
{
  example-workspaced-app = naersk'.buildPackage {
    name = "example-workspace";
    src = ./.;
    cargoBuildOptions = x: x ++ [ "-p" "example-workspace" ];
  };
}
```

This assumes that your workspace (with its own `Cargo.toml` file) is located in `./example-workspace`.

Note that you will also need to ensure that your main `Cargo.toml` file has an entry
for this workspace, like this:

```toml
[workspace]
members = [
    "example-workspace"
]
```

Cargo technically doesn't *need* this entry to function, but Naersk does, and you
won't be able to build or run anything in that workspace without it.

# Nightly Rust

If you want to use nightly rust (or a version seperate from Nixpkgs), you can use the `oxalica/rust-overlay`. 

Here is a full example:  

{{ remote_code(url="https://raw.githubusercontent.com/graysonhead/nix-templates/main/rust/naersk-nightly/flake.nix", code_language="nix")}}

# Making Development Shells Automatic

Using [direnv](https://direnv.net/), and [nix-direnv](https://github.com/nix-community/nix-direnv), you can make the activation of your development
environment automatic. Add an `.envrc` file in the root of your repo with the line:  
```
use flake
```
And then run the command `direnv allow` from this directory. Your development shell will now be activated any time you change directory to that location.

This means that your entire environment will automatically switch whenever you change between projects, meaning you don't have to deal with rustup and
toolchains whenever you switch between a nightly and stable Rust project.

You can also get IDE/terminal editor plugins that allow you to use this environment as well, so that your `rust-analyzer` version is appropriate to the version
of Rust you are developing on. I use `cab404.vscode-direnv` for vscode, and [direnv-vim](https://github.com/direnv/direnv.vim) for vim.

# Bonus Round: Nix Party Tricks

Lets look at some other fun stuff you can trivially do now that you have this set up. 

Run a program from a remote git repo without permanently installing it in your profile or system path:  
```
$ nix run github:nixos/nixpkgs/nixpkgs-unstable#hello
```

You can also cross-compile it to a different architecture (requires for `boot.binfmt.emulatedSystems` to be set appropriately on NixOS):

```
$ nix build github:nixos/nixpkgs/nixpkgs-unstable#legacyPackages.aarch64-linux.hello
$ file result/bin/hello 
result/bin/hello: ELF 64-bit LSB executable, ARM aarch64, version 1 (SYSV), dynamically linked, interpreter /nix/store/rjpx52ch4508wrq8wjf5nnbsc6pr3158-glibc-2.37-8/lib/ld-linux-aarch64.so.1, for GNU/Linux 3.10.0, not stripped
```

Need to distribute your program via RPM or Deb? In most cases, this is trivial:  
```
$ nix bundle --bundler github:NixOS/bundlers#toDEB .#defaultPackage.x86_64-linux
$ nix bundle --bundler github:NixOS/bundlers#toRPM .#defaultPackage.x86_64-linux
```

