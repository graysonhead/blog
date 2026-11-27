/* tslint:disable */
/* eslint-disable */
/**
 * Entry point for the two bodies example
 */
export function run_two_bodies(): void;
/**
 * Entry point for the three bodies example
 */
export function run_three_bodies(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly run_three_bodies: () => void;
  readonly run_two_bodies: () => void;
  readonly wasm_bindgen__convert__closures_____invoke__h44f455462768406f: (a: number, b: number, c: number) => void;
  readonly wasm_bindgen__closure__destroy__h08eb92dbe39baad3: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h86b230d85be7005e: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h46afc7913b6c64e5: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen__convert__closures_____invoke__hfc367ddb4827573c: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen__closure__destroy__h0211b996958cc5e7: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h849ea3e53f584942: (a: number, b: number, c: any, d: any) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h117d1938c0e705a5: (a: number, b: number) => void;
  readonly wasm_bindgen__closure__destroy__h9c8c24ddaac19d33: (a: number, b: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
