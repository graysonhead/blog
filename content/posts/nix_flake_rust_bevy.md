+++
title = "Nix Powered Dev Environments: Rust + Bevy"

date = 2023-06-20

[taxonomies]
	tags = ["Tutorials", "Nix", "NixOS", "Rust", "rust-overlay", "naersk", "bevy", "gamedev"]
+++

As with many things Nix, the result was simple and reliably repeatable, but getting there took a lot of throwing stuff at the wall. Currently my small allotment of game development time is focused on Rust, and more specifically Bevy; so if you aren't interested in that combination this post may not be much help to you.

If you want to just take my word for it and download a template, I'll save you some time:
```
nix flake new --template github:graysonhead/nix-templates#rust-bevy ./new_directory_here
```

This should get you a mostly out of the box "hello world" 3d scene running on bevy 0.10. At least, it should work out of the box on NixOS. For non NixOS, keep reading.

For posterity, here are the two most important parts:

`flake.nix`
{{ remote_code(url="https://raw.githubusercontent.com/graysonhead/nix-templates/main/rust/bevy/flake.nix", code_language="nix")}}

`cargo.toml`
{{ remote_code(url="https://raw.githubusercontent.com/graysonhead/nix-templates/main/rust/bevy/Cargo.toml", code_language="toml")}}


Going first over the `cargo.toml`, you will note that I'm following the advice of the [Unofficial Bevy Cheat Book](https://bevy-cheatbook.github.io/pitfalls/performance.html). 

```toml
[profile.dev]
opt-level = 1

[profile.dev.package."*"]
opt-level = 3
```

By setting the profile.dev to opt-level 1 and dev.package."*" to opt-level 3, you get a great compromise of compile times (as the code you are changing is at an optimization level of 1), but all the dependencies you are using (such as bevy itself) is at optimization level 3. In some cases, you may still run into performance issues, in which case you should increase the profile.dev opt level, or alternatively just compile in release mode.

Speaking of which, `nix build` will always compile in release mode.

Now, if you really want to get the compile times down, you will enable the `dynamic_linking` (formerly known as `dynamic` in pre 0.10 releases of Bevy). However, this prevents `nix build` or `nix run` from working, because dynamic linking in Nix is...odd. At least in regards to Rust.

So, to combat this, I made this rather counter-intuitive addition to the Cargo manifest:

```toml
[dependencies]
bevy = { package = "bevy", version = "0.10.1"}

[features]
default = ["bevy/dynamic_linking"]
```

So, by default if you run `cargo build` or `cargo run`, you will get very fast compile times thanks to dynamic linking, however once you build the derivation in release mode using nix, it won't use dynamic linking (and will actually work as a result.)

The `cargoBuildOptions` line in the flake governs that behavior:

```nix
packages = rec {
    bevy_template = naersk'.buildPackage {
    src = ./.;
    nativeBuildInputs = nativeBuildInputs;
    buildInputs = buildInputs;
    postInstall = ''
        cp -r assets $out/bin/
    '';
    # Disables dynamic linking when building with Nix
    cargoBuildOptions = x: x ++ [ "--no-default-features" ];
    };
};
```

In addition, the `postInstall` line ensures that any game assets are copied to the correct directory. 


So, you get the best of both worlds more or less. Consistent development environments using Flakes, fast compile times using cargo, and statically linked outputs using nix.

# Non NixOS Systems

If you want to run this example using Nix on a non-NixOS system, you will need an extra step. Since your graphics drivers are most likely not available in the Nix store, you will need to employ a wrapper to make them available. 

The best one I've found is [NixGL](https://github.com/guibou/nixGL). 

Use it like this:
```
nix run --impure github:guibou/nixGL -- nix run
```

Or, if your Nix install doesn't have Non-free packages enabled by default:
```
export NIXPKGS_ALLOW_UNFREE=1 && nix run --impure github:guibou/nixGL -- nix run
```