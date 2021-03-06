#!/usr/bin/env node
// @flow

const {instantiate} = require('../index');
const {readFileSync} = require('fs');

function debug(msg: string) {
  console.error(msg);
}

function toArrayBuffer(buf) {
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength
  );
}

const filename = process.argv[2];
const entrypoint = process.argv[3];

if (typeof filename === 'undefined') {
  throw new Error('Missing file');
}

debug('Compiling...');

const buff = toArrayBuffer(readFileSync(filename, null));

instantiate(buff)
  .then((module) => {

    if (typeof entrypoint !== 'undefined') {
      const startfn = module.exports[entrypoint];

      if (typeof startfn !== 'function') {
        throw new Error('Entrypoint not found');
      }

      debug('Executing...');

      startfn();
    }

  })
  .catch((err) => {
    throw err;
  });

process.on('unhandledRejection', (reason, p) => {
  throw reason;
});
