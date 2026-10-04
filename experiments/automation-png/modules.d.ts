declare module '*.svg' {
  const svg: string;
  export default svg;
}
declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
declare module '*.bin' {
  const bytes: ArrayBuffer;
  export default bytes;
}
declare module '*.data' {
  const value: string;
  export default value;
}
