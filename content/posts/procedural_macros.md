+++
title = "Writing Procedural Macros in Rust"

date = 2023-04-22

draft = true

[taxonomies]
	tags = ["Rust", "Macros", "Procedural Macros", "syn", "Tutorials"]
+++

If you've ever used `serde`, or anything that uses derive macros, you may wonder what happens when you define a struct like this:

```rust
use serde::Serialize;

#[derive(Serialize)]
struct Point {
    x: i32,
    y: i32,
}

fn main() {
    let point = Point { x: 1, y: 2 };
    // Convert the Point to a JSON string.
    let serialized = serde_json::to_string(&point).unwrap();
    println!("{}", serialized);
}
```

Of course we know from the documentation, that deriving [Serialize](https://docs.rs/serde/latest/serde/trait.Serialize.html) adds an 
implementation for many methods, of which `to_string` is one. In fact, if we 


