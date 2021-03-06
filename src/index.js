// @flow

const {parseSource} = require('./compiler/parsing/watf');
const {parseBinary} = require('./compiler/parsing/wasm');
const {Instance} = require('./interpreter');
const {RuntimeError, CompileError, LinkError} = require('./errors');
const {createCompiledModule, Module} = require('./compiler/compile/module');
const {Memory} = require('./interpreter/runtime/values/memory');
const {Table} = require('./interpreter/runtime/values/table');

const WebAssembly = {

  instantiate(buff: ArrayBuffer, importObject: ImportObject = {}): Promise<Instance> {

    return new Promise((resolve, reject) => {

      if (
        buff instanceof ArrayBuffer === false
        && buff instanceof Uint8Array === false
      ) {
        return reject(
          'Module must be either an ArrayBuffer or an Uint8Array (BufferSource), '
            + (typeof buff) + ' given.'
        );
      }

      const ast = parseBinary(buff);
      const module = createCompiledModule(ast);

      resolve(
        new Instance(module, importObject)
      );

    });
  },

  compile(buff: ArrayBuffer): Promise<CompiledModule> {

    return new Promise((resolve) => {
      const ast = parseBinary(buff);

      resolve(
        createCompiledModule(ast)
      );
    });
  },

  instantiateFromSource(content: string, importObject: ImportObject = {}): Instance {
    const ast = parseSource(content);
    const module = createCompiledModule(ast);

    return new Instance(module, importObject);
  },

  Instance,
  Module,
  Memory,
  Table,
  RuntimeError,
  LinkError,
  CompileError,
};

const _debug = {

  parseWATF(content: string, cb: (ast: Node) => void) {
    const ast = parseSource(content);

    cb(ast);
  },

  parseWASM(content: ArrayBuffer, cb: (ast: Node) => void) {
    const ast = parseBinary(content);

    cb(ast);
  },

};

module.exports = WebAssembly;
module.exports._debug = _debug;
