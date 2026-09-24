import type { AutoEqRequest, AutoEqMessage } from './types.ts';
import { errorMessage } from './utils.ts';
import { generateAutoEq } from './autoeq.ts';
const send = (message: AutoEqMessage) => self.postMessage(message);
self.onmessage = ({ data }: MessageEvent<AutoEqRequest>) => {
  try {
    const result = generateAutoEq(data, (progress) => send({ type: 'progress', ...progress }));
    send({ type: 'result', result });
  } catch (error) {
    send({ type: 'error', message: errorMessage(error) });
  }
};
