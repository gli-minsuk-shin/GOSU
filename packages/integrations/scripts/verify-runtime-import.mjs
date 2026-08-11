const runtimeModule = await import(new URL('../dist/index.js', import.meta.url));

const requiredExports = [
  'connectorRegistry',
  'createManuscriptWorkspaceAdapterRegistry',
  'createOverleafExport',
];
const missingExports = requiredExports.filter((exportName) => !(exportName in runtimeModule));

if (missingExports.length > 0) {
  throw new Error(`Built integrations entrypoint is missing exports: ${missingExports.join(', ')}`);
}

console.log('built integrations ESM runtime import passed');
