import test from 'node:test';
import assert from 'node:assert/strict';
import { readCurveFiles } from '../src/curve-import.ts';
import { chooseFile, chooseFiles } from '../src/ui/dialog.ts';
import { initialState, validateState } from '../src/model.ts';

test('multiple curve files preserve selection order, names and data across persistence', async () => {
  const files = [
    new File(['frequency,dB\n20,1\n20000,-2'], 'First.csv'),
    new File(['20\t3\n20000\t4'], 'Second.tsv'),
    new File(['# measurement\n20 5\n20000 6'], 'Third.txt'),
  ];
  const { curves, errors } = await readCurveFiles(files);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    curves.map((c) => c.name),
    files.map((f) => f.name),
  );
  assert.deepEqual(
    curves.map((c) => c.points[0][1]),
    [1, 3, 5],
  );
  assert.equal(new Set(curves.map((c) => c.id)).size, 3);
  assert.ok(curves.every((c) => c.kind === 'both'));
  const state = initialState();
  state.curves.push(...curves);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))).curves, state.curves);
});

test('invalid, oversized and unreadable curves do not prevent valid files importing', async () => {
  const result = await readCurveFiles([
    new File(['invalid'], 'Invalid.csv'),
    {
      name: 'Huge.txt',
      size: 10 * 1024 * 1024 + 1,
      text: async () => assert.fail('must not read oversized files'),
    },
    {
      name: 'Unreadable.tsv',
      size: 10,
      text: async () => {
        throw Error('Read failed');
      },
    },
    new File(['20,0\n20000,1'], 'Valid.csv'),
  ]);
  assert.deepEqual(
    result.curves.map((c) => c.name),
    ['Valid.csv'],
  );
  assert.equal(result.errors.length, 3);
  assert.match(result.errors[0], /^Invalid.csv:/);
  assert.match(result.errors[1], /^Huge.txt: File exceeds 10 MB/);
  assert.match(result.errors[2], /^Unreadable.tsv: Read failed/);
  assert.deepEqual(await readCurveFiles([]), { curves: [], errors: [] });
  assert.equal((await readCurveFiles([new File(['bad'], 'Bad.txt')])).curves.length, 0);
});

test('curve picker supports multiple files without enabling it for preset or backup imports', async (t) => {
  const input = {
    value: 'old selection',
    accept: '',
    multiple: false,
    files: [] as File[],
    onchange: null as (() => Promise<void>) | null,
    click() {},
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { querySelector: () => input },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  const errors: string[] = [];
  const batches: File[][] = [];
  chooseFiles(
    '.csv,.txt,.tsv',
    (files) => {
      batches.push(files);
    },
    (e) => errors.push(e),
  );
  assert.equal(input.multiple, true);
  assert.equal(input.value, '');
  assert.equal(input.accept, '.csv,.txt,.tsv');
  await input.onchange!();
  assert.equal(batches.length, 0, 'cancel must not import');
  input.files = [new File(['a'], 'One.csv'), new File(['b'], 'Two.tsv')];
  await input.onchange!();
  assert.deepEqual(batches[0], input.files);
  const singles: string[][] = [];
  chooseFile(
    '.json',
    (text, name, filename) => {
      singles.push([text, name, filename]);
    },
    (e) => errors.push(e),
  );
  assert.equal(input.multiple, false);
  await input.onchange!();
  assert.deepEqual(singles, [['a', 'One', 'One.csv']]);
  assert.deepEqual(errors, []);
});
