import { parseCurve } from './model.ts';
import type { MeasuredCurve } from './types.ts';
import { errorMessage } from './utils.ts';

/** Read in selection order; a bad file must not prevent the others importing. */
export async function readCurveFiles(files: readonly Pick<File, 'name' | 'size' | 'text'>[]) {
  const curves: MeasuredCurve[] = [];
  const errors: string[] = [];
  for (const file of files) {
    try {
      if (file.size > 10 * 1024 * 1024) throw Error('File exceeds 10 MB.');
      curves.push({ ...parseCurve(await file.text(), file.name), kind: 'both' });
    } catch (error) {
      errors.push(`${file.name}: ${errorMessage(error)}`);
    }
  }
  return { curves, errors };
}
