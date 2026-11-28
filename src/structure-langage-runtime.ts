import { Runtime } from './runtime';
import { Ref } from './structure-langage';
import type { Element, Composition, Phrase, Complements, Variables, Query, Expression } from './structure-langage';
export * from './runtime';
const runtime = new Runtime(process.env.MEMORY_DB || 'memory.sqlite');
export const addMemoryComposition = (ref:Element|string|number,name:Composition['name'],of?:Element) => runtime.addMemoryComposition(ref,name,of);
export const addMemoryPhrase = (subject:Element|undefined,name:Phrase[2],...complements:Complements) => runtime.addMemoryPhrase(subject,name,...complements);
export const query = <const T extends Variables,const E extends Expression<NoInfer<T>>>(q:Query<T,E>) => runtime.query(q);
export const memoryRef = () => runtime.memoryRef();
export const memoryRelation = () => runtime.memoryRelation;
export const memoryComposition = () => runtime.memoryComposition;
export const deleteReferences = (refs:Ref[]):void => {
    if (!Array.isArray(refs) || refs.some(ref => !(ref instanceof Ref))) throw new Error('deleteReferences attend un tableau de Ref');
    runtime.deleteReferences(refs.map(ref => ref.id));
};
export const transaction = <T>(f:()=>T) => runtime.transaction(f);
export const close = () => runtime.close();
