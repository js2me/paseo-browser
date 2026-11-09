import { useMemo, useState } from 'react';
export function useRpc(contract) {
  return useMemo(() => async (input) => {
    const response = await fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: contract.name, input: contract.input.parse(input) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return contract.output.parse(result);
  }, [contract]);
}
export function useTabState(tab, schema, initial) { return useState(initial); }
export function useSettings(definition) {
  const [values, setValues] = useState(() => definition.schema.parse({}));
  return { status: 'ready', values, revision: 'test', saving: false, saveError: null,
    save: async (next) => { setValues(next); return true; }, reload: async () => {}, reset: async () => true };
}
