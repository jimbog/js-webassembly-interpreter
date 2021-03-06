// @flow

const {
  binopi32,
  binopi64,

  binopf32,
  binopf64,
} = require('./instruction/binop');
const i32 = require('../runtime/values/i32');
const i64 = require('../runtime/values/i64');
const f32 = require('../runtime/values/f32');
const f64 = require('../runtime/values/f64');
const label = require('../runtime/values/label');
const {createChildStackFrame} = require('./stackframe');
const {createTrap, isTrapped} = require('./signals');
const {RuntimeError} = require('../../errors');

// TODO(sven): can remove asserts call at compile to gain perf in prod
function assert(cond) {

  if (!cond) {
    throw new RuntimeError('Assertion error');
  }
}

export function executeStackFrame(frame: StackFrame, depth: number = 0): any {
  let pc = 0;

  function getLocal(index: number) {
    const local = frame.locals[index];

    if (typeof local === 'undefined') {
      throw new RuntimeError('Assertion error: no local value at index ' + index);
    }

    frame.values.push(local);
  }

  function setLocal(index: number, value: StackLocal) {
    frame.locals[index] = value;
  }

  function pushResult(res: StackLocal) {
    frame.values.push(res);
  }

  function pop1(type: ?Valtype): any {
    assertNItemsOnStack(frame.values, 1);

    const v = frame.values.pop();

    if (typeof type === 'string' && v.type !== type) {
      throw new RuntimeError(
        'Internal failure: expected value of type ' + type
        + ' on top of the stack, give type: ' + v.type
      );
    }

    return v;
  }

  function pop2(type1: Valtype, type2: Valtype): [any, any] {
    assertNItemsOnStack(frame.values, 2);

    const c2 = frame.values.pop();
    const c1 = frame.values.pop();

    if (c2.type !== type2) {
      throw new RuntimeError(
        'Internal failure: expected c2 value of type ' + type2
        + ' on top of the stack, give type: ' + c2.type
      );
    }

    if (c1.type !== type2) {
      throw new RuntimeError(
        'Internal failure: expected c1 value of type ' + type2
        + ' on top of the stack, give type: ' + c1.type
      );
    }

    return [c1, c2];
  }

  while (pc < frame.code.length) {
    const instruction = frame.code[pc];

    switch (instruction.type) {

    /**
     * Function declaration
     *
     * FIXME(sven): seems unspecified in the spec but it's required for the `call`
     * instruction.
     */
    case 'Func': {
      const func = instruction;

      /**
       * Register the function into the stack frame labels
       */
      if (typeof func.id === 'string') {
        frame.labels[func.id] = func;
      }

      break;
    }

    }

    switch (instruction.id) {

    case 'const': {
      // https://webassembly.github.io/spec/exec/instructions.html#exec-const

      const n = instruction.args[0];

      if (typeof n === 'undefined') {
        throw new RuntimeError('const requires one argument, none given.');
      }

      switch (instruction.object) {

      case 'i32': {
        pushResult(
          i32.createValue(n)
        );

        break;
      }

      case 'i64': {
        pushResult(
          i64.createValue(n)
        );

        break;
      }


      case 'f32': {
        pushResult(
          f32.createValue(n)
        );

        break;
      }

      case 'f64': {
        pushResult(
          f64.createValue(n)
        );

        break;
      }

      default:
        throw new RuntimeError('Unsupported operation ' + instruction.id + ' on ' + instruction.object);

      }

      break;
    }

    /**
     * Control Instructions
     *
     * https://webassembly.github.io/spec/exec/instructions.html#control-instructions
     */
    case 'nop': {
      // Do nothing
      // https://webassembly.github.io/spec/exec/instructions.html#exec-nop
      break;
    }

    case 'loop': {
      // https://webassembly.github.io/spec/exec/instructions.html#exec-loop
      const loop = instruction;

      assert(typeof loop.instr === 'object' && typeof loop.instr.length !== 'undefined');

      if (loop.instr.length > 0) {
        const childStackFrame = createChildStackFrame(frame, loop.instr);
        childStackFrame.trace = frame.trace;

        const res = executeStackFrame(childStackFrame, depth + 1);

        if (isTrapped(res)) {
          return res;
        }
      }

      break;
    }

    case 'call': {
      // According to the spec call doesn't support an Identifier as argument
      // but the Script syntax supports it.
      // https://webassembly.github.io/spec/exec/instructions.html#exec-call

      const call = instruction;

      // WAST
      if (call.index.type === 'Identifier') {

        const element = frame.labels[call.index.name];

        if (typeof element === 'undefined') {
          throw new RuntimeError('Cannot call ' + call.index.name + ': label not found on the call stack');
        }

        if (element.type === 'Func') {

          const childStackFrame = createChildStackFrame(frame, element.body);

          const res = executeStackFrame(childStackFrame, depth + 1);

          if (isTrapped(res)) {
            return res;
          }

          if (typeof res !== 'undefined') {
            pushResult(res);
          }
        }
      }

      // WASM
      if (call.index.type === 'NumberLiteral') {

        const index = call.index.value;

        assert(typeof frame.originatingModule !== 'undefined');

        // 2. Assert: due to validation, F.module.funcaddrs[x] exists.
        const funcaddr = frame.originatingModule.funcaddrs[index];

        if (typeof funcaddr === 'undefined') {

          throw new RuntimeError(
            `Cannot call function at local address ${index}: not found`
          );
        }

        // 3. Let a be the function address F.module.funcaddrs[x]

        const subroutine = frame.allocator.get(funcaddr);

        if (typeof subroutine !== 'object') {

          throw new RuntimeError(
            `Cannot call function at address ${funcaddr}: not a function`
          );
        }

        // 4. Invoke the function instance at address a

        const childStackFrame = createChildStackFrame(frame, subroutine.code);
        const res = executeStackFrame(childStackFrame, depth + 1);

        if (isTrapped(res)) {
          return res;
        }

        if (typeof res !== 'undefined') {
          pushResult(res);
        }

      }

      break;
    }

    case 'block': {
      const block = instruction;

      /**
       * Used to keep track of the number of values added on top of the stack
       * because we need to remove the label after the execution of this block.
       */
      let numberOfValuesAddedOnTopOfTheStack = 0;

      /**
       * When entering block push the label onto the stack
       */
      if (typeof block.label === 'string') {

        pushResult(
          label.createValue(block.label)
        );
      }

      assert(typeof block.instr === 'object' && typeof block.instr.length !== 'undefined');

      if (block.instr.length > 0) {
        const childStackFrame = createChildStackFrame(frame, block.instr);
        childStackFrame.trace = frame.trace;

        const res = executeStackFrame(childStackFrame, depth + 1);

        if (isTrapped(res)) {
          return res;
        }

        if (typeof res !== 'undefined') {
          pushResult(res);
          numberOfValuesAddedOnTopOfTheStack++;
        }
      }

      /**
       * Wen exiting the block
       *
       * > Let m be the number of values on the top of the stack
       *
       * The Stack (values) are seperated by StackFrames and we are running on
       * one single thread, there's no need to check if values were added.
       *
       * We tracked it in numberOfValuesAddedOnTopOfTheStack anyway.
       */
      const topOfTheStack = frame.values.slice(frame.values.length - numberOfValuesAddedOnTopOfTheStack);

      frame.values.splice(frame.values.length - numberOfValuesAddedOnTopOfTheStack);

      pop1('label');

      frame.values = [...frame.values, ...topOfTheStack];

      break;
    }

    case 'if': {

      /**
       * Execute test
       */
      const childStackFrame = createChildStackFrame(frame, instruction.test);
      childStackFrame.trace = frame.trace;

      const res = executeStackFrame(childStackFrame, depth + 1);

      if (isTrapped(res)) {
        return res;
      }

      if (!isZero(res)) {

        /**
         * Execute consequent
         */
        const childStackFrame = createChildStackFrame(frame, instruction.consequent);
        childStackFrame.trace = frame.trace;

        const res = executeStackFrame(childStackFrame, depth + 1);

        if (isTrapped(res)) {
          return res;
        }

        if (typeof res !== 'undefined') {
          pushResult(res);
        }

      } else if (typeof instruction.alternate !== 'undefined' && instruction.alternate.length > 0) {

        /**
         * Execute alternate
         */
        const childStackFrame = createChildStackFrame(frame, instruction.alternate);
        childStackFrame.trace = frame.trace;

        const res = executeStackFrame(childStackFrame, depth + 1);

        if (isTrapped(res)) {
          return res;
        }

        if (typeof res !== 'undefined') {
          pushResult(res);
        }

      }

      break;
    }

    /**
     * Administrative Instructions
     *
     * https://webassembly.github.io/spec/exec/runtime.html#administrative-instructions
     */
    case 'unreachable':
    // https://webassembly.github.io/spec/exec/instructions.html#exec-unreachable
    case 'trap': {
      // signalling abrupt termination
      // https://webassembly.github.io/spec/exec/runtime.html#syntax-trap
      return createTrap();
    }

    /**
     * Memory Instructions
     *
     * https://webassembly.github.io/spec/exec/instructions.html#memory-instructions
     */
    case 'get_local': {
      // https://webassembly.github.io/spec/exec/instructions.html#exec-get-local
      const index = instruction.args[0];

      if (typeof index === 'undefined') {
        throw new RuntimeError('get_local requires one argument, none given.');
      }

      getLocal(index);

      break;
    }

    case 'set_local': {
      // https://webassembly.github.io/spec/exec/instructions.html#exec-set-local
      const index = instruction.args[0];
      const init = instruction.args[1];

      if (typeof init !== 'undefined' && init.type === 'Instr') {
        // WAST

        const childStackFrame = createChildStackFrame(frame, [init]);
        childStackFrame.trace = frame.trace;

        const res = executeStackFrame(childStackFrame, depth + 1);

        if (isTrapped(res)) {
          return res;
        }

        setLocal(index, res);
      } else {
        // WASM

        // 4. Pop the value val from the stack
        const val = pop1();

        // 5. Replace F.locals[x] with the value val
        setLocal(index, val);
      }

      break;
    }

    case 'tee_local': {
      // https://webassembly.github.io/spec/exec/instructions.html#exec-tee-local
      const index = instruction.args[0];
      const init = instruction.args[1];

      if (init.type === 'Instr') {
        const childStackFrame = createChildStackFrame(frame, [init]);
        childStackFrame.trace = frame.trace;

        const res = executeStackFrame(childStackFrame, depth + 1);

        if (isTrapped(res)) {
          return res;
        }

        setLocal(index, res);

        pushResult(
          res
        );
      }

      break;
    }

    case 'set_global': {
      // https://webassembly.github.io/spec/exec/instructions.html#exec-set-global
      const index = instruction.args[0];

      // 2. Assert: due to validation, F.module.globaladdrs[x] exists.
      const globaladdr = frame.originatingModule.globaladdrs[index];

      if (typeof globaladdr === 'undefined') {
        throw new RuntimeError(`Global address ${index} not found`);
      }

      // 4. Assert: due to validation, S.globals[a] exists.
      const globalinst = frame.allocator.get(globaladdr);

      if (typeof globalinst !== 'object') {

        throw new RuntimeError(
          `Unexpected data for global at ${globaladdr}`
        );
      }

      // 7. Pop the value val from the stack.
      const val = pop1();

      // 8. Replace glob.value with the value val.
      globalinst.value = val;

      frame.allocator.set(globaladdr, globalinst);

      break;
    }

    case 'get_global': {
      // https://webassembly.github.io/spec/exec/instructions.html#exec-get-global
      const index = instruction.args[0];

      // 2. Assert: due to validation, F.module.globaladdrs[x] exists.
      const globaladdr = frame.originatingModule.globaladdrs[index];

      if (typeof globaladdr === 'undefined') {
        throw new RuntimeError(`Global address ${index} not found`);
      }

      // 4. Assert: due to validation, S.globals[a] exists.
      const globalinst = frame.allocator.get(globaladdr);

      if (typeof globalinst !== 'object') {

        throw new RuntimeError(
          `Unexpected data for global at ${globaladdr}`
        );
      }

      // 7. Pop the value val from the stack.
      pushResult(
        globalinst.value
      );

      break;
    }

    /**
     * Numeric Instructions
     *
     * https://webassembly.github.io/spec/exec/instructions.html#numeric-instructions
     */
    case 'add': {

      switch (instruction.object) {

      case 'i32': {
        const [c1, c2] = pop2('i32', 'i32');

        pushResult(
          binopi32(c2, c1, '+')
        );

        break;
      }

      case 'i64': {
        const [c1, c2] = pop2('i64', 'i64');

        pushResult(
          binopi64(c2, c1, '+')
        );

        break;
      }

      case 'f32': {
        const [c1, c2] = pop2('f32', 'f32');

        pushResult(
          binopf32(c2, c1, '+')
        );

        break;
      }

      case 'f64': {
        const [c1, c2] = pop2('f64', 'f64');

        pushResult(
          binopf64(c2, c1, '+')
        );

        break;
      }

      default:
        throw new RuntimeError('Unsupported operation ' + instruction.id + ' on ' + instruction.object);

      }

      break;
    }

    case 'mul': {

      switch (instruction.object) {

      case 'i32': {
        const [c1, c2] = pop2('i32', 'i32');

        pushResult(
          binopi32(c2, c1, '*')
        );

        break;
      }

      case 'i64': {
        const [c1, c2] = pop2('i64', 'i64');

        pushResult(
          binopi64(c2, c1, '*')
        );

        break;
      }

      case 'f32': {
        const [c1, c2] = pop2('f32', 'f32');

        pushResult(
          binopf32(c2, c1, '*')
        );

        break;
      }

      case 'f64': {
        const [c1, c2] = pop2('f64', 'f64');

        pushResult(
          binopf64(c2, c1, '*')
        );

        break;
      }

      default:
        throw new RuntimeError('Unsupported operation ' + instruction.id + ' on ' + instruction.object);

      }

      break;
    }

    case 'sub': {

      switch (instruction.object) {

      case 'i32': {
        const [c1, c2] = pop2('i32', 'i32');

        pushResult(
          binopi32(c2, c1, '-')
        );

        break;
      }

      case 'i64': {
        const [c1, c2] = pop2('i64', 'i64');

        pushResult(
          binopi64(c2, c1, '-')
        );

        break;
      }

      case 'f32': {
        const [c1, c2] = pop2('f32', 'f32');

        pushResult(
          binopf32(c2, c1, '-')
        );

        break;
      }

      case 'f64': {
        const [c1, c2] = pop2('f64', 'f64');

        pushResult(
          binopf64(c2, c1, '-')
        );

        break;
      }

      default:
        throw new RuntimeError('Unsupported operation ' + instruction.id + ' on ' + instruction.object);

      }

      break;
    }

    /**
     * There is two seperated operation for both signed and unsigned integer,
     * but since the host environment will handle that, we don't have too :)
     */
    case 'div_s':
    case 'div_u':
    case 'div': {

      switch (instruction.object) {

      case 'i32': {
        const [c1, c2] = pop2('i32', 'i32');

        pushResult(
          binopi32(c2, c1, '/')
        );

        break;
      }

      case 'i64': {
        const [c1, c2] = pop2('i64', 'i64');

        pushResult(
          binopi64(c2, c1, '/')
        );

        break;
      }

      case 'f32': {
        const [c1, c2] = pop2('f32', 'f32');

        pushResult(
          binopf32(c2, c1, '/')
        );

        break;
      }

      case 'f64': {
        const [c1, c2] = pop2('f64', 'f64');

        pushResult(
          binopf64(c2, c1, '/')
        );

        break;
      }

      default:
        throw new RuntimeError('Unsupported operation ' + instruction.id + ' on ' + instruction.object);

      }

      break;
    }

    }

    if (typeof frame.trace === 'function') {
      frame.trace(depth, pc, instruction);
    }

    pc++;
  }

  // Return the item on top of the values/stack;
  if (frame.values.length > 0) {
    return frame.values.pop();
  }
}

function assertNItemsOnStack(stack: Array<any>, numberOfItem: number) {
  if (stack.length < numberOfItem) {
    throw new RuntimeError('Assertion error: expected ' + numberOfItem + ' on the stack, found ' + stack.length);
  }
}

function valueEq(l: StackLocal, r: StackLocal): boolean {
  return l.value == r.value && l.type == r.type;
}

function isZero(v: StackLocal): boolean {
  if (typeof v === 'undefined') {
    return false;
  }

  const zero = i32.createValue(0);

  return valueEq(v, zero);
}
