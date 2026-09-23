import {generateAutoEq} from './autoeq.js';
self.onmessage=({data})=>{
  try {const result=generateAutoEq(data,progress=>self.postMessage({type:'progress',...progress}));self.postMessage({type:'result',result});}
  catch(error){self.postMessage({type:'error',message:error.message});}
};
