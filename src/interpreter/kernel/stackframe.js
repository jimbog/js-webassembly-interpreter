// @flow

export function createStackFrame(
  code: Array<Instruction>,
  locals: Array<StackLocal>,
  originatingModule: ModuleInstance,
  allocator: Allocator,
): StackFrame {

  return {
    code,
    locals,

    globals: [],

    /**
     * Labels are named block of code.
     * We maintain a map to access the block for a given identifier.
     *
     * https://webassembly.github.io/spec/exec/runtime.html#labels
     */
    labels: {},

    /**
     * Local applicatif Stack for the current stackframe.
     *
     * https://webassembly.github.io/spec/exec/runtime.html#stack
     */
    values: [],

    /**
     * We keep a reference to its originating module.
     *
     * When we need to lookup a function by addr for example.
     */
    originatingModule,

    /**
     * For shared memory operations
     */
    allocator,
  };
}

export function createChildStackFrame(
  parent: StackFrame,
  code: Array<Instruction>,
): StackFrame {
  const {
    locals,
    originatingModule,
    labels,
    allocator,
  } = parent;

  const frame = createStackFrame(code, locals, originatingModule, allocator);
  frame.labels = labels;

  return frame;
}
