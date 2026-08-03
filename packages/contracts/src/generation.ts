import { format } from 'prettier';
import { z } from 'zod';

import {
  CONTRACT_SCHEMA_REGISTRY,
  contractJsonSchema,
  type ContractSchemaName,
} from './registry.js';

export const CONTRACT_SCHEMA_VERSION = 1;
export const CONTRACT_BUNDLE_FILE = 'gosu-contracts.v1.bundle.schema.json';
export const CONTRACT_INDEX_FILE = 'index.json';

type JsonObject = Record<string, unknown>;

function schemaFileName(name: ContractSchemaName): string {
  const withoutVersionSuffix = name.replace(/V1$/, '');
  const kebab = withoutVersionSuffix
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
  return `${kebab}.v1.schema.json`;
}

function serialize(value: unknown): Promise<string> {
  return format(JSON.stringify(value), {
    parser: 'json',
    endOfLine: 'lf',
    printWidth: 100,
    tabWidth: 2,
  });
}

function jsonClone(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function rewriteBundleReferences(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(rewriteBundleReferences);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (key === '$ref' && typeof child === 'string') {
        const prefix = 'urn:gosu:contract:v1:';
        if (child.startsWith(prefix)) {
          const externalReference = child.slice(prefix.length);
          const fragmentOffset = externalReference.indexOf('#');
          const schemaName =
            fragmentOffset === -1 ? externalReference : externalReference.slice(0, fragmentOffset);
          const fragment = fragmentOffset === -1 ? '' : externalReference.slice(fragmentOffset + 1);
          const suffix = fragment.length === 0 ? '' : `/${fragment.replace(/^\//, '')}`;
          return [key, `#/definitions/${schemaName}${suffix}`];
        }
      }
      return [key, rewriteBundleReferences(child)];
    }),
  );
}

function buildBundle(contractNames: readonly ContractSchemaName[]): JsonObject {
  const registry = z.registry<{ id: string }>();
  for (const name of contractNames) {
    registry.add(CONTRACT_SCHEMA_REGISTRY[name], { id: name });
  }

  const registryResult = z.toJSONSchema(registry, {
    target: 'draft-07',
    uri: (id) => `urn:gosu:contract:v1:${id}`,
  });
  const definitions = Object.fromEntries(
    Object.entries(registryResult.schemas).map(([name, schema]) => {
      const plainSchema = jsonClone(schema);
      delete plainSchema.$schema;
      delete plainSchema.$id;
      return [name, rewriteBundleReferences(plainSchema)];
    }),
  );

  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'urn:gosu:contracts:bundle:v1',
    title: 'GOSU contract bundle v1',
    description: 'Language-neutral canonical schemas for generated TypeScript and Go boundaries.',
    definitions,
  };
}

/** Deterministically renders every tracked JSON Schema artifact. */
export async function renderContractSchemaArtifacts(): Promise<Readonly<Record<string, string>>> {
  const contractNames = Object.keys(CONTRACT_SCHEMA_REGISTRY) as ContractSchemaName[];
  const individualSchemas = Object.fromEntries(
    await Promise.all(
      contractNames.map(async (name) => [
        schemaFileName(name),
        await serialize(contractJsonSchema(name)),
      ]),
    ),
  );
  const index = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    bundle: CONTRACT_BUNDLE_FILE,
    contracts: contractNames.map((name) => ({
      name,
      file: schemaFileName(name),
      id: `urn:gosu:contract:v1:${name}`,
    })),
  };

  return {
    ...individualSchemas,
    [CONTRACT_BUNDLE_FILE]: await serialize(buildBundle(contractNames)),
    [CONTRACT_INDEX_FILE]: await serialize(index),
  };
}
