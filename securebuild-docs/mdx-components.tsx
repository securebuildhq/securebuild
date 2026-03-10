import { useMDXComponents as getDocsMDXComponents } from 'nextra-theme-docs'
import { PackageCount, InlinePackageCount } from './components/PackageCount'

const docsComponents = getDocsMDXComponents()

export const useMDXComponents = (components?: Record<string, unknown>) => ({
  ...docsComponents,
  PackageCount,
  InlinePackageCount,
  ...components
})
