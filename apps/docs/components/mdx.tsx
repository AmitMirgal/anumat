import path from 'node:path';
import { fileURLToPath } from 'node:url';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { TypeTable } from 'fumadocs-ui/components/type-table';
import { createGenerator } from 'fumadocs-typescript';
import { AutoTypeTable as AutoTypeTableBase } from 'fumadocs-typescript/ui';
import type { MDXComponents } from 'mdx/types';
import type { ComponentProps } from 'react';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const generator = createGenerator({
  tsconfigPath: path.join(repoRoot, 'packages/engine/tsconfig.json'),
});

function AutoTypeTable({
  path: filePath,
  ...props
}: Omit<ComponentProps<typeof AutoTypeTableBase>, 'generator'>) {
  const resolved =
    filePath && !path.isAbsolute(filePath) ? path.resolve(repoRoot, filePath) : filePath;
  return <AutoTypeTableBase generator={generator} path={resolved} {...props} />;
}

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Tabs,
    Tab,
    TypeTable,
    AutoTypeTable,
    ...components,
  };
}

export const useMDXComponents = getMDXComponents;
